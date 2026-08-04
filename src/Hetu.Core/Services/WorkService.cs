using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
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
        return ApiResponse<WorkProjectDto>.Ok(Map(project, count));
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

    private static WorkProjectDto Map(WorkProject project, int sessionCount) => new()
    {
        Id = project.Id,
        Name = project.Name,
        RootPath = project.RootPath,
        Description = project.Description,
        Icon = project.Icon,
        Color = project.Color,
        SortOrder = project.SortOrder,
        SessionCount = sessionCount,
        CreatedAt = project.CreatedAt,
        UpdatedAt = project.UpdatedAt
    };
}

public class WorkSessionService : IWorkSessionService
{
    private readonly IUnitOfWork _unitOfWork;

    public WorkSessionService(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    public async Task<ApiResponse<List<WorkSessionDto>>> GetByProjectAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var sessions = await _unitOfWork.WorkSessions.FindAsync(s => s.ProjectId == projectId, cancellationToken);
        var messages = await _unitOfWork.WorkMessages.GetAllAsync(cancellationToken);
        var countBySession = messages.GroupBy(m => m.SessionId).ToDictionary(g => g.Key, g => g.Count());
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

    public async Task<ApiResponse<WorkMessageDto>> AddMessageAsync(Guid sessionId, string role, string content, string type = "text", string? metadata = null, Guid? modelId = null, CancellationToken cancellationToken = default)
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
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

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
        MessageCount = messageCount,
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
        CreatedAt = message.CreatedAt
    };
}
