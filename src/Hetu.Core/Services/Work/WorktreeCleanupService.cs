using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Settings;
using Microsoft.Extensions.Logging;

namespace Hetu.Core.Services.Work;

/// <summary>清理结果</summary>
public record WorktreeCleanupResult(int Removed, int Checked, int Kept);

/// <summary>
/// 工作树自动清理：
/// 1) 已合并/已完成——工作树干净（无未提交、无未跟踪文件）且它的提交都已经在集成分支里
///    （或曾推送过、远端分支已被删除，即常见 squash 合并后删分支），空闲一段时间后连同工作树一起清掉；
/// 2) 孤立工作树——工作树根目录（默认仓库父目录下的 <c>.hetu-worktrees</c>，旧版为 <c>&lt;仓库名&gt;.hetu-worktrees</c>）
/// 下不再被任何会话引用的目录（这类是纯垃圾，始终清理）。
/// 会话记录同步复位为「当前分支」，下次发消息不会再建工作树。分支默认保留，可配置删除。
/// </summary>
public class WorktreeCleanupService
{
    private const string ConfigKey = "WorktreeCleanupConfig";

    /// <summary>新建多久内视为"可能正在创建"而跳过（仅自动清理生效，force 时忽略）</summary>
    private static readonly TimeSpan FreshWindow = TimeSpan.FromMinutes(10);

    private readonly IUnitOfWork _unitOfWork;
    private readonly WorkWorktreeService _worktrees;
    private readonly IAppSettingService _appSettings;
    private readonly ILogger<WorktreeCleanupService> _logger;

    public WorktreeCleanupService(
        IUnitOfWork unitOfWork,
        WorkWorktreeService worktrees,
        IAppSettingService appSettings,
        ILogger<WorktreeCleanupService> logger)
    {
        _unitOfWork = unitOfWork;
        _worktrees = worktrees;
        _appSettings = appSettings;
        _logger = logger;
    }

    public async Task<WorktreeCleanupConfigDto> GetConfigAsync(CancellationToken cancellationToken = default)
    {
        var setting = await _appSettings.GetAsync(ConfigKey, cancellationToken);
        if (string.IsNullOrWhiteSpace(setting.Data?.Value)) return new WorktreeCleanupConfigDto();
        try
        {
            return JsonSerializer.Deserialize<WorktreeCleanupConfigDto>(setting.Data.Value) ?? new WorktreeCleanupConfigDto();
        }
        catch (JsonException)
        {
            return new WorktreeCleanupConfigDto();
        }
    }

    public async Task SaveConfigAsync(WorktreeCleanupConfigDto config, CancellationToken cancellationToken = default)
    {
        config.IntervalHours = Math.Clamp(config.IntervalHours, 1, 168);
        config.IdleHours = Math.Clamp(config.IdleHours, 1, 8760);
        var existing = await GetConfigAsync(cancellationToken);
        config.LastRunAt = existing.LastRunAt;
        config.LastRemoved = existing.LastRemoved;
        await _appSettings.SetAsync(new UpdateAppSettingRequest { Key = ConfigKey, Value = JsonSerializer.Serialize(config) }, cancellationToken);
    }

    /// <summary>手动/自动入口：清理所有项目的已完成与孤立工作树</summary>
    public async Task<WorktreeCleanupResult> CleanupAllAsync(bool force = false, CancellationToken cancellationToken = default)
    {
        var config = await GetConfigAsync(cancellationToken);
        if (!force && !config.Enabled) return new WorktreeCleanupResult(0, 0, 0);

        var idleFor = TimeSpan.FromHours(config.IdleHours);
        var removed = 0;
        var kept = 0;
        var checkedCount = 0;
        var projects = await _unitOfWork.WorkProjects.GetAllAsync(cancellationToken);
        foreach (var project in projects)
        {
            try
            {
                var result = await CleanupProjectAsync(project, config, idleFor, force, cancellationToken);
                removed += result.Removed;
                checkedCount += result.Checked;
                kept += result.Kept;
            }
            catch (Exception ex)
            {
                // 单个项目失败不影响其它项目
                _logger.LogWarning(ex, "[worktree] 清理项目 {Project} 的工作树失败", project.Name);
            }
        }

        config.LastRunAt = DateTimeOffset.UtcNow;
        config.LastRemoved = removed;
        await _appSettings.SetAsync(new UpdateAppSettingRequest { Key = ConfigKey, Value = JsonSerializer.Serialize(config) }, cancellationToken);
        return new WorktreeCleanupResult(removed, checkedCount, kept);
    }

    /// <summary>只清理指定项目</summary>
    public async Task<WorktreeCleanupResult> CleanupProjectAsync(Guid projectId, bool force = false, CancellationToken cancellationToken = default)
    {
        var project = await _unitOfWork.WorkProjects.GetByIdAsync(projectId, cancellationToken);
        if (project == null) return new WorktreeCleanupResult(0, 0, 0);
        var config = await GetConfigAsync(cancellationToken);
        if (!force && !config.Enabled) return new WorktreeCleanupResult(0, 0, 0);
        return await CleanupProjectAsync(project, config, TimeSpan.FromHours(config.IdleHours), force, cancellationToken);
    }

    private async Task<WorktreeCleanupResult> CleanupProjectAsync(
        WorkProject project, WorktreeCleanupConfigDto config, TimeSpan idleFor, bool force, CancellationToken cancellationToken)
    {
        if (project.ConnectionType == "Ssh") return new WorktreeCleanupResult(0, 0, 0);
        if (string.IsNullOrWhiteSpace(project.RootPath) || !Directory.Exists(project.RootPath)) return new WorktreeCleanupResult(0, 0, 0);
        if (!await _worktrees.IsGitRepoAsync(project.RootPath, cancellationToken)) return new WorktreeCleanupResult(0, 0, 0);

        var removed = 0;
        var kept = 0;
        var sessions = await _unitOfWork.WorkSessions.FindAsync(s => s.ProjectId == project.Id, cancellationToken);
        var target = await _worktrees.ResolveIntegrationRefAsync(project.RootPath, cancellationToken);
        var candidates = sessions.Where(s => !string.IsNullOrWhiteSpace(s.WorktreePath) || s.UseWorktree).ToList();

        foreach (var session in candidates)
        {
            var path = session.WorktreePath;
            if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path))
            {
                // 目录已不在（手工删掉等）：复位记录，下次发消息按需重建
                if (!string.IsNullOrWhiteSpace(path))
                {
                    session.WorktreePath = null;
                    session.Branch = null;
                    session.UpdatedAt = DateTimeOffset.UtcNow;
                    await _unitOfWork.WorkSessions.UpdateAsync(session, cancellationToken);
                }
                continue;
            }

            if (!force && DateTimeOffset.UtcNow - session.UpdatedAt < idleFor)
            {
                kept++;
                continue;
            }

            var branch = session.Branch ?? await _worktrees.GetCurrentBranchAsync(path, cancellationToken);
            if (string.IsNullOrWhiteSpace(branch) || string.Equals(branch, target, StringComparison.OrdinalIgnoreCase))
            {
                kept++;
                continue;
            }

            var merged = await _worktrees.IsCleanAsync(path, cancellationToken)
                && (await _worktrees.IsContainedInAsync(path, branch, target, cancellationToken)
                    || await _worktrees.WasPushTargetDeletedAsync(project.RootPath, branch, cancellationToken));
            if (!merged)
            {
                kept++;
                continue;
            }

            await _worktrees.RemoveAsync(project.RootPath, path, cancellationToken);
            if (config.DeleteMergedBranch) await _worktrees.DeleteBranchAsync(project.RootPath, branch, cancellationToken);

            session.WorktreePath = null;
            session.Branch = null;
            session.UseWorktree = false;
            session.UpdatedAt = DateTimeOffset.UtcNow;
            await _unitOfWork.WorkSessions.UpdateAsync(session, cancellationToken);
            _logger.LogInformation("[worktree] 清理已完成工作树 {Path}（分支 {Branch}，参照 {Target}）", path, branch, target);
            removed++;
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 无主残留目录：没有任何会话引用，直接删
        var root = await _worktrees.ResolveRootAsync(project.RootPath, cancellationToken);
        if (Directory.Exists(root))
        {
            var owned = sessions
                .Where(s => !string.IsNullOrWhiteSpace(s.WorktreePath))
                .Select(s => Path.GetFullPath(s.WorktreePath!))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var directory in Directory.GetDirectories(root))
            {
                var full = Path.GetFullPath(directory);
                if (owned.Contains(full)) continue;
                if (!force && Directory.GetLastWriteTimeUtc(full) > DateTime.UtcNow - FreshWindow) continue;
                await _worktrees.RemoveAsync(project.RootPath, full, cancellationToken);
                _logger.LogInformation("[worktree] 清理孤立工作树 {Path}（项目 {Project}）", full, project.Name);
                removed++;
            }
        }

        if (removed > 0) await _worktrees.PruneAsync(project.RootPath, cancellationToken);
        removed += await CleanupLegacyRootAsync(project, sessions, force, cancellationToken);
        DeleteIfEmpty(await _worktrees.ResolveRootAsync(project.RootPath, cancellationToken));
        return new WorktreeCleanupResult(removed, candidates.Count, kept);
    }

    /// <summary>清空后的仓库子目录（以及整个根目录）删掉，别留空壳</summary>
    private static void DeleteIfEmpty(string path)
    {
        try
        {
            if (!Directory.Exists(path) || Directory.EnumerateFileSystemEntries(path).Any()) return;
            Directory.Delete(path);
            var parent = Path.GetDirectoryName(path);
            if (parent != null && Directory.Exists(parent) && !Directory.EnumerateFileSystemEntries(parent).Any())
                Directory.Delete(parent);
        }
        catch (IOException)
        {
            // 删不掉就留着，下次再试
        }
    }

    /// <summary>
    /// 旧版默认位置（仓库同级 <c>&lt;仓库名&gt;.hetu-worktrees</c>）：清掉里面无人引用的目录，
    /// 清空后连这个目录一起删，避免继续占着仓库父目录。
    /// </summary>
    private async Task<int> CleanupLegacyRootAsync(
        WorkProject project, IReadOnlyList<WorkSession> sessions, bool force, CancellationToken cancellationToken)
    {
        var legacyRoot = WorkWorktreeService.LegacyRoot(project.RootPath);
        if (!Directory.Exists(legacyRoot)) return 0;

        var owned = sessions
            .Where(s => !string.IsNullOrWhiteSpace(s.WorktreePath))
            .Select(s => Path.GetFullPath(s.WorktreePath!))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var removed = 0;
        foreach (var directory in Directory.GetDirectories(legacyRoot))
        {
            var full = Path.GetFullPath(directory);
            if (owned.Contains(full)) continue;
            if (!force && Directory.GetLastWriteTimeUtc(full) > DateTime.UtcNow - FreshWindow) continue;
            await _worktrees.RemoveAsync(project.RootPath, full, cancellationToken);
            _logger.LogInformation("[worktree] 清理旧位置的工作树 {Path}（项目 {Project}）", full, project.Name);
            removed++;
        }

        try
        {
            if (Directory.Exists(legacyRoot) && !Directory.EnumerateFileSystemEntries(legacyRoot).Any())
                Directory.Delete(legacyRoot);
        }
        catch (IOException)
        {
            // 删不掉就留着，下次再试
        }
        return removed;
    }
}
