using Hetu.Shared.AI;
using Hetu.Shared.Common;

namespace Hetu.Core.Interfaces;

public interface IAiModelService
{
    Task<ApiResponse<List<AiModelDto>>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<List<AiModelDto>>> GetByProviderAsync(Guid providerId, CancellationToken cancellationToken = default);
    Task<ApiResponse<AiModelDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    /// <summary>
    /// 批量创建模型（模型目录导入）：同一 providerId 下跳过已存在的 modelId，
    /// 其余条目取第一条 isDefault 命中作为默认模型。
    /// </summary>
    Task<ApiResponse<List<AiModelDto>>> CreateBatchAsync(List<CreateAiModelRequest> requests, CancellationToken cancellationToken = default);
    Task<ApiResponse<AiModelDto>> CreateAsync(CreateAiModelRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<AiModelDto>> UpdateAsync(Guid id, UpdateAiModelRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse> SetDefaultAsync(Guid id, CancellationToken cancellationToken = default);
}
