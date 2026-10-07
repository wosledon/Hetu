using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;
using Hetu.Shared.Common;
using Hetu.Shared.Work;

namespace Hetu.Core.Services;

public class WorkProjectService : IWorkProjectService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly Microsoft.AspNetCore.DataProtection.IDataProtectionProvider? _dataProtection;

    public WorkProjectService(IUnitOfWork unitOfWork, Microsoft.AspNetCore.DataProtection.IDataProtectionProvider? dataProtection = null)
    {
        _unitOfWork = unitOfWork;
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
        if (project == null) return ApiResponse<WorkProjectDto>.Fail("项目不存在");
        var count = (await _unitOfWork.WorkSessions.FindAsync(s => s.ProjectId == id, cancellationToken)).Count;
        var chunks = await _unitOfWork.WorkCodeChunks.FindAsync(c => c.ProjectId == id, cancellationToken);
        var (managedById, groupNames) = await LoadManagedAsync(cancellationToken);
        return ApiResponse<WorkProjectDto>.Ok(Map(project, count, BuildIndexStatus(chunks), managedById.GetValueOrDefault(project.ManagedProjectId ?? Guid.Empty), groupNames));
    }

    public async Task<ApiResponse<WorkProjectDto>> CreateAsync(CreateWorkProjectRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name)) return ApiResponse<WorkProjectDto>.Fail("项目名称不能为空");
        if (string.IsNullOrWhiteSpace(request.RootPath)) return ApiResponse<WorkProjectDto>.Fail("项目根目录不能为空");

        var isRemote = request.ConnectionType == "Ssh";
        if (isRemote)
        {
            if (string.IsNullOrWhiteSpace(request.SshHost)) return ApiResponse<WorkProjectDto>.Fail("SSH 主机地址不能为空");
            if (request.SshAuthType == "Password" && string.IsNullOrEmpty(request.SshPassword))
                return ApiResponse<WorkProjectDto>.Fail("密码认证需要填写密码");
        }
        else if (!Directory.Exists(request.RootPath.Trim()))
        {
            return ApiResponse<WorkProjectDto>.Fail("项目目录不存在，请检查路径");
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
        if (project == null) return ApiResponse<WorkProjectDto>.Fail("项目不存在");

        if (!string.IsNullOrWhiteSpace(request.Name)) project.Name = request.Name.Trim();
        if (!string.IsNullOrWhiteSpace(request.RootPath))
        {
            if (project.ConnectionType != "Ssh" && !Directory.Exists(request.RootPath.Trim()))
                return ApiResponse<WorkProjectDto>.Fail("项目目录不存在，请检查路径");
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
                return ApiResponse<WorkProjectDto>.Fail("切换为 SSH 项目需要填写主机地址");
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
        if (project == null) return ApiResponse.Fail("项目不存在");

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

    public WorkSessionService(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
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
        if (session == null) return ApiResponse<WorkSessionDto>.Fail("会话不存在");
        var count = (await _unitOfWork.WorkMessages.FindAsync(m => m.SessionId == id, cancellationToken)).Count;
        return ApiResponse<WorkSessionDto>.Ok(Map(session, count));
    }

    public async Task<ApiResponse<WorkSessionDto>> CreateAsync(CreateWorkSessionRequest request, CancellationToken cancellationToken = default)
    {
        var project = await _unitOfWork.WorkProjects.GetByIdAsync(request.ProjectId, cancellationToken);
        if (project == null) return ApiResponse<WorkSessionDto>.Fail("项目不存在");

        var session = new WorkSession
        {
            Id = Guid.NewGuid(),
            ProjectId = request.ProjectId,
            Title = string.IsNullOrWhiteSpace(request.Title) ? "新会话" : request.Title.Trim(),
            ModelId = request.ModelId,
            PermissionMode = WorkToolPolicy.IsValidValue(request.PermissionMode)
                ? request.PermissionMode!.Trim().ToLowerInvariant()
                : WorkToolPolicy.DefaultMode,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.WorkSessions.AddAsync(session, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<WorkSessionDto>.Ok(Map(session, 0));
    }

    public async Task<ApiResponse<WorkSessionDto>> UpdateAsync(Guid id, UpdateWorkSessionRequest request, CancellationToken cancellationToken = default)
    {
        var session = await _unitOfWork.WorkSessions.GetByIdAsync(id, cancellationToken);
        if (session == null) return ApiResponse<WorkSessionDto>.Fail("会话不存在");

        if (!string.IsNullOrWhiteSpace(request.Title)) session.Title = request.Title.Trim();
        if (request.ModelId.HasValue) session.ModelId = request.ModelId;
        if (!string.IsNullOrWhiteSpace(request.PermissionMode))
        {
            if (!WorkToolPolicy.IsValidValue(request.PermissionMode))
                return ApiResponse<WorkSessionDto>.Fail("权限模式非法，可选值：plan | readonly | ask | auto | bypass");
            session.PermissionMode = request.PermissionMode.Trim().ToLowerInvariant();
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
        if (session == null) return ApiResponse.Fail("会话不存在");

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
        if (session == null) return ApiResponse<WorkMessageDto>.Fail("会话不存在");

        // 首条用户消息自动生成标题
        if (session.Title == "新会话" && role == "user")
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

    private static WorkSessionDto Map(WorkSession session, int messageCount) => new()
    {
        Id = session.Id,
        ProjectId = session.ProjectId,
        Title = session.Title,
        ModelId = session.ModelId,
        PermissionMode = string.IsNullOrWhiteSpace(session.PermissionMode) ? WorkToolPolicy.DefaultMode : session.PermissionMode,
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
