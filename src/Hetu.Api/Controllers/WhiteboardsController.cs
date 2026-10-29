using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Whiteboard;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>
/// 白板：画板的增删改查，场景（元素 + 视口）整体以 JSON 存取
/// </summary>
[ApiController]
[Route("api/whiteboards")]
public class WhiteboardsController : ControllerBase
{
    private readonly IWhiteboardService _whiteboardService;

    public WhiteboardsController(IWhiteboardService whiteboardService)
    {
        _whiteboardService = whiteboardService;
    }

    /// <summary>画板列表（按更新时间倒序）</summary>
    [HttpGet]
    public Task<ApiResponse<PagedResult<WhiteboardListItemDto>>> GetList(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default)
        => _whiteboardService.GetListAsync(page, pageSize, cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<WhiteboardDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _whiteboardService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<WhiteboardDto>> Create([FromBody] CreateWhiteboardRequest request, CancellationToken cancellationToken)
        => _whiteboardService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<WhiteboardDto>> Update(Guid id, [FromBody] UpdateWhiteboardRequest request, CancellationToken cancellationToken)
        => _whiteboardService.UpdateAsync(id, request, cancellationToken);

    /// <summary>软删除画板</summary>
    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _whiteboardService.DeleteAsync(id, cancellationToken);
}
