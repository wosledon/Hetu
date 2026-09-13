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

    public WorkProjectService(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    public async Task<ApiResponse<List<WorkProjectDto>>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var projects = await _unitOfWork.WorkProjects.GetAllAsync(cancellationToken);
        var sessions = await _unitOfWork.WorkSessions.GetAllAsync(cancellationToken);
        var countByProject = sessions.GroupBy(s => s.ProjectId).ToDictionary(g => g.Key, g => g.Count());
        return ApiResponse<List<WorkProjectDto>>.Ok(projects
            .OrderBy(p => p.SortOrder)
            .ThenBy(p => p.Name)
            .Select(p => Map(p, countByProject.GetValueOrDefault(p.Id)))
            .ToList());
    }

    public async Task<ApiResponse<WorkProjectDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var project = await _unitOfWork.WorkProjects.GetByIdAsync(id, cancellationToken);
        if (project == null) return ApiResponse<WorkProjectDto>.Fail("项目不存在");
        var count = (await _unitOfWork.WorkSessions.FindAsync(s => s.ProjectId == id, cancellationToken)).Count;
        var chunks = await _unitOfWork.WorkCodeChunks.FindAsync(c => c.ProjectId == id, cancellationToken);
        return ApiResponse<WorkProjectDto>.Ok(Map(project, count, BuildIndexStatus(chunks)));
    }

    public async Task<ApiResponse<WorkProjectDto>> CreateAsync(CreateWorkProjectRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name)) return ApiResponse<WorkProjectDto>.Fail("项目名称不能为空");
        if (string.IsNullOrWhiteSpace(request.RootPath)) return ApiResponse<WorkProjectDto>.Fail("项目根目录不能为空");
        if (!Directory.Exists(request.RootPath.Trim())) return ApiResponse<WorkProjectDto>.Fail("项目目录不存在，请检查路径");

        var project = new WorkProject
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            RootPath = request.RootPath.Trim(),
            Description = request.Description,
            Icon = request.Icon,
            Color = request.Color,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.WorkProjects.AddAsync(project, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<WorkProjectDto>.Ok(Map(project, 0));
    }

    public async Task<ApiResponse<WorkProjectDto>> UpdateAsync(Guid id, UpdateWorkProjectRequest request, CancellationToken cancellationToken = default)
    {
        var project = await _unitOfWork.WorkProjects.GetByIdAsync(id, cancellationToken);
        if (project == null) return ApiResponse<WorkProjectDto>.Fail("项目不存在");

        if (!string.IsNullOrWhiteSpace(request.Name)) project.Name = request.Name.Trim();
        if (!string.IsNullOrWhiteSpace(request.RootPath))
        {
            if (!Directory.Exists(request.RootPath.Trim())) return ApiResponse<WorkProjectDto>.Fail("项目目录不存在，请检查路径");
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
        project.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.WorkProjects.UpdateAsync(project, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        var count = (await _unitOfWork.WorkSessions.FindAsync(s => s.ProjectId == id, cancellationToken)).Count;
        return ApiResponse<WorkProjectDto>.Ok(Map(project, count));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var project = await _unitOfWork.WorkProjects.GetByIdAsync(id, cancellationToken);
        if (project == null) return ApiResponse.Fail("项目不存在");

        await _unitOfWork.WorkProjects.DeleteAsync(project, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    private static WorkProjectDto Map(WorkProject project, int sessionCount, WorkCodeIndexStatusDto? codeIndex = null) => new()
    {
        Id = project.Id,
        Name = project.Name,
        RootPath = project.RootPath,
        Description = project.Description,
        Icon = project.Icon,
        Color = project.Color,
        SortOrder = project.SortOrder,
        SessionCount = sessionCount,
        McpServerIds = ParseGuids(project.McpServerIds),
        SkillIds = ParseStrings(project.SkillIds),
        DiagnosticsCommand = project.DiagnosticsCommand,
        CodeIndex = codeIndex ?? new WorkCodeIndexStatusDto(),
        CreatedAt = project.CreatedAt,
        UpdatedAt = project.UpdatedAt
    };

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
        session.ModelId = request.ModelId;
        if (!string.IsNullOrWhiteSpace(request.PermissionMode))
        {
            if (!WorkToolPolicy.IsValidValue(request.PermissionMode))
                return ApiResponse<WorkSessionDto>.Fail("权限模式非法，可选值：readonly | ask | auto | bypass");
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
