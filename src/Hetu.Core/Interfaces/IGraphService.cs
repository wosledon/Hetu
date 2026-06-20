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
    Task<ApiResponse> MergeEntitiesAsync(MergeGraphEntitiesRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<List<string>>> GetEntityTypesAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<List<string>>> GetRelationTypesAsync(CancellationToken cancellationToken = default);
}
