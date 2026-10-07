using Hetu.Core.Services;
using Hetu.Shared.Common;
using Hetu.Shared.Notifications;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>
/// 收件箱：应用内通知的查询、写入与批量操作（已读/未读、归档/取消归档、删除）
/// </summary>
[ApiController]
[Route("api/inbox")]
public class InboxController : ControllerBase
{
    private readonly InboxService _inboxService;

    public InboxController(InboxService inboxService)
    {
        _inboxService = inboxService;
    }

    /// <summary>分页查询通知（archived=false 未归档；category 为空查全部）</summary>
    [HttpGet]
    public async Task<ApiResponse<List<InboxNotificationDto>>> Get(
        [FromQuery] bool archived = false,
        [FromQuery] string? category = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        var items = await _inboxService.GetAsync(category, archived, page, pageSize, ct);
        return ApiResponse<List<InboxNotificationDto>>.Ok(items);
    }

    /// <summary>分类聚合（含未读数，用于筛选栏）</summary>
    [HttpGet("categories")]
    public async Task<ApiResponse<List<InboxCategoryDto>>> GetCategories([FromQuery] bool archived = false, CancellationToken ct = default)
    {
        var items = await _inboxService.GetCategoriesAsync(archived, ct);
        return ApiResponse<List<InboxCategoryDto>>.Ok(items);
    }

    /// <summary>未归档未读数（导航角标）</summary>
    [HttpGet("unread-count")]
    public async Task<ApiResponse<int>> GetUnreadCount(CancellationToken ct = default)
    {
        var count = await _inboxService.GetUnreadCountAsync(ct);
        return ApiResponse<int>.Ok(count);
    }

    /// <summary>写入通知（相同 CategoryKey 且未归档时合并）</summary>
    [HttpPost]
    public async Task<ApiResponse<InboxNotificationDto>> Create([FromBody] CreateInboxNotificationRequest request, CancellationToken ct = default)
    {
        var item = await _inboxService.CreateAsync(request, ct);
        return ApiResponse<InboxNotificationDto>.Ok(item);
    }

    /// <summary>标记已读/未读</summary>
    [HttpPost("{id:guid}/read")]
    public Task<ApiResponse> MarkRead(Guid id, [FromBody] InboxStateRequest request, CancellationToken ct = default)
        => _inboxService.SetReadAsync(id, request.Value, ct);

    /// <summary>归档/取消归档</summary>
    [HttpPost("{id:guid}/archive")]
    public Task<ApiResponse> SetArchived(Guid id, [FromBody] InboxStateRequest request, CancellationToken ct = default)
        => _inboxService.SetArchivedAsync(id, request.Value, ct);

    /// <summary>批量操作：read | unread | archive | unarchive | delete</summary>
    [HttpPost("batch")]
    public Task<ApiResponse<int>> Batch([FromBody] InboxBatchRequest request, CancellationToken ct = default)
        => _inboxService.BatchAsync(request, ct);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken ct = default)
        => _inboxService.DeleteAsync(id, ct);
}
