using Hetu.Shared.Common;
using Hetu.Shared.Graph;
using Microsoft.AspNetCore.Http;

namespace Hetu.Core.Interfaces;

public interface IGraphService
{
    Task<ApiResponse<GraphDataDto>> GetGraphAsync(CancellationToken cancellationToken = default);
    Task StreamGraphAsync(HttpContext httpContext, CancellationToken cancellationToken = default);
    Task<ApiResponse<GraphEntityDetailDto>> GetEntityByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<GraphEntityDto>> CreateEntityAsync(CreateGraphEntityRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<GraphEntityDto>> UpdateEntityAsync(Guid id, UpdateGraphEntityRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteEntityAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<GraphRelationDto>> CreateRelationAsync(CreateGraphRelationRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteRelationAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<ExtractGraphResultDto>> ExtractFromNoteAsync(Guid noteId, CancellationToken cancellationToken = default);
    /// <summary>从项目 Wiki 页面抽取实体与关系，关系记在该页面名下</summary>
    Task<ApiResponse<ExtractGraphResultDto>> ExtractFromWikiAsync(Guid wikiDocumentId, CancellationToken cancellationToken = default);
    Task<ApiResponse> MergeEntitiesAsync(MergeGraphEntitiesRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<List<string>>> GetEntityTypesAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<List<string>>> GetRelationTypesAsync(CancellationToken cancellationToken = default);
    Task CleanUpByNoteIdAsync(Guid noteId, CancellationToken cancellationToken = default);
    /// <summary>清理 Wiki 页面（或整套 Wiki）抽取出的关系</summary>
    Task CleanUpByWikiDocumentIdsAsync(IReadOnlyCollection<Guid> wikiDocumentIds, CancellationToken cancellationToken = default);
    Task RestoreByNoteIdAsync(Guid noteId, CancellationToken cancellationToken = default);
    Task<ApiResponse<List<GraphEntityDto>>> SearchEntitiesAsync(string query, string? type = null, int topK = 10, CancellationToken cancellationToken = default);
}
