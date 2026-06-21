using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/memories")]
public class MemoriesController : ControllerBase
{
    private readonly IMemoryService _memoryService;

    public MemoriesController(IMemoryService memoryService)
    {
        _memoryService = memoryService;
    }

    [HttpGet]
    public Task<ApiResponse<PagedResult<MemoryDto>>> GetAll([FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken cancellationToken = default)
        => _memoryService.GetAllAsync(page, pageSize, cancellationToken);

    [HttpPost("search")]
    public Task<ApiResponse<List<MemoryDto>>> Search([FromBody] MemorySearchRequest request, CancellationToken cancellationToken)
        => _memoryService.SearchAsync(request.Query, request.TopK, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<MemoryDto>> Create([FromBody] CreateMemoryRequest request, CancellationToken cancellationToken)
        => _memoryService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<MemoryDto>> Update(Guid id, [FromBody] UpdateMemoryRequest request, CancellationToken cancellationToken)
        => _memoryService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _memoryService.DeleteAsync(id, cancellationToken);

    [HttpPost("extract/{topicId:guid}")]
    public Task<ApiResponse<List<MemoryDto>>> Extract(Guid topicId, CancellationToken cancellationToken)
        => _memoryService.ExtractFromConversationAsync(topicId, cancellationToken);
}
