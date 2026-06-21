using Hetu.Shared.AI;
using Hetu.Shared.Common;

namespace Hetu.Core.Interfaces;

public interface IAiProviderService
{
    Task<ApiResponse<List<AiProviderDto>>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<AiProviderDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<AiProviderDto>> CreateAsync(CreateAiProviderRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<AiProviderDto>> UpdateAsync(Guid id, UpdateAiProviderRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<AiProviderDto?>> GetDefaultProviderAsync(string purpose, CancellationToken cancellationToken = default);
    /// <summary>
    /// 从远程 Provider API 自动获取可用模型列表
    /// </summary>
    Task<ApiResponse<List<RemoteModelInfo>>> FetchRemoteModelsAsync(Guid providerId, CancellationToken cancellationToken = default);
}
