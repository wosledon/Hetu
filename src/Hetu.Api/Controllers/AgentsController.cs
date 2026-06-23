using Hetu.Core.Interfaces;
using Hetu.Shared.AI;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/agents")]
public class AgentsController : ControllerBase
{
    private readonly IAgentService _agentService;

    public AgentsController(IAgentService agentService)
    {
        _agentService = agentService;
    }

    [HttpGet]
    public Task<ApiResponse<List<AgentDto>>> GetAll(CancellationToken cancellationToken)
        => _agentService.GetAllAsync(cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<AgentDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _agentService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<AgentDto>> Create([FromBody] CreateAgentRequest request, CancellationToken cancellationToken)
        => _agentService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<AgentDto>> Update(Guid id, [FromBody] UpdateAgentRequest request, CancellationToken cancellationToken)
        => _agentService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _agentService.DeleteAsync(id, cancellationToken);
}
