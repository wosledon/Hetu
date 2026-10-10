using Hetu.Shared.Chat;
using Hetu.Shared.Common;
using Hetu.Shared.Settings;

namespace Hetu.Core.Interfaces;

public interface IMemoryService
{
    /// <summary>获取所有记忆（分页，可按作用域 Global/Session/Project 过滤）</summary>
    Task<ApiResponse<PagedResult<MemoryDto>>> GetAllAsync(int page = 1, int pageSize = 50, string? scope = null, CancellationToken cancellationToken = default);

    /// <summary>语义搜索记忆（带回归权重评分）</summary>
    Task<ApiResponse<List<MemoryDto>>> SearchAsync(string query, int topK = 10, CancellationToken cancellationToken = default);

    /// <summary>创建手动记忆</summary>
    Task<ApiResponse<MemoryDto>> CreateAsync(CreateMemoryRequest request, CancellationToken cancellationToken = default);

    /// <summary>更新记忆</summary>
    Task<ApiResponse<MemoryDto>> UpdateAsync(Guid id, UpdateMemoryRequest request, CancellationToken cancellationToken = default);

    /// <summary>删除记忆</summary>
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>从对话历史中提取记忆（使用快速模型），写入会话作用域</summary>
    Task<ApiResponse<List<MemoryDto>>> ExtractFromConversationAsync(Guid topicId, CancellationToken cancellationToken = default);

    /// <summary>根据话题消息数判断是否需要提取记忆，若需要则自动提取</summary>
    Task<List<MemoryDto>> TryAutoExtractAsync(Guid topicId, CancellationToken cancellationToken = default);

    /// <summary>
    /// 从 Code 会话（编码会话）历史中提取记忆，写入其关联受管项目的项目作用域；
    /// 会话未关联受管项目时不提取（避免把项目内事实写进全局记忆）。
    /// </summary>
    Task<ApiResponse<List<MemoryDto>>> ExtractFromWorkSessionAsync(Guid workSessionId, CancellationToken cancellationToken = default);

    /// <summary>根据 Code 会话消息数判断是否需要提取项目记忆，若需要则自动提取</summary>
    Task<List<MemoryDto>> TryAutoExtractWorkAsync(Guid workSessionId, CancellationToken cancellationToken = default);

    /// <summary>
    /// 检索与当前上下文相关的记忆（用于注入对话上下文）：
    /// 作用域过滤为「全局 ∪ 当前会话 ∪ 当前项目」，命中即强化（频率 +1、刷新近因）。
    /// </summary>
    Task<List<MemoryDto>> RetrieveForContextAsync(string query, int topK = 5, Guid? topicId = null, Guid? projectId = null, CancellationToken cancellationToken = default);

    /// <summary>读取 Dream（记忆巩固）配置</summary>
    Task<DreamConfigDto> GetDreamConfigAsync(CancellationToken cancellationToken = default);

    /// <summary>保存 Dream 配置</summary>
    Task SaveDreamConfigAsync(DreamConfigDto config, CancellationToken cancellationToken = default);

    /// <summary>
    /// 手动执行一次 Dream 记忆巩固：合并相似记忆 → 衰减久未想起的 → 遗忘极弱的。
    /// 自动模式由后台服务按配置周期调用同一方法。
    /// </summary>
    Task<ApiResponse<DreamResultDto>> DreamConsolidateAsync(CancellationToken cancellationToken = default);
}
