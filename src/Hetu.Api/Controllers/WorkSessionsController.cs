using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Shared.Common;
using Hetu.Shared.Context;
using Hetu.Shared.Work;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/work-sessions")]
public class WorkSessionsController : ControllerBase
{
    private readonly IWorkSessionService _sessionService;
    private readonly IWorkCheckpointService _checkpointService;
    private readonly ContextCompactionService _contextCompaction;
    private readonly IUnitOfWork _unitOfWork;

    public WorkSessionsController(
        IWorkSessionService sessionService,
        IWorkCheckpointService checkpointService,
        ContextCompactionService contextCompaction,
        IUnitOfWork unitOfWork)
    {
        _sessionService = sessionService;
        _checkpointService = checkpointService;
        _contextCompaction = contextCompaction;
        _unitOfWork = unitOfWork;
    }

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<WorkSessionDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _sessionService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<WorkSessionDto>> Create([FromBody] CreateWorkSessionRequest request, CancellationToken cancellationToken)
        => _sessionService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<WorkSessionDto>> Update(Guid id, [FromBody] UpdateWorkSessionRequest request, CancellationToken cancellationToken)
        => _sessionService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _sessionService.DeleteAsync(id, cancellationToken);

    [HttpGet("{id:guid}/messages")]
    public Task<ApiResponse<List<WorkMessageDto>>> GetMessages(Guid id, CancellationToken cancellationToken)
        => _sessionService.GetMessagesAsync(id, cancellationToken);

    [HttpGet("{id:guid}/file-changes")]
    public async Task<ApiResponse<List<WorkFileChangeDto>>> GetFileChanges(Guid id, CancellationToken cancellationToken)
    {
        var changes = await _sessionService.GetFileChangesAsync(id, cancellationToken);
        return ApiResponse<List<WorkFileChangeDto>>.Ok(changes);
    }

    [HttpPost("{id:guid}/messages")]
    public Task<ApiResponse<WorkMessageDto>> AddMessage(Guid id, [FromBody] AddWorkMessageRequest request, CancellationToken cancellationToken)
        => _sessionService.AddMessageAsync(id, request.Role, request.Content, request.Type, request.Metadata, cancellationToken: cancellationToken);

    /// <summary>编辑消息正文（与对话页一致的复制/编辑/删除能力）</summary>
    [HttpPut("messages/{messageId:guid}")]
    public Task<ApiResponse<WorkMessageDto>> UpdateMessage(Guid messageId, [FromBody] UpdateWorkMessageRequest request, CancellationToken cancellationToken)
        => _sessionService.UpdateMessageAsync(messageId, request.Content ?? string.Empty, cancellationToken);

    [HttpDelete("messages/{messageId:guid}")]
    public Task<ApiResponse> DeleteMessage(Guid messageId, CancellationToken cancellationToken)
        => _sessionService.DeleteMessageAsync(messageId, cancellationToken);

    /// <summary>上下文占用：窗口大小 + 系统提示/历史/摘要分块（供输入框右侧会话信息面板）</summary>
    [HttpGet("{id:guid}/context-usage")]
    public Task<ApiResponse<ContextUsageDto>> GetContextUsage(
        Guid id, [FromQuery] int? contextWindow, CancellationToken cancellationToken)
        => _contextCompaction.GetWorkUsageAsync(id, contextWindow, cancellationToken);

    /// <summary>手动压缩上下文（/compress）：调用当前大模型把较早的历史压成摘要</summary>
    [HttpPost("{id:guid}/compact")]
    public Task<ApiResponse<CompactContextResultDto>> Compact(
        Guid id, [FromBody] CompactContextRequest request, CancellationToken cancellationToken)
        => _contextCompaction.CompactWorkAsync(id, request ?? new CompactContextRequest(), cancellationToken);

    /// <summary>清除上下文摘要，恢复完整历史</summary>
    [HttpDelete("{id:guid}/compact")]
    public async Task<ApiResponse> ClearCompact(Guid id, CancellationToken cancellationToken)
    {
        var session = await _unitOfWork.WorkSessions.GetByIdAsync(id, cancellationToken);
        if (session == null) return ApiResponse.Fail("会话不存在");
        session.ContextSummary = null;
        session.ContextSummaryThroughMessageId = null;
        await _unitOfWork.WorkSessions.UpdateAsync(session, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    [HttpGet("{id:guid}/checkpoints")]
    public Task<ApiResponse<List<WorkCheckpointDto>>> GetCheckpoints(Guid id, CancellationToken cancellationToken)
        => _checkpointService.GetBySessionAsync(id, cancellationToken);
}

/// <summary>检查点相关接口（跨会话访问，按检查点 id 定位）</summary>
[ApiController]
[Route("api/work-checkpoints")]
public class WorkCheckpointsController : ControllerBase
{
    private readonly IWorkCheckpointService _checkpointService;

    public WorkCheckpointsController(IWorkCheckpointService checkpointService)
    {
        _checkpointService = checkpointService;
    }

    /// <summary>回滚到指定检查点：恢复快照内容，删除快照时并不存在的文件</summary>
    [HttpPost("{id:guid}/restore")]
    public Task<ApiResponse<RestoreCheckpointResultDto>> Restore(Guid id, CancellationToken cancellationToken)
        => _checkpointService.RestoreAsync(id, cancellationToken);

    /// <summary>对比检查点快照与当前工作区</summary>
    [HttpGet("{id:guid}/diff")]
    public Task<ApiResponse<WorkCheckpointDiffDto>> Diff(Guid id, CancellationToken cancellationToken)
        => _checkpointService.GetDiffAsync(id, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _checkpointService.DeleteAsync(id, cancellationToken);
}

public class AddWorkMessageRequest
{
    public string Role { get; set; } = "user";
    public string Content { get; set; } = string.Empty;
    public string Type { get; set; } = "text";
    public string? Metadata { get; set; }
}

public class UpdateWorkMessageRequest
{
    public string? Content { get; set; }
}
