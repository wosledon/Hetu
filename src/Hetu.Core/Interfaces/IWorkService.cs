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
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<List<WorkMessageDto>>> GetMessagesAsync(Guid sessionId, CancellationToken cancellationToken = default);
    Task<List<WorkFileChangeDto>> GetFileChangesAsync(Guid sessionId, CancellationToken cancellationToken = default);

    /// <summary>追加消息；传入 <paramref name="usage"/> 时同时记录本条 Token 消耗并累加到会话统计</summary>
    Task<ApiResponse<WorkMessageDto>> AddMessageAsync(Guid sessionId, string role, string content, string type = "text", string? metadata = null, Guid? modelId = null, WorkMessageUsage? usage = null, CancellationToken cancellationToken = default);
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
