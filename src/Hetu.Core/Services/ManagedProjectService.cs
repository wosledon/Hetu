using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Projects;

namespace Hetu.Core.Services;

/// <summary>
/// 受管项目目录服务：本地 / SSH 远程目录的登记、分组、归类与排序。
/// 只维护目录元数据，与 Code 工作区（WorkProject）相互独立。
/// </summary>
public class ManagedProjectService : IManagedProjectService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly Microsoft.AspNetCore.DataProtection.IDataProtectionProvider? _dataProtection;
    private readonly ILocalizer _localizer;

    public ManagedProjectService(IUnitOfWork unitOfWork, ILocalizer localizer, Microsoft.AspNetCore.DataProtection.IDataProtectionProvider? dataProtection = null)
    {
        _unitOfWork = unitOfWork;
        _localizer = localizer;
        _dataProtection = dataProtection;
    }

    public async Task<ApiResponse<List<ManagedProjectDto>>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var projects = await _unitOfWork.ManagedProjects.GetAllAsync(cancellationToken);
        var groups = await _unitOfWork.ProjectGroups.GetAllAsync(cancellationToken);
        var groupNames = groups.ToDictionary(g => g.Id, g => g.Name);
        var workProjectIdByManagedId = await LoadWorkProjectIdsAsync(cancellationToken);
        return ApiResponse<List<ManagedProjectDto>>.Ok(projects
            .OrderByDescending(p => p.IsPinned)
            .ThenBy(p => p.SortOrder)
            .ThenBy(p => p.Name, StringComparer.OrdinalIgnoreCase)
            .Select(p => Map(p, groupNames.GetValueOrDefault(p.GroupId ?? Guid.Empty), workProjectIdByManagedId.GetValueOrDefault(p.Id)))
            .ToList());
    }

    public async Task<ApiResponse<ManagedProjectDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var project = await _unitOfWork.ManagedProjects.GetByIdAsync(id, cancellationToken);
        if (project == null) return ApiResponse<ManagedProjectDto>.Fail(_localizer.T("project.notFound"));
        string? groupName = null;
        if (project.GroupId is Guid groupId)
            groupName = (await _unitOfWork.ProjectGroups.GetByIdAsync(groupId, cancellationToken))?.Name;
        var workProjectId = (await _unitOfWork.WorkProjects.FindAsync(w => w.ManagedProjectId == id, cancellationToken)).FirstOrDefault()?.Id;
        return ApiResponse<ManagedProjectDto>.Ok(Map(project, groupName, workProjectId));
    }

    public async Task<ApiResponse<ManagedProjectDto>> CreateAsync(CreateManagedProjectRequest request, CancellationToken cancellationToken = default)
    {
        var validation = await ValidateAsync(request.Name, request.ProjectType, request.DirectoryPath, request.SshHost, request.SshAuthType, request.SshPassword, request.GroupId, cancellationToken);
        if (validation != null) return ApiResponse<ManagedProjectDto>.Fail(validation);

        var project = new ManagedProject
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            Description = NormalizeText(request.Description),
            ProjectType = request.ProjectType == "Ssh" ? "Ssh" : "Local",
            DirectoryPath = request.DirectoryPath.Trim(),
            GroupId = request.GroupId,
            Category = NormalizeText(request.Category),
            Tags = SerializeTags(request.Tags),
            SortOrder = await NextSortOrderAsync(cancellationToken),
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        ApplySsh(project, request.ProjectType == "Ssh", request.SshHost, request.SshPort, request.SshUser, request.SshAuthType, request.SshKeyPath, request.SshPassword);

        await _unitOfWork.ManagedProjects.AddAsync(project, cancellationToken);
        // 与 Code 工作区互通：登记项目同步生成对应的工作项目
        await EnsureWorkProjectAsync(project, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return await GetByIdAsync(project.Id, cancellationToken);
    }

    public async Task<ApiResponse<ManagedProjectDto>> UpdateAsync(Guid id, UpdateManagedProjectRequest request, CancellationToken cancellationToken = default)
    {
        var project = await _unitOfWork.ManagedProjects.GetByIdAsync(id, cancellationToken);
        if (project == null) return ApiResponse<ManagedProjectDto>.Fail(_localizer.T("project.notFound"));

        var targetType = request.ProjectType == null ? project.ProjectType : (request.ProjectType == "Ssh" ? "Ssh" : "Local");
        var targetPath = string.IsNullOrWhiteSpace(request.DirectoryPath) ? project.DirectoryPath : request.DirectoryPath.Trim();
        var targetHost = targetType == "Ssh"
            ? (string.IsNullOrWhiteSpace(request.SshHost) ? project.SshHost : request.SshHost.Trim())
            : null;
        var targetAuth = targetType == "Ssh"
            ? (string.IsNullOrWhiteSpace(request.SshAuthType) ? project.SshAuthType : request.SshAuthType!)
            : "Key";
        // 密码：仅在「保持已有」时沿用旧值；新建密码校验由 ValidateAsync 完成
        var targetPassword = targetType == "Ssh" && targetAuth == "Password"
            ? (request.SshPassword ?? Decrypt(project.SshPasswordProtected))
            : null;

        var validation = await ValidateAsync(request.Name, targetType, targetPath, targetHost, targetAuth, targetPassword, request.GroupId, cancellationToken);
        if (validation != null) return ApiResponse<ManagedProjectDto>.Fail(validation);

        project.Name = request.Name.Trim();
        project.Description = NormalizeText(request.Description);
        project.ProjectType = targetType;
        project.DirectoryPath = targetPath;
        project.GroupId = request.GroupId;
        project.Category = NormalizeText(request.Category);
        project.Tags = SerializeTags(request.Tags);
        project.SortOrder = request.SortOrder;
        if (request.IsPinned is bool pinned) project.IsPinned = pinned;
        project.UpdatedAt = DateTimeOffset.UtcNow;

        if (targetType == "Ssh")
        {
            ApplySsh(project, true, targetHost, request.SshPort ?? project.SshPort, request.SshUser, targetAuth, request.SshKeyPath, request.SshPassword);
        }
        else
        {
            ClearSsh(project);
        }

        await _unitOfWork.ManagedProjects.UpdateAsync(project, cancellationToken);
        // 与 Code 工作区互通：名称 / 目录 / SSH 信息同步到对应工作项目
        await EnsureWorkProjectAsync(project, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return await GetByIdAsync(project.Id, cancellationToken);
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var project = await _unitOfWork.ManagedProjects.GetByIdAsync(id, cancellationToken);
        if (project == null) return ApiResponse.Fail(_localizer.T("project.notFound"));
        // 仅解除登记关系：Code 工作区项目（含会话）保留，避免误删工作数据
        var linkedWork = await _unitOfWork.WorkProjects.FindAsync(w => w.ManagedProjectId == id, cancellationToken);
        foreach (var work in linkedWork)
        {
            work.ManagedProjectId = null;
            await _unitOfWork.WorkProjects.UpdateAsync(work, cancellationToken);
        }
        await _unitOfWork.ManagedProjects.DeleteAsync(project, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    public async Task<ApiResponse> SortAsync(SortProjectsRequest request, CancellationToken cancellationToken = default)
    {
        if (request.Items.Count == 0) return ApiResponse.Ok();
        var ids = request.Items.Select(i => i.Id).ToHashSet();
        var projects = (await _unitOfWork.ManagedProjects.GetAllAsync(cancellationToken)).Where(p => ids.Contains(p.Id));
        var byId = request.Items.ToDictionary(i => i.Id);
        foreach (var project in projects)
        {
            project.SortOrder = byId[project.Id].SortOrder;
            await _unitOfWork.ManagedProjects.UpdateAsync(project, cancellationToken);
        }
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    public async Task<ApiResponse> MarkOpenedAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var project = await _unitOfWork.ManagedProjects.GetByIdAsync(id, cancellationToken);
        if (project == null) return ApiResponse.Fail(_localizer.T("project.notFound"));
        project.LastOpenedAt = DateTimeOffset.UtcNow;
        project.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.ManagedProjects.UpdateAsync(project, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    /// <summary>校验公共字段；通过返回 null，否则返回错误文案</summary>
    private async Task<string?> ValidateAsync(string name, string projectType, string directoryPath, string? sshHost, string sshAuthType, string? sshPassword, Guid? groupId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(name)) return _localizer.T("project.nameRequired");
        if (string.IsNullOrWhiteSpace(directoryPath)) return _localizer.T("project.directoryRequired");

        var isRemote = projectType == "Ssh";
        if (isRemote)
        {
            if (string.IsNullOrWhiteSpace(sshHost)) return _localizer.T("project.sshHostRequired");
            if (sshAuthType == "Password" && string.IsNullOrEmpty(sshPassword)) return _localizer.T("project.sshPasswordRequired");
        }
        else if (!Directory.Exists(directoryPath.Trim()))
        {
            return _localizer.T("project.directoryNotExists");
        }

        if (groupId is Guid gid && await _unitOfWork.ProjectGroups.GetByIdAsync(gid, cancellationToken) == null)
            return _localizer.T("project.groupNotFound");
        return null;
    }

    private async Task<int> NextSortOrderAsync(CancellationToken cancellationToken)
    {
        var projects = await _unitOfWork.ManagedProjects.GetAllAsync(cancellationToken);
        return projects.Count == 0 ? 0 : projects.Max(p => p.SortOrder) + 1;
    }

    private void ApplySsh(ManagedProject project, bool isRemote, string? host, int port, string? user, string authType, string? keyPath, string? password)
    {
        if (!isRemote)
        {
            ClearSsh(project);
            return;
        }
        project.SshHost = host?.Trim();
        project.SshPort = port is <= 0 or > 65535 ? 22 : port;
        project.SshUser = string.IsNullOrWhiteSpace(user) ? null : user.Trim();
        project.SshAuthType = authType;
        project.SshKeyPath = authType == "Key" ? (string.IsNullOrWhiteSpace(keyPath) ? null : keyPath.Trim()) : null;
        if (password != null)
            project.SshPasswordProtected = password.Length == 0 ? null : Protect(password);
        if (project.SshAuthType != "Password")
            project.SshPasswordProtected = null;
    }

    private static void ClearSsh(ManagedProject project)
    {
        project.SshHost = null;
        project.SshPort = 22;
        project.SshUser = null;
        project.SshAuthType = "Key";
        project.SshKeyPath = null;
        project.SshPasswordProtected = null;
    }

    private string Protect(string plaintext)
        => _dataProtection == null ? plaintext : Convert.ToBase64String(_dataProtection.CreateProtector("Hetu.Ssh").Protect(System.Text.Encoding.UTF8.GetBytes(plaintext)));

    private string? Decrypt(string? protectedValue)
    {
        if (string.IsNullOrEmpty(protectedValue) || _dataProtection == null) return null;
        try
        {
            return System.Text.Encoding.UTF8.GetString(_dataProtection.CreateProtector("Hetu.Ssh").Unprotect(Convert.FromBase64String(protectedValue)));
        }
        catch
        {
            return null;
        }
    }

    private static string? NormalizeText(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string? SerializeTags(List<string>? tags)
    {
        var clean = (tags ?? [])
            .Select(t => t.Trim())
            .Where(t => t.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        return clean.Count == 0 ? null : JsonSerializer.Serialize(clean);
    }

    private static List<string> DeserializeTags(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return JsonSerializer.Deserialize<List<string>>(json) ?? []; }
        catch { return []; }
    }

    private static ManagedProjectDto Map(ManagedProject project, string? groupName, Guid? workProjectId = null) => new()
    {
        Id = project.Id,
        Name = project.Name,
        Description = project.Description,
        ProjectType = project.ProjectType,
        DirectoryPath = project.DirectoryPath,
        SshHost = project.SshHost,
        SshPort = project.SshPort,
        SshUser = project.SshUser,
        SshAuthType = project.SshAuthType,
        SshKeyPath = project.SshKeyPath,
        HasSshPassword = !string.IsNullOrEmpty(project.SshPasswordProtected),
        GroupId = project.GroupId,
        GroupName = groupName,
        Category = project.Category,
        Tags = DeserializeTags(project.Tags),
        IsPinned = project.IsPinned,
        SortOrder = project.SortOrder,
        WorkProjectId = workProjectId,
        LastOpenedAt = project.LastOpenedAt,
        CreatedAt = project.CreatedAt,
        UpdatedAt = project.UpdatedAt,
    };

    /// <summary>受管项目 ID → Code 工作项目 ID</summary>
    private async Task<Dictionary<Guid, Guid>> LoadWorkProjectIdsAsync(CancellationToken cancellationToken)
    {
        var workProjects = await _unitOfWork.WorkProjects.GetAllAsync(cancellationToken);
        return workProjects
            .Where(w => w.ManagedProjectId != null)
            .ToDictionary(w => w.ManagedProjectId!.Value, w => w.Id);
    }

    /// <summary>
    /// 与 Code 工作区互通：找到（或创建）对应的工作项目，并同步名称 / 目录 / SSH 信息。
    /// 匹配优先按关联 ID，其次按目录路径，便于两侧各自创建后自动归并。
    /// </summary>
    private async Task EnsureWorkProjectAsync(ManagedProject project, CancellationToken cancellationToken)
    {
        var work = (await _unitOfWork.WorkProjects.FindAsync(
            w => w.ManagedProjectId == project.Id || w.RootPath == project.DirectoryPath, cancellationToken))
            .OrderByDescending(w => w.ManagedProjectId == project.Id)
            .FirstOrDefault();

        if (work == null)
        {
            var existing = await _unitOfWork.WorkProjects.GetAllAsync(cancellationToken);
            var created = new WorkProject
            {
                Id = Guid.NewGuid(),
                Name = project.Name,
                RootPath = project.DirectoryPath,
                ConnectionType = project.ProjectType == "Ssh" ? "Ssh" : "Local",
                ManagedProjectId = project.Id,
                Description = project.Description,
                SortOrder = existing.Count == 0 ? 0 : existing.Max(w => w.SortOrder) + 1,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            SyncSshToWorkProject(created, project);
            await _unitOfWork.WorkProjects.AddAsync(created, cancellationToken);
            return;
        }

        work.ManagedProjectId = project.Id;
        work.Name = project.Name;
        work.Description = project.Description;
        work.RootPath = project.DirectoryPath;
        work.ConnectionType = project.ProjectType == "Ssh" ? "Ssh" : "Local";
        SyncSshToWorkProject(work, project);
        work.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.WorkProjects.UpdateAsync(work, cancellationToken);
    }

    private static void SyncSshToWorkProject(WorkProject work, ManagedProject project)
    {
        if (project.ProjectType != "Ssh")
        {
            work.SshHost = null;
            work.SshPort = 22;
            work.SshUser = null;
            work.SshAuthType = "Key";
            work.SshKeyPath = null;
            work.SshPasswordProtected = null;
            return;
        }
        work.SshHost = project.SshHost;
        work.SshPort = project.SshPort is <= 0 or > 65535 ? 22 : project.SshPort;
        work.SshUser = project.SshUser;
        work.SshAuthType = project.SshAuthType;
        work.SshKeyPath = project.SshKeyPath;
        work.SshPasswordProtected = project.SshPasswordProtected;
    }
}
