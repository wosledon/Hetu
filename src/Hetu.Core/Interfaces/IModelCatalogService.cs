using Hetu.Shared.AI;
using Hetu.Shared.Common;

namespace Hetu.Core.Interfaces;

public interface IModelCatalogService
{
    /// <summary>
    /// 按关键词搜索 models.dev 模型目录（模型 ID / 名称 / 供应商名模糊匹配）。
    /// </summary>
    Task<ApiResponse<List<CatalogModelInfo>>> SearchAsync(string? keyword, int limit = 30, CancellationToken cancellationToken = default);

    /// <summary>
    /// 获取 models.dev 模型目录中的供应商列表。
    /// </summary>
    Task<ApiResponse<List<CatalogProviderInfo>>> GetProvidersAsync(CancellationToken cancellationToken = default);
}
