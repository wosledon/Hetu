using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;
using Hetu.Core.Services.Work;
using Hetu.Shared.Common;
using Hetu.Shared.Work;

namespace Hetu.Core.Services;

public class WorkProjectService : IWorkProjectService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly Microsoft.AspNetCore.DataProtection.IDataProtectionProvider? _dataProtection;
    private readonly ILocalizer _localizer;
    private readonly WorkWorktreeService _worktrees;

    public WorkProjectService(
        IUnitOfWork unitOfWork,
        ILocalizer localizer,
        WorkWorktreeService worktrees,
        Microsoft.AspNetCore.DataProtection.IDataProtectionProvider? dataProtection = null)
    {
        _unitOfWork = unitOfWork;
        _localizer = localizer;
        _worktrees = worktrees;
        _dataProtection = dataProtection;
    }

    private string Protect(string plaintext)
        => _dataProtection == null ? plaintext : Convert.ToBase64String(_dataProtection.CreateProtector("Hetu.Ssh").Protect(System.Text.Encoding.UTF8.GetBytes(plaintext)));

    public async Task<ApiResponse<List<WorkProjectDto>>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var projects = await _unitOfWork.WorkProjects.GetAllAsync(cancellationToken);
        var sessions = await _unitOfWork.WorkSessions.GetAllAsync(cancellationToken);
        var countByProject = sessions.GroupBy(s => s.ProjectId).ToDictionary(g => g.Key, g => g.Count());
        var (managedById, groupNames) = await LoadManagedAsync(cancellationToken);
        return ApiResponse<List<WorkProjectDto>>.Ok(projects
            .OrderBy(p => p.SortOrder)
            .ThenBy(p => p.Name)
            .Select(p => Map(p, countByProject.GetValueOrDefault(p.Id), null, managedById.GetValueOrDefault(p.ManagedProjectId ?? Guid.Empty), groupNames))
            .ToList());
    }

    public async Task<ApiResponse<WorkProjectDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var project = await _unitOfWork.WorkProjects.GetByIdAsync(id, cancellationToken);
        if (project == null) return ApiResponse<WorkProjectDto>.Fail(_localizer.T("project.notFound"));
        var count = (await _unitOfWork.WorkSessions.FindAsync(s => s.ProjectId == id, cancellationToken)).Count;
        var chunks = await _unitOfWork.WorkCodeChunks.FindAsync(c => c.ProjectId == id, cancellationToken);
        var (managedById, groupNames) = await LoadManagedAsync(cancellationToken);
        return ApiResponse<WorkProjectDto>.Ok(Map(project, count, BuildIndexStatus(chunks), managedById.GetValueOrDefault(project.ManagedProjectId ?? Guid.Empty), groupNames));
    }

    public async Task<ApiResponse<WorkProjectDto>> CreateAsync(CreateWorkProjectRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name)) return ApiResponse<WorkProjectDto>.Fail(_localizer.T("workProject.nameRequired"));
        if (string.IsNullOrWhiteSpace(request.RootPath)) return ApiResponse<WorkProjectDto>.Fail(_localizer.T("workProject.rootPathRequired"));

        var isRemote = request.ConnectionType == "Ssh";
        if (isRemote)
        {
            if (string.IsNullOrWhiteSpace(request.SshHost)) return ApiResponse<WorkProjectDto>.Fail(_localizer.T("project.sshHostRequired"));
            if (request.SshAuthType == "Password" && string.IsNullOrEmpty(request.SshPassword))
                return ApiResponse<WorkProjectDto>.Fail(_localizer.T("project.sshPasswordRequired"));
        }
        else if (!Directory.Exists(request.RootPath.Trim()))
        {
            return ApiResponse<WorkProjectDto>.Fail(_localizer.T("project.directoryNotExists"));
        }

        var project = new WorkProject
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            RootPath = request.RootPath.Trim(),
            ConnectionType = isRemote ? "Ssh" : "Local",
            SshHost = isRemote ? request.SshHost!.Trim() : null,
            SshPort = isRemote ? (request.SshPort <= 0 ? 22 : request.SshPort) : 22,
            SshUser = isRemote ? request.SshUser?.Trim() : null,
            SshAuthType = isRemote ? request.SshAuthType : "Key",
            SshKeyPath = isRemote ? request.SshKeyPath?.Trim() : null,
            Description = request.Description,
            Icon = request.Icon,
            Color = request.Color,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };
        if (isRemote && !string.IsNullOrEmpty(request.SshPassword) && _dataProtection != null)
            project.SshPasswordProtected = Protect(request.SshPassword);

        // 与项目管理互通：按目录找到已登记的项目，没有则代为登记
        var managed = await EnsureManagedProjectAsync(project, cancellationToken);
        project.ManagedProjectId = managed.Id;

        await _unitOfWork.WorkProjects.AddAsync(project, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        var (managedById, groupNames) = await LoadManagedAsync(cancellationToken);
        return ApiResponse<WorkProjectDto>.Ok(Map(project, 0, null, managedById.GetValueOrDefault(managed.Id), groupNames));
    }

    public async Task<ApiResponse<WorkProjectDto>> UpdateAsync(Guid id, UpdateWorkProjectRequest request, CancellationToken cancellationToken = default)
    {
        var project = await _unitOfWork.WorkProjects.GetByIdAsync(id, cancellationToken);
        if (project == null) return ApiResponse<WorkProjectDto>.Fail(_localizer.T("project.notFound"));

        if (!string.IsNullOrWhiteSpace(request.Name)) project.Name = request.Name.Trim();
        if (!string.IsNullOrWhiteSpace(request.RootPath))
        {
            if (project.ConnectionType != "Ssh" && !Directory.Exists(request.RootPath.Trim()))
                return ApiResponse<WorkProjectDto>.Fail(_localizer.T("project.directoryNotExists"));
            project.RootPath = request.RootPath.Trim();
        }
        project.Description = request.Description;
        project.Icon = request.Icon;
        project.Color = request.Color;
        project.SortOrder = request.SortOrder;
        if (request.McpServerIds != null)
            project.McpServerIds = request.McpServerIds.Count == 0 ? null : JsonSerializer.Serialize(request.McpServerIds);
        if (request.SkillIds != null)
            project.SkillIds = request.SkillIds.Count == 0 ? null : JsonSerializer.Serialize(request.SkillIds);
        project.DiagnosticsCommand = string.IsNullOrWhiteSpace(request.DiagnosticsCommand) ? null : request.DiagnosticsCommand.Trim();

        // SSH 连接信息更新
        if (!string.IsNullOrWhiteSpace(request.ConnectionType))
        {
            var wasRemote = project.ConnectionType == "Ssh";
            project.ConnectionType = request.ConnectionType == "Ssh" ? "Ssh" : "Local";
            if (!wasRemote && project.ConnectionType == "Ssh" && string.IsNullOrWhiteSpace(request.SshHost))
                return ApiResponse<WorkProjectDto>.Fail(_localizer.T("workProject.sshHostRequiredForSwitch"));
        }
        if (project.ConnectionType == "Ssh")
        {
            if (!string.IsNullOrWhiteSpace(request.SshHost)) project.SshHost = request.SshHost.Trim();
            if (request.SshPort is > 0) project.SshPort = request.SshPort.Value;
            if (request.SshUser != null) project.SshUser = request.SshUser.Trim();
            if (!string.IsNullOrWhiteSpace(request.SshAuthType)) project.SshAuthType = request.SshAuthType;
            if (request.SshKeyPath != null) project.SshKeyPath = request.SshKeyPath.Trim();
            if (request.SshPassword != null)
            {
                // 空字符串表示清除已存密码；非空则重新加密保存
                project.SshPasswordProtected = request.SshPassword.Length == 0 || _dataProtection == null
                    ? null
                    : Protect(request.SshPassword);
            }
        }
        project.UpdatedAt = DateTimeOffset.UtcNow;

        // 与项目管理互通：名称 / 目录 / SSH 信息同步到已登记条目
        var managed = project.ManagedProjectId is Guid managedId
            ? await _unitOfWork.ManagedProjects.GetByIdAsync(managedId, cancellationToken)
            : (await _unitOfWork.ManagedProjects.FindAsync(m => m.DirectoryPath == project.RootPath, cancellationToken)).FirstOrDefault();
        if (managed != null)
        {
            if (project.ManagedProjectId != managed.Id) project.ManagedProjectId = managed.Id;
            managed.Name = project.Name;
            managed.Description = project.Description;
            managed.ProjectType = project.ConnectionType == "Ssh" ? "Ssh" : "Local";
            managed.DirectoryPath = project.RootPath;
            SyncSshToManaged(managed, project);
            managed.UpdatedAt = DateTimeOffset.UtcNow;
            await _unitOfWork.ManagedProjects.UpdateAsync(managed, cancellationToken);
        }

        await _unitOfWork.WorkProjects.UpdateAsync(project, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        var count = (await _unitOfWork.WorkSessions.FindAsync(s => s.ProjectId == id, cancellationToken)).Count;
        var (managedById, groupNames) = await LoadManagedAsync(cancellationToken);
        return ApiResponse<WorkProjectDto>.Ok(Map(project, count, null, managedById.GetValueOrDefault(project.ManagedProjectId ?? Guid.Empty), groupNames));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var project = await _unitOfWork.WorkProjects.GetByIdAsync(id, cancellationToken);
        if (project == null) return ApiResponse.Fail(_localizer.T("project.notFound"));

        // 项目下的会话工作树一并清掉（失败不影响删项目本身）
        var sessions = await _unitOfWork.WorkSessions.FindAsync(s => s.ProjectId == id, cancellationToken);
        foreach (var session in sessions.Where(s => !string.IsNullOrWhiteSpace(s.WorktreePath)))
            await _worktrees.RemoveAsync(project.RootPath, session.WorktreePath!, cancellationToken);

        await _unitOfWork.WorkProjects.DeleteAsync(project, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    private static WorkProjectDto Map(WorkProject project, int sessionCount, WorkCodeIndexStatusDto? codeIndex = null, ManagedProject? managed = null, Dictionary<Guid, string>? groupNames = null) => new()
    {
        Id = project.Id,
        Name = project.Name,
        RootPath = project.RootPath,
        ConnectionType = project.ConnectionType,
        SshHost = project.ConnectionType == "Ssh" ? project.SshHost : null,
        SshPort = project.ConnectionType == "Ssh" ? project.SshPort : 22,
        SshUser = project.ConnectionType == "Ssh" ? project.SshUser : null,
        SshAuthType = project.ConnectionType == "Ssh" ? project.SshAuthType : "Key",
        SshKeyPath = project.ConnectionType == "Ssh" ? project.SshKeyPath : null,
        HasSshPassword = project.ConnectionType == "Ssh" && !string.IsNullOrEmpty(project.SshPasswordProtected),
        Description = project.Description,
        Icon = project.Icon,
        Color = project.Color,
        SortOrder = project.SortOrder,
        SessionCount = sessionCount,
        McpServerIds = ParseGuids(project.McpServerIds),
        SkillIds = ParseStrings(project.SkillIds),
        DiagnosticsCommand = project.DiagnosticsCommand,
        CodeIndex = codeIndex ?? new WorkCodeIndexStatusDto(),
        ManagedProjectId = project.ManagedProjectId,
        GroupId = managed?.GroupId,
        GroupName = managed?.GroupId is Guid gid ? groupNames?.GetValueOrDefault(gid) : null,
        Category = managed?.Category,
        Tags = DeserializeTags(managed?.Tags),
        CreatedAt = project.CreatedAt,
        UpdatedAt = project.UpdatedAt
    };

    /// <summary>受管项目按 ID 索引，并带上分组名，用于回填分组 / 分类 / 标签</summary>
    private async Task<(Dictionary<Guid, ManagedProject> ById, Dictionary<Guid, string> GroupNames)> LoadManagedAsync(CancellationToken cancellationToken)
    {
        var managed = await _unitOfWork.ManagedProjects.GetAllAsync(cancellationToken);
        var groups = await _unitOfWork.ProjectGroups.GetAllAsync(cancellationToken);
        return (managed.ToDictionary(m => m.Id), groups.ToDictionary(g => g.Id, g => g.Name));
    }

    /// <summary>按目录找到已登记的受管项目；没有则按工作项目信息代为登记</summary>
    private async Task<ManagedProject> EnsureManagedProjectAsync(WorkProject project, CancellationToken cancellationToken)
    {
        var managed = (await _unitOfWork.ManagedProjects.FindAsync(
            m => m.DirectoryPath == project.RootPath, cancellationToken)).FirstOrDefault();
        if (managed != null) return managed;

        var existing = await _unitOfWork.ManagedProjects.GetAllAsync(cancellationToken);
        var created = new ManagedProject
        {
            Id = Guid.NewGuid(),
            Name = project.Name,
            Description = project.Description,
            ProjectType = project.ConnectionType == "Ssh" ? "Ssh" : "Local",
            DirectoryPath = project.RootPath,
            SortOrder = existing.Count == 0 ? 0 : existing.Max(m => m.SortOrder) + 1,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        SyncSshToManaged(created, project);
        await _unitOfWork.ManagedProjects.AddAsync(created, cancellationToken);
        return created;
    }

    private static void SyncSshToManaged(ManagedProject managed, WorkProject project)
    {
        if (project.ConnectionType != "Ssh")
        {
            managed.SshHost = null;
            managed.SshPort = 22;
            managed.SshUser = null;
            managed.SshAuthType = "Key";
            managed.SshKeyPath = null;
            managed.SshPasswordProtected = null;
            return;
        }
        managed.SshHost = project.SshHost;
        managed.SshPort = project.SshPort is <= 0 or > 65535 ? 22 : project.SshPort;
        managed.SshUser = project.SshUser;
        managed.SshAuthType = project.SshAuthType;
        managed.SshKeyPath = project.SshKeyPath;
        managed.SshPasswordProtected = project.SshPasswordProtected;
    }

    private static List<string> DeserializeTags(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return JsonSerializer.Deserialize<List<string>>(json) ?? []; }
        catch (JsonException) { return []; }
    }

    private static WorkCodeIndexStatusDto BuildIndexStatus(IReadOnlyList<WorkCodeChunk> chunks) => new()
    {
        ChunkCount = chunks.Count,
        FileCount = chunks.Select(c => c.FilePath).Distinct(StringComparer.OrdinalIgnoreCase).Count(),
        IndexedAt = chunks.Count > 0 ? chunks.Max(c => c.UpdatedAt) : null
    };

    private static List<Guid> ParseGuids(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            return JsonSerializer.Deserialize<List<Guid>>(json) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static List<string> ParseStrings(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            return JsonSerializer.Deserialize<List<string>>(json) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }
}

public class WorkSessionService : IWorkSessionService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILocalizer _localizer;
    private readonly WorkWorktreeService _worktrees;
    private readonly WorktreeNameSuggester _namer;
    private readonly ILLMProviderFactory _llmProviderFactory;

    public WorkSessionService(
        IUnitOfWork unitOfWork,
        ILocalizer localizer,
        WorkWorktreeService worktrees,
        WorktreeNameSuggester namer,
        ILLMProviderFactory llmProviderFactory)
    {
        _unitOfWork = unitOfWork;
        _localizer = localizer;
        _worktrees = worktrees;
        _namer = namer;
        _llmProviderFactory = llmProviderFactory;
    }

    public async Task<ApiResponse<List<WorkSessionDto>>> GetByProjectAsync(Guid projectId, string? query = null, CancellationToken cancellationToken = default)
    {
        var sessions = await _unitOfWork.WorkSessions.FindAsync(s => s.ProjectId == projectId, cancellationToken);
        var messages = await _unitOfWork.WorkMessages.GetAllAsync(cancellationToken);
        var countBySession = messages.GroupBy(m => m.SessionId).ToDictionary(g => g.Key, g => g.Count());

        var keyword = query?.Trim();
        if (!string.IsNullOrEmpty(keyword))
        {
            var matchedSessionIds = messages
                .Where(m => m.Type == "text" && m.Content.Contains(keyword, StringComparison.OrdinalIgnoreCase))
                .Select(m => m.SessionId)
                .ToHashSet();

            sessions = sessions
                .Where(s => s.Title.Contains(keyword, StringComparison.OrdinalIgnoreCase) || matchedSessionIds.Contains(s.Id))
                .ToList();
        }

        return ApiResponse<List<WorkSessionDto>>.Ok(sessions
            .OrderByDescending(s => s.UpdatedAt)
            .Select(s => Map(s, countBySession.GetValueOrDefault(s.Id)))
            .ToList());
    }

    public async Task<ApiResponse<WorkSessionDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var session = await _unitOfWork.WorkSessions.GetByIdAsync(id, cancellationToken);
        if (session == null) return ApiResponse<WorkSessionDto>.Fail(_localizer.T("workSession.notFound"));
        var count = (await _unitOfWork.WorkMessages.FindAsync(m => m.SessionId == id, cancellationToken)).Count;
        return ApiResponse<WorkSessionDto>.Ok(Map(session, count));
    }

    public async Task<ApiResponse<WorkSessionDto>> CreateAsync(CreateWorkSessionRequest request, CancellationToken cancellationToken = default)
    {
        var project = await _unitOfWork.WorkProjects.GetByIdAsync(request.ProjectId, cancellationToken);
        if (project == null) return ApiResponse<WorkSessionDto>.Fail(_localizer.T("project.notFound"));

        var session = new WorkSession
        {
            Id = Guid.NewGuid(),
            ProjectId = request.ProjectId,
            Title = string.IsNullOrWhiteSpace(request.Title) ? _localizer.T("workSession.defaultTitle") : request.Title.Trim(),
            ModelId = request.ModelId,
            PermissionMode = WorkToolPolicy.IsValidValue(request.PermissionMode)
                ? request.PermissionMode!.Trim().ToLowerInvariant()
                : WorkToolPolicy.DefaultMode,
            AgentMode = AgentModePolicy.Normalize(request.AgentMode),
            // 工作树只记录意图，首次发消息时才创建（名字由模型按首条消息决定）
            UseWorktree = request.UseWorktree,
            BaseBranch = string.IsNullOrWhiteSpace(request.BaseBranch) ? null : request.BaseBranch.Trim(),
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.WorkSessions.AddAsync(session, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<WorkSessionDto>.Ok(Map(session, 0));
    }

    /// <summary>
    /// 会话首次发消息时准备独立工作树：用模型按用户输入起名（目录名 = 分支名），基分支取会话选择或项目当前分支。
    /// Data 为给用户看的提示文案（无需创建时为 null），Error 为失败原因（失败时调用方仍可继续在项目目录里跑）。
    /// </summary>
    public async Task<ApiResponse<string?>> EnsureWorktreeAsync(Guid sessionId, string? userMessage, CancellationToken cancellationToken = default)
    {
        var session = await _unitOfWork.WorkSessions.GetByIdAsync(sessionId, cancellationToken);
        if (session == null) return ApiResponse<string?>.Fail(_localizer.T("workSession.notFound"));
        if (!session.UseWorktree) return ApiResponse<string?>.Ok(null);
        if (!string.IsNullOrWhiteSpace(session.WorktreePath))
        {
            if (Directory.Exists(session.WorktreePath)) return ApiResponse<string?>.Ok(null);
            // 目录被手工删了：清掉记录后重建
            session.WorktreePath = null;
        }

        var project = await _unitOfWork.WorkProjects.GetByIdAsync(session.ProjectId, cancellationToken);
        if (project == null) return ApiResponse<string?>.Fail(_localizer.T("project.notFound"));
        if (project.ConnectionType == "Ssh") return ApiResponse<string?>.Fail(_localizer.T("workSession.worktreeLocalOnly"));
        if (string.IsNullOrWhiteSpace(project.RootPath) || !Directory.Exists(project.RootPath))
            return ApiResponse<string?>.Fail(_localizer.T("workSession.worktreeProjectMissing"));
        if (!await _worktrees.IsGitRepoAsync(project.RootPath, cancellationToken))
            return ApiResponse<string?>.Fail(_localizer.T("workSession.worktreeNotRepo"));

        var baseBranch = string.IsNullOrWhiteSpace(session.BaseBranch)
            ? await _worktrees.GetCurrentBranchAsync(project.RootPath, cancellationToken)
            : session.BaseBranch.Trim();

        var provider = await _llmProviderFactory.CreateChatProviderAsync(cancellationToken);
        var name = await _namer.SuggestAsync(userMessage, session.Id, provider, cancellationToken);

        // 名字冲突（目录或分支已存在）时加序号后缀，避免动到已有分支
        var branch = name;
        var worktreePath = await _worktrees.ResolvePathAsync(project.RootPath, branch, cancellationToken);
        for (var suffix = 2; suffix <= 20 && (Directory.Exists(worktreePath) || await _worktrees.BranchExistsAsync(project.RootPath, branch, cancellationToken)); suffix++)
        {
            branch = $"{name}-{suffix}";
            worktreePath = await _worktrees.ResolvePathAsync(project.RootPath, branch, cancellationToken);
        }

        var created = await _worktrees.CreateAsync(project.RootPath, worktreePath, branch, baseBranch, cancellationToken);
        if (!created.Ok) return ApiResponse<string?>.Fail(created.Error ?? _localizer.T("workSession.worktreeCreateFailed"));

        session.Branch = created.Branch;
        session.WorktreePath = worktreePath;
        session.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.WorkSessions.UpdateAsync(session, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<string?>.Ok(_localizer.T("workSession.worktreeCreated", Path.GetFileName(worktreePath), created.Branch ?? branch));
    }

    public async Task<ApiResponse<WorkSessionDto>> UpdateAsync(Guid id, UpdateWorkSessionRequest request, CancellationToken cancellationToken = default)
    {
        var session = await _unitOfWork.WorkSessions.GetByIdAsync(id, cancellationToken);
        if (session == null) return ApiResponse<WorkSessionDto>.Fail(_localizer.T("workSession.notFound"));

        if (!string.IsNullOrWhiteSpace(request.Title)) session.Title = request.Title.Trim();
        if (request.ModelId.HasValue) session.ModelId = request.ModelId;
        if (!string.IsNullOrWhiteSpace(request.PermissionMode))
        {
            if (!WorkToolPolicy.IsValidValue(request.PermissionMode))
                return ApiResponse<WorkSessionDto>.Fail(_localizer.T("workSession.invalidPermissionMode"));
            session.PermissionMode = request.PermissionMode.Trim().ToLowerInvariant();
        }
        if (!string.IsNullOrWhiteSpace(request.AgentMode))
        {
            if (!AgentModePolicy.IsValid(request.AgentMode))
                return ApiResponse<WorkSessionDto>.Fail(_localizer.T("workSession.invalidAgentMode"));
            session.AgentMode = AgentModePolicy.Normalize(request.AgentMode);
        }

        // 工作区切换：只是意图（首次发消息时才创建）；退回项目目录时清掉已有工作树
        var project = await _unitOfWork.WorkProjects.GetByIdAsync(session.ProjectId, cancellationToken);
        if (project == null) return ApiResponse<WorkSessionDto>.Fail(_localizer.T("project.notFound"));

        if (request.UseWorktree == false)
        {
            if (session.WorktreePath != null)
                await _worktrees.RemoveAsync(project.RootPath, session.WorktreePath, cancellationToken);
            session.WorktreePath = null;
            session.Branch = null;
            session.UseWorktree = false;
        }
        else if (request.UseWorktree == true)
        {
            session.UseWorktree = true;
        }
        if (request.BaseBranch != null)
            session.BaseBranch = string.IsNullOrWhiteSpace(request.BaseBranch) ? null : request.BaseBranch.Trim();

        // 主工作区模式：显式选分支就是检出分支（“当前分支”即所选分支）；工作树模式下它只是新分支的起点
        if (request.BaseBranch != null && !session.UseWorktree && !string.IsNullOrWhiteSpace(session.BaseBranch))
        {
            if (project.ConnectionType == "Ssh")
                return ApiResponse<WorkSessionDto>.Fail(_localizer.T("workSession.checkoutRemoteUnsupported"));
            var checkoutError = await _worktrees.CheckoutAsync(project.RootPath, session.BaseBranch, cancellationToken);
            if (checkoutError != null) return ApiResponse<WorkSessionDto>.Fail(checkoutError);
        }

        session.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.WorkSessions.UpdateAsync(session, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        var count = (await _unitOfWork.WorkMessages.FindAsync(m => m.SessionId == id, cancellationToken)).Count;
        return ApiResponse<WorkSessionDto>.Ok(Map(session, count));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var session = await _unitOfWork.WorkSessions.GetByIdAsync(id, cancellationToken);
        if (session == null) return ApiResponse.Fail(_localizer.T("workSession.notFound"));

        // 会话带独立工作树时一并清掉（失败不影响删除会话）
        if (!string.IsNullOrWhiteSpace(session.WorktreePath))
        {
            var project = await _unitOfWork.WorkProjects.GetByIdAsync(session.ProjectId, cancellationToken);
            if (project != null) await _worktrees.RemoveAsync(project.RootPath, session.WorktreePath, cancellationToken);
        }

        await _unitOfWork.WorkSessions.DeleteAsync(session, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    public async Task<ApiResponse<List<WorkMessageDto>>> GetMessagesAsync(Guid sessionId, CancellationToken cancellationToken = default)
    {
        var messages = await _unitOfWork.WorkMessages.FindAsync(m => m.SessionId == sessionId, cancellationToken);
        return ApiResponse<List<WorkMessageDto>>.Ok(messages.OrderBy(m => m.CreatedAt).Select(Map).ToList());
    }

    public async Task<List<WorkFileChangeDto>> GetFileChangesAsync(Guid sessionId, CancellationToken cancellationToken = default)
    {
        var changes = await _unitOfWork.WorkFileChanges.FindAsync(c => c.SessionId == sessionId, cancellationToken);
        return changes
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => new WorkFileChangeDto
            {
                Id = c.Id,
                ProjectId = c.ProjectId,
                SessionId = c.SessionId,
                FilePath = c.FilePath,
                OldContent = c.OldContent,
                NewContent = c.NewContent,
                Action = c.Action,
                CreatedAt = c.CreatedAt
            })
            .ToList();
    }

    public async Task<ApiResponse<WorkMessageDto>> AddMessageAsync(Guid sessionId, string role, string content, string type = "text", string? metadata = null, Guid? modelId = null, WorkMessageUsage? usage = null, CancellationToken cancellationToken = default)
    {
        var session = await _unitOfWork.WorkSessions.GetByIdAsync(sessionId, cancellationToken);
        if (session == null) return ApiResponse<WorkMessageDto>.Fail(_localizer.T("workSession.notFound"));

        // 首条用户消息自动生成标题
        if ((session.Title == "新会话" || session.Title == _localizer.T("workSession.defaultTitle")) && role == "user")
        {
            var existing = await _unitOfWork.WorkMessages.FindAsync(m => m.SessionId == sessionId, cancellationToken);
            if (existing.Count == 0)
            {
                var title = content.Trim();
                if (title.Length > 50) title = title[..50] + "...";
                session.Title = title;
            }
        }

        var message = new WorkMessage
        {
            Id = Guid.NewGuid(),
            SessionId = sessionId,
            Role = role,
            Content = content,
            Type = type,
            Metadata = metadata,
            ModelId = modelId,
            PromptTokens = usage?.PromptTokens,
            CompletionTokens = usage?.CompletionTokens,
            CachedTokens = usage?.CachedTokens,
            TotalTokens = usage?.TotalTokens,
            LatencyMs = usage?.LatencyMs,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        if (usage != null)
        {
            session.PromptTokens += usage.PromptTokens;
            session.CompletionTokens += usage.CompletionTokens;
            session.CachedTokens += usage.CachedTokens;
            session.TotalTokens += usage.TotalTokens;
            if (role == "assistant") session.TurnCount++;
        }

        await _unitOfWork.WorkMessages.AddAsync(message, cancellationToken);
        session.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.WorkSessions.UpdateAsync(session, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<WorkMessageDto>.Ok(Map(message));
    }

    public async Task AccumulateUsageAsync(Guid sessionId, WorkMessageUsage usage, CancellationToken cancellationToken = default)
    {
        var session = await _unitOfWork.WorkSessions.GetByIdAsync(sessionId, cancellationToken);
        if (session == null) return;

        session.PromptTokens += usage.PromptTokens;
        session.CompletionTokens += usage.CompletionTokens;
        session.CachedTokens += usage.CachedTokens;
        session.TotalTokens += usage.TotalTokens;
        session.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.WorkSessions.UpdateAsync(session, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
    }

    public async Task<ApiResponse<WorkMessageDto>> UpdateMessageAsync(Guid messageId, string content, CancellationToken cancellationToken = default)
    {
        var message = await _unitOfWork.WorkMessages.GetByIdAsync(messageId, cancellationToken);
        if (message == null) return ApiResponse<WorkMessageDto>.Fail(_localizer.T("workMessage.notFound"));

        message.Content = content;
        message.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.WorkMessages.UpdateAsync(message, cancellationToken);

        // 会话列表按 UpdatedAt 排序，编辑消息同样视为活跃
        var session = await _unitOfWork.WorkSessions.GetByIdAsync(message.SessionId, cancellationToken);
        if (session != null)
        {
            session.UpdatedAt = DateTimeOffset.UtcNow;
            await _unitOfWork.WorkSessions.UpdateAsync(session, cancellationToken);
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<WorkMessageDto>.Ok(Map(message));
    }

    public async Task<ApiResponse> DeleteMessageAsync(Guid messageId, CancellationToken cancellationToken = default)
    {
        var message = await _unitOfWork.WorkMessages.GetByIdAsync(messageId, cancellationToken);
        if (message == null) return ApiResponse.Fail(_localizer.T("workMessage.notFound"));

        await _unitOfWork.WorkMessages.DeleteAsync(message, cancellationToken);

        var session = await _unitOfWork.WorkSessions.GetByIdAsync(message.SessionId, cancellationToken);
        if (session != null)
        {
            session.UpdatedAt = DateTimeOffset.UtcNow;
            await _unitOfWork.WorkSessions.UpdateAsync(session, cancellationToken);
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    private static WorkSessionDto Map(WorkSession session, int messageCount) => new()
    {
        Id = session.Id,
        ProjectId = session.ProjectId,
        Title = session.Title,
        ModelId = session.ModelId,
        PermissionMode = string.IsNullOrWhiteSpace(session.PermissionMode) ? WorkToolPolicy.DefaultMode : session.PermissionMode,
        AgentMode = AgentModePolicy.Normalize(session.AgentMode),
        Branch = session.Branch,
        WorktreePath = session.WorktreePath,
        UseWorktree = session.UseWorktree,
        BaseBranch = session.BaseBranch,
        HasContextSummary = !string.IsNullOrWhiteSpace(session.ContextSummary),
        MessageCount = messageCount,
        TurnCount = session.TurnCount,
        PromptTokens = session.PromptTokens,
        CompletionTokens = session.CompletionTokens,
        CachedTokens = session.CachedTokens,
        TotalTokens = session.TotalTokens,
        CreatedAt = session.CreatedAt,
        UpdatedAt = session.UpdatedAt
    };

    private static WorkMessageDto Map(WorkMessage message) => new()
    {
        Id = message.Id,
        SessionId = message.SessionId,
        Role = message.Role,
        Content = message.Content,
        Type = message.Type,
        Metadata = message.Metadata,
        ModelId = message.ModelId,
        PromptTokens = message.PromptTokens,
        CompletionTokens = message.CompletionTokens,
        CachedTokens = message.CachedTokens,
        TotalTokens = message.TotalTokens,
        LatencyMs = message.LatencyMs,
        CreatedAt = message.CreatedAt
    };
}
