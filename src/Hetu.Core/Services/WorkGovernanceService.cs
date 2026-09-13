using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;
using Hetu.Shared.Common;
using Hetu.Shared.Work;

namespace Hetu.Core.Services;

public class WorkApprovalRuleService : IWorkApprovalRuleService
{
    private static readonly HashSet<string> Decisions = new(StringComparer.OrdinalIgnoreCase) { "allow", "deny" };

    private readonly IUnitOfWork _unitOfWork;

    public WorkApprovalRuleService(IUnitOfWork unitOfWork) => _unitOfWork = unitOfWork;

    public async Task<ApiResponse<List<WorkApprovalRuleDto>>> GetByProjectAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var rules = await _unitOfWork.WorkApprovalRules.FindAsync(r => r.ProjectId == projectId, cancellationToken);
        return ApiResponse<List<WorkApprovalRuleDto>>.Ok(rules
            .OrderBy(r => r.ToolName)
            .ThenBy(r => r.PathPattern)
            .Select(Map)
            .ToList());
    }

    public async Task<ApiResponse<WorkApprovalRuleDto>> CreateAsync(Guid projectId, CreateWorkApprovalRuleRequest request, CancellationToken cancellationToken = default)
    {
        var project = await _unitOfWork.WorkProjects.GetByIdAsync(projectId, cancellationToken);
        if (project == null) return ApiResponse<WorkApprovalRuleDto>.Fail("项目不存在");

        var toolName = string.IsNullOrWhiteSpace(request.ToolName) ? "*" : request.ToolName.Trim();
        var decision = string.IsNullOrWhiteSpace(request.Decision) ? "allow" : request.Decision.Trim().ToLowerInvariant();
        if (!Decisions.Contains(decision))
            return ApiResponse<WorkApprovalRuleDto>.Fail("决策非法，可选值：allow | deny");

        var pathPattern = string.IsNullOrWhiteSpace(request.PathPattern) ? null : request.PathPattern.Trim().Replace('\\', '/');

        // 同工具 + 同路径模式只保留一条，避免规则抖动
        var existing = await _unitOfWork.WorkApprovalRules.FindAsync(
            r => r.ProjectId == projectId && r.ToolName == toolName && r.PathPattern == pathPattern, cancellationToken);
        if (existing.Count > 0)
        {
            var current = existing[0];
            current.Decision = decision;
            current.IsEnabled = true;
            current.UpdatedAt = DateTimeOffset.UtcNow;
            await _unitOfWork.WorkApprovalRules.UpdateAsync(current, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);
            return ApiResponse<WorkApprovalRuleDto>.Ok(Map(current));
        }

        var rule = new WorkApprovalRule
        {
            Id = Guid.NewGuid(),
            ProjectId = projectId,
            ToolName = toolName,
            PathPattern = pathPattern,
            Decision = decision,
            IsEnabled = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.WorkApprovalRules.AddAsync(rule, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<WorkApprovalRuleDto>.Ok(Map(rule));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var rule = await _unitOfWork.WorkApprovalRules.GetByIdAsync(id, cancellationToken);
        if (rule == null) return ApiResponse.Fail("规则不存在");

        await _unitOfWork.WorkApprovalRules.DeleteAsync(rule, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    private static WorkApprovalRuleDto Map(WorkApprovalRule rule) => new()
    {
        Id = rule.Id,
        ProjectId = rule.ProjectId,
        ToolName = rule.ToolName,
        PathPattern = rule.PathPattern,
        Decision = rule.Decision,
        IsEnabled = rule.IsEnabled,
        CreatedAt = rule.CreatedAt
    };
}

public class WorkCheckpointService : IWorkCheckpointService
{
    private const int MaxFilesPerCheckpoint = 200;
    private const long MaxFileBytes = 2 * 1024 * 1024;

    /// <summary>单个差异文件返回的最大字符数</summary>
    private const int MaxDiffFileChars = 200_000;

    /// <summary>一次差异响应返回内容的总字符预算</summary>
    private const long MaxDiffTotalChars = 2_000_000;

    private readonly IUnitOfWork _unitOfWork;

    public WorkCheckpointService(IUnitOfWork unitOfWork) => _unitOfWork = unitOfWork;

    public async Task<ApiResponse<List<WorkCheckpointDto>>> GetBySessionAsync(Guid sessionId, CancellationToken cancellationToken = default)
    {
        var checkpoints = await _unitOfWork.WorkCheckpoints.FindAsync(c => c.SessionId == sessionId, cancellationToken);
        var files = await _unitOfWork.WorkCheckpointFiles.GetAllAsync(cancellationToken);
        var byCheckpoint = files.GroupBy(f => f.CheckpointId).ToDictionary(g => g.Key, g => g.Select(f => f.FilePath).ToList());

        return ApiResponse<List<WorkCheckpointDto>>.Ok(checkpoints
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => new WorkCheckpointDto
            {
                Id = c.Id,
                SessionId = c.SessionId,
                Label = c.Label,
                Tools = c.Tools,
                FileCount = c.FileCount,
                Files = byCheckpoint.TryGetValue(c.Id, out var list) ? list : [],
                CreatedAt = c.CreatedAt
            })
            .ToList());
    }

    public async Task<ApiResponse<RestoreCheckpointResultDto>> RestoreAsync(Guid checkpointId, CancellationToken cancellationToken = default)
    {
        var checkpoint = await _unitOfWork.WorkCheckpoints.GetByIdAsync(checkpointId, cancellationToken);
        if (checkpoint == null) return ApiResponse<RestoreCheckpointResultDto>.Fail("检查点不存在");

        var project = await _unitOfWork.WorkProjects.GetByIdAsync(checkpoint.ProjectId, cancellationToken);
        if (project == null) return ApiResponse<RestoreCheckpointResultDto>.Fail("项目不存在");
        if (!Directory.Exists(project.RootPath)) return ApiResponse<RestoreCheckpointResultDto>.Fail("项目目录不存在，请检查路径");

        var files = await _unitOfWork.WorkCheckpointFiles.FindAsync(f => f.CheckpointId == checkpointId, cancellationToken);
        var result = new RestoreCheckpointResultDto { CheckpointId = checkpointId };

        foreach (var snapshot in files)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var full = WorkPath.Resolve(project.RootPath, snapshot.FilePath);
            if (full == null)
            {
                result.Errors.Add($"{snapshot.FilePath}: 路径超出项目范围");
                continue;
            }

            try
            {
                if (snapshot.Content == null)
                {
                    if (File.Exists(full))
                    {
                        File.Delete(full);
                        result.DeletedCount++;
                    }
                    continue;
                }

                var dir = Path.GetDirectoryName(full);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                await File.WriteAllTextAsync(full, snapshot.Content, cancellationToken);
                result.RestoredCount++;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                result.Errors.Add($"{snapshot.FilePath}: {ex.Message}");
            }
        }

        return ApiResponse<RestoreCheckpointResultDto>.Ok(result);
    }

    public async Task<ApiResponse<WorkCheckpointDiffDto>> GetDiffAsync(Guid checkpointId, CancellationToken cancellationToken = default)
    {
        var checkpoint = await _unitOfWork.WorkCheckpoints.GetByIdAsync(checkpointId, cancellationToken);
        if (checkpoint == null) return ApiResponse<WorkCheckpointDiffDto>.Fail("检查点不存在");

        var project = await _unitOfWork.WorkProjects.GetByIdAsync(checkpoint.ProjectId, cancellationToken);
        if (project == null) return ApiResponse<WorkCheckpointDiffDto>.Fail("项目不存在");

        var files = await _unitOfWork.WorkCheckpointFiles.FindAsync(f => f.CheckpointId == checkpointId, cancellationToken);
        var diff = new WorkCheckpointDiffDto
        {
            CheckpointId = checkpointId,
            Label = checkpoint.Label,
            TotalFiles = files.Count
        };

        var budget = MaxDiffTotalChars;
        foreach (var snapshot in files.OrderBy(f => f.FilePath, StringComparer.OrdinalIgnoreCase))
        {
            var full = WorkPath.Resolve(project.RootPath, snapshot.FilePath);
            string? current = null;
            var binary = false;
            var tooLarge = false;
            if (full != null && File.Exists(full))
            {
                try
                {
                    var info = new FileInfo(full);
                    // 先判体积再判二进制，避免超大文本文件被误报为二进制文件
                    if (info.Length > MaxFileBytes) tooLarge = true;
                    else if (!WorkProjectRules.IsProbablyText(full, MaxFileBytes)) binary = true;
                    else current = await File.ReadAllTextAsync(full, cancellationToken);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    current = null;
                }
            }

            // 二进制/超大文件不返回内容，只标注状态，避免撑爆内存与响应体
            if (binary || tooLarge)
            {
                diff.Files.Add(new WorkCheckpointDiffFileDto
                {
                    Path = snapshot.FilePath,
                    Action = "skipped",
                    IsBinary = binary,
                    Truncated = true,
                    Note = binary ? "二进制文件，已跳过内容比对" : $"文件超过 {MaxFileBytes / 1024 / 1024} MB，已跳过内容比对"
                });
                diff.Truncated = true;
                continue;
            }

            var action = snapshot.Content == current
                ? "unchanged"
                : snapshot.Content == null
                    ? "create"
                    : current == null
                        ? "delete"
                        : "write";

            // 单文件按行裁剪 + 整体字符预算，避免大仓库差异一次性撑爆内存与响应体
            var old = TrimContent(snapshot.Content, MaxDiffFileChars, out var oldTrimmed);
            var newTrimmed = false;
            var next = action == "unchanged" ? null : TrimContent(current, MaxDiffFileChars, out newTrimmed);
            var truncated = oldTrimmed || newTrimmed;

            if (truncated) diff.Truncated = true;
            diff.Files.Add(new WorkCheckpointDiffFileDto
            {
                Path = snapshot.FilePath,
                Action = action,
                OldContent = old,
                NewContent = next,
                Truncated = truncated,
                Note = truncated ? "内容过大，仅显示前部分" : null
            });

            budget -= Math.Max(old?.Length ?? 0, next?.Length ?? 0);
            if (budget <= 0)
            {
                diff.Truncated = true;
                break;
            }
        }

        return ApiResponse<WorkCheckpointDiffDto>.Ok(diff);
    }

    /// <summary>按行边界裁剪到最大长度，返回 null 表示无内容</summary>
    private static string? TrimContent(string? content, int maxChars, out bool truncated)
    {
        truncated = false;
        if (content == null) return null;
        if (content.Length <= maxChars) return content;

        truncated = true;
        var cut = content.LastIndexOf('\n', maxChars - 1);
        return content[..(cut > 0 ? cut : maxChars)];
    }

    public async Task<ApiResponse> DeleteAsync(Guid checkpointId, CancellationToken cancellationToken = default)
    {
        var checkpoint = await _unitOfWork.WorkCheckpoints.GetByIdAsync(checkpointId, cancellationToken);
        if (checkpoint == null) return ApiResponse.Fail("检查点不存在");

        var files = await _unitOfWork.WorkCheckpointFiles.FindAsync(f => f.CheckpointId == checkpointId, cancellationToken);
        foreach (var file in files) await _unitOfWork.WorkCheckpointFiles.DeleteAsync(file, cancellationToken);
        await _unitOfWork.WorkCheckpoints.DeleteAsync(checkpoint, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    public async Task<WorkCheckpoint?> CaptureAsync(
        Guid projectId,
        Guid sessionId,
        string label,
        IEnumerable<string> tools,
        IReadOnlyList<string> relativePaths,
        CancellationToken cancellationToken = default)
    {
        var project = await _unitOfWork.WorkProjects.GetByIdAsync(projectId, cancellationToken);
        if (project == null || !Directory.Exists(project.RootPath)) return null;

        var snapshots = new List<WorkCheckpointFile>();
        foreach (var relative in relativePaths.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (snapshots.Count >= MaxFilesPerCheckpoint) break;

            var full = WorkPath.Resolve(project.RootPath, relative);
            if (full == null) continue;

            string? content = null;
            try
            {
                if (File.Exists(full))
                {
                    var info = new FileInfo(full);
                    if (info.Length > MaxFileBytes) continue;
                    if (!WorkProjectRules.IsProbablyText(full)) continue;
                    content = await File.ReadAllTextAsync(full, cancellationToken);
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                continue;
            }

            snapshots.Add(new WorkCheckpointFile
            {
                Id = Guid.NewGuid(),
                FilePath = relative.Replace('\\', '/'),
                Content = content,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow
            });
        }

        if (snapshots.Count == 0) return null;

        var checkpoint = new WorkCheckpoint
        {
            Id = Guid.NewGuid(),
            ProjectId = projectId,
            SessionId = sessionId,
            Label = string.IsNullOrWhiteSpace(label) ? "工具批次" : label,
            Tools = string.Join(", ", tools.Distinct()),
            FileCount = snapshots.Count,
            Files = snapshots,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.WorkCheckpoints.AddAsync(checkpoint, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return checkpoint;
    }

    public async Task PruneAsync(Guid sessionId, int keep, CancellationToken cancellationToken = default)
    {
        if (keep < 1) keep = 1;
        var checkpoints = await _unitOfWork.WorkCheckpoints.FindAsync(c => c.SessionId == sessionId, cancellationToken);
        var stale = checkpoints.OrderByDescending(c => c.CreatedAt).Skip(keep).ToList();
        if (stale.Count == 0) return;

        var files = await _unitOfWork.WorkCheckpointFiles.GetAllAsync(cancellationToken);
        var staleIds = stale.Select(c => c.Id).ToHashSet();
        foreach (var file in files.Where(f => staleIds.Contains(f.CheckpointId)))
            await _unitOfWork.WorkCheckpointFiles.DeleteAsync(file, cancellationToken);
        foreach (var checkpoint in stale)
            await _unitOfWork.WorkCheckpoints.DeleteAsync(checkpoint, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
    }
}
