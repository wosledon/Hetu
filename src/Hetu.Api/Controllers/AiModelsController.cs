using Hetu.Core.Interfaces;
using Hetu.Shared.AI;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/ai-models")]
public class AiModelsController : ControllerBase
{
    private readonly IAiModelService _aiModelService;
    private readonly IModelCatalogService _modelCatalogService;

    public AiModelsController(IAiModelService aiModelService, IModelCatalogService modelCatalogService)
    {
        _aiModelService = aiModelService;
        _modelCatalogService = modelCatalogService;
    }

    [HttpGet]
    public Task<ApiResponse<List<AiModelDto>>> GetAll(CancellationToken cancellationToken)
        => _aiModelService.GetAllAsync(cancellationToken);

    [HttpGet("provider/{providerId:guid}")]
    public Task<ApiResponse<List<AiModelDto>>> GetByProvider(Guid providerId, CancellationToken cancellationToken)
        => _aiModelService.GetByProviderAsync(providerId, cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<AiModelDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _aiModelService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<AiModelDto>> Create([FromBody] CreateAiModelRequest request, CancellationToken cancellationToken)
        => _aiModelService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<AiModelDto>> Update(Guid id, [FromBody] UpdateAiModelRequest request, CancellationToken cancellationToken)
        => _aiModelService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _aiModelService.DeleteAsync(id, cancellationToken);

    [HttpPost("{id:guid}/set-default")]
    public Task<ApiResponse> SetDefault(Guid id, CancellationToken cancellationToken)
        => _aiModelService.SetDefaultAsync(id, cancellationToken);

    /// <summary>
    /// 搜索 models.dev 开放模型目录（添加模型时自动填充能力配置）。
    /// </summary>
    [HttpGet("catalog/search")]
    public Task<ApiResponse<List<CatalogModelInfo>>> SearchCatalog([FromQuery] string? q, [FromQuery] int limit = 30, CancellationToken cancellationToken = default)
        => _modelCatalogService.SearchAsync(q, limit, cancellationToken);

    /// <summary>
    /// models.dev 模型目录中的供应商列表。
    /// </summary>
    [HttpGet("catalog/providers")]
    public Task<ApiResponse<List<CatalogProviderInfo>>> CatalogProviders(CancellationToken cancellationToken)
        => _modelCatalogService.GetProvidersAsync(cancellationToken);
}
