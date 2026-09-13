using Hetu.Shared.Common;
using Hetu.Shared.Work;

namespace Hetu.Core.Interfaces;

/// <summary>
/// 工作项目代码语义索引：把仓库文本文件切块并生成向量，支持按语义检索代码。
/// </summary>
public interface IWorkCodeIndexService
{
    /// <summary>构建或增量更新项目索引</summary>
    /// <param name="projectId">项目 Id</param>
    /// <param name="force">true 时忽略文件 Hash，全量重建</param>
    Task<ApiResponse<WorkCodeIndexResultDto>> IndexProjectAsync(Guid projectId, bool force = false, CancellationToken cancellationToken = default);

    /// <summary>语义检索项目代码</summary>
    Task<ApiResponse<List<WorkCodeSearchHitDto>>> SearchAsync(Guid projectId, string query, int limit = 8, CancellationToken cancellationToken = default);

    /// <summary>查询索引状态</summary>
    Task<ApiResponse<WorkCodeIndexStatusDto>> GetStatusAsync(Guid projectId, CancellationToken cancellationToken = default);

    /// <summary>清空项目索引</summary>
    Task<ApiResponse> ClearAsync(Guid projectId, CancellationToken cancellationToken = default);
}
