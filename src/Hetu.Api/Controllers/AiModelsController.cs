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

    public AiModelsController(IAiModelService aiModelService)
    {
        _aiModelService = aiModelService;
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
}
