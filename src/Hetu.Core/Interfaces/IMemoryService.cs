using Hetu.Shared.Chat;
using Hetu.Shared.Common;

namespace Hetu.Core.Interfaces;

public interface IMemoryService
{
    /// <summary>获取所有记忆（分页）</summary>
    Task<ApiResponse<PagedResult<MemoryDto>>> GetAllAsync(int page = 1, int pageSize = 50, CancellationToken cancellationToken = default);

    /// <summary>语义搜索记忆（带回归权重评分）</summary>
    Task<ApiResponse<List<MemoryDto>>> SearchAsync(string query, int topK = 10, CancellationToken cancellationToken = default);

    /// <summary>创建手动记忆</summary>
    Task<ApiResponse<MemoryDto>> CreateAsync(CreateMemoryRequest request, CancellationToken cancellationToken = default);

    /// <summary>更新记忆</summary>
    Task<ApiResponse<MemoryDto>> UpdateAsync(Guid id, UpdateMemoryRequest request, CancellationToken cancellationToken = default);

    /// <summary>删除记忆</summary>
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>从对话历史中提取记忆（使用快速模型）</summary>
    Task<ApiResponse<List<MemoryDto>>> ExtractFromConversationAsync(Guid topicId, CancellationToken cancellationToken = default);

    /// <summary>根据话题消息数判断是否需要提取记忆，若需要则自动提取</summary>
    Task<List<MemoryDto>> TryAutoExtractAsync(Guid topicId, CancellationToken cancellationToken = default);

    /// <summary>检索与当前输入相关的记忆（用于注入对话上下文）</summary>
    Task<List<MemoryDto>> RetrieveForContextAsync(string query, int topK = 5, CancellationToken cancellationToken = default);
}
