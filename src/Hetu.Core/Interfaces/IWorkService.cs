using Hetu.Core.Entities;
using Hetu.Shared.Common;
using Hetu.Shared.Work;

namespace Hetu.Core.Interfaces;

public interface IWorkProjectService
{
    Task<ApiResponse<List<WorkProjectDto>>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<WorkProjectDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<WorkProjectDto>> CreateAsync(CreateWorkProjectRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<WorkProjectDto>> UpdateAsync(Guid id, UpdateWorkProjectRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
}

public interface IWorkSessionService
{
    Task<ApiResponse<List<WorkSessionDto>>> GetByProjectAsync(Guid projectId, string? query = null, CancellationToken cancellationToken = default);
    Task<ApiResponse<WorkSessionDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<WorkSessionDto>> CreateAsync(CreateWorkSessionRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<WorkSessionDto>> UpdateAsync(Guid id, UpdateWorkSessionRequest request, CancellationToken cancellationToken = default);

    /// <summary>
    /// 会话首次发消息时准备独立工作树（名字由模型按用户输入决定，基分支取会话选择或项目当前分支）。
    /// Data 为提示文案（无需创建时为 null），Error 为失败原因——失败时调用方仍可继续在项目目录里跑。
    /// </summary>
    Task<ApiResponse<string?>> EnsureWorktreeAsync(Guid sessionId, string? userMessage, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<List<WorkMessageDto>>> GetMessagesAsync(Guid sessionId, CancellationToken cancellationToken = default);
    Task<List<WorkFileChangeDto>> GetFileChangesAsync(Guid sessionId, CancellationToken cancellationToken = default);

    /// <summary>追加消息；传入 <paramref name="usage"/> 时同时记录本条 Token 消耗并累加到会话统计</summary>
    Task<ApiResponse<WorkMessageDto>> AddMessageAsync(Guid sessionId, string role, string content, string type = "text", string? metadata = null, Guid? modelId = null, WorkMessageUsage? usage = null, CancellationToken cancellationToken = default);

    /// <summary>只累加到会话统计，不写消息：用于消息上只记「首次请求上下文规模」时补齐整轮差额</summary>
    Task AccumulateUsageAsync(Guid sessionId, WorkMessageUsage usage, CancellationToken cancellationToken = default);

    /// <summary>修改一条消息正文（用户/助手文本消息，与对话页同样支持编辑）</summary>
    Task<ApiResponse<WorkMessageDto>> UpdateMessageAsync(Guid messageId, string content, CancellationToken cancellationToken = default);

    /// <summary>删除一条消息</summary>
    Task<ApiResponse> DeleteMessageAsync(Guid messageId, CancellationToken cancellationToken = default);
}

/// <summary>项目级工具审批规则（allow / deny）</summary>
public interface IWorkApprovalRuleService
{
    Task<ApiResponse<List<WorkApprovalRuleDto>>> GetByProjectAsync(Guid projectId, CancellationToken cancellationToken = default);
    Task<ApiResponse<WorkApprovalRuleDto>> CreateAsync(Guid projectId, CreateWorkApprovalRuleRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
}

/// <summary>会话检查点：快照、列表、回滚</summary>
public interface IWorkCheckpointService
{
    Task<ApiResponse<List<WorkCheckpointDto>>> GetBySessionAsync(Guid sessionId, CancellationToken cancellationToken = default);
    Task<ApiResponse<RestoreCheckpointResultDto>> RestoreAsync(Guid checkpointId, CancellationToken cancellationToken = default);

    /// <summary>比较检查点快照与当前工作区，返回逐文件差异</summary>
    Task<ApiResponse<WorkCheckpointDiffDto>> GetDiffAsync(Guid checkpointId, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid checkpointId, CancellationToken cancellationToken = default);

    /// <summary>快照一批文件（在写操作执行前调用），无有效文件时返回 null</summary>
    Task<WorkCheckpoint?> CaptureAsync(
        Guid projectId,
        Guid sessionId,
        string label,
        IEnumerable<string> tools,
        IReadOnlyList<string> relativePaths,
        CancellationToken cancellationToken = default);

    /// <summary>只保留最近 keep 个检查点</summary>
    Task PruneAsync(Guid sessionId, int keep, CancellationToken cancellationToken = default);
}
