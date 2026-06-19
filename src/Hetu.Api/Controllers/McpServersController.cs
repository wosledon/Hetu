using Hetu.Core.Interfaces;
using Hetu.Shared.AI;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/mcp-servers")]
public class McpServersController : ControllerBase
{
    private readonly IMcpService _mcpService;

    public McpServersController(IMcpService mcpService)
    {
        _mcpService = mcpService;
    }

    [HttpGet]
    public Task<ApiResponse<List<McpServerDto>>> GetAll(CancellationToken cancellationToken)
        => _mcpService.GetAllAsync(cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<McpServerDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _mcpService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<McpServerDto>> Create([FromBody] CreateMcpServerRequest request, CancellationToken cancellationToken)
        => _mcpService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<McpServerDto>> Update(Guid id, [FromBody] UpdateMcpServerRequest request, CancellationToken cancellationToken)
        => _mcpService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _mcpService.DeleteAsync(id, cancellationToken);

    [HttpGet("{id:guid}/tools")]
    public Task<ApiResponse<List<McpToolDto>>> ListTools(Guid id, CancellationToken cancellationToken)
        => _mcpService.ListToolsAsync(id, cancellationToken);

    [HttpPost("{id:guid}/tools/call")]
    public Task<ApiResponse<CallMcpToolResultDto>> CallTool(Guid id, [FromBody] CallMcpToolRequest request, CancellationToken cancellationToken)
        => _mcpService.CallToolAsync(id, request, cancellationToken);
}
