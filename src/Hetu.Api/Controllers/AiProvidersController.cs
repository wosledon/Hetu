using Hetu.Core.Interfaces;
using Hetu.Shared.AI;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/ai-providers")]
public class AiProvidersController : ControllerBase
{
    private readonly IAiProviderService _aiProviderService;

    public AiProvidersController(IAiProviderService aiProviderService)
    {
        _aiProviderService = aiProviderService;
    }

    [HttpGet]
    public Task<ApiResponse<List<AiProviderDto>>> GetAll(CancellationToken cancellationToken)
        => _aiProviderService.GetAllAsync(cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<AiProviderDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _aiProviderService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<AiProviderDto>> Create([FromBody] CreateAiProviderRequest request, CancellationToken cancellationToken)
        => _aiProviderService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<AiProviderDto>> Update(Guid id, [FromBody] UpdateAiProviderRequest request, CancellationToken cancellationToken)
        => _aiProviderService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _aiProviderService.DeleteAsync(id, cancellationToken);

    [HttpGet("default/{purpose}")]
    public Task<ApiResponse<AiProviderDto?>> GetDefault(string purpose, CancellationToken cancellationToken)
        => _aiProviderService.GetDefaultProviderAsync(purpose, cancellationToken);

    [HttpGet("{id:guid}/fetch-models")]
    public Task<ApiResponse<List<RemoteModelInfo>>> FetchModels(Guid id, CancellationToken cancellationToken)
        => _aiProviderService.FetchRemoteModelsAsync(id, cancellationToken);
}
