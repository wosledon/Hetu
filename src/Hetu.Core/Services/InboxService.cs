using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Notifications;

namespace Hetu.Core.Services;

/// <summary>
/// 收件箱：应用内通知的写入（按 CategoryKey 合并）、查询、已读/归档与批量操作。
/// 当前无接入场景，接口先对前端开放。
/// </summary>
public class InboxService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILocalizer _localizer;

    public InboxService(IUnitOfWork unitOfWork, ILocalizer localizer)
    {
        _unitOfWork = unitOfWork;
        _localizer = localizer;
    }

    /// <summary>分页查询通知（按最近更新倒序）</summary>
    public async Task<List<InboxNotificationDto>> GetAsync(
        string? category, bool archived, int page = 1, int pageSize = 50, CancellationToken ct = default)
    {
        var items = await _unitOfWork.InboxNotifications.FindAsync(
            n => n.IsArchived == archived && (category == null || n.Category == category), ct);

        return items
            .OrderByDescending(n => n.UpdatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(MapToDto)
            .ToList();
    }

    /// <summary>分类聚合（含未读数）</summary>
    public async Task<List<InboxCategoryDto>> GetCategoriesAsync(bool archived = false, CancellationToken ct = default)
    {
        var items = await _unitOfWork.InboxNotifications.FindAsync(n => n.IsArchived == archived, ct);

        return items
            .GroupBy(n => n.Category)
            .Select(g => new InboxCategoryDto
            {
                Category = g.Key,
                TotalCount = g.Count(),
                UnreadCount = g.Count(n => !n.IsRead),
            })
            .OrderByDescending(c => c.UnreadCount)
            .ThenByDescending(c => c.TotalCount)
            .ToList();
    }

    /// <summary>未归档未读数（导航角标）</summary>
    public async Task<int> GetUnreadCountAsync(CancellationToken ct = default)
    {
        var items = await _unitOfWork.InboxNotifications.FindAsync(n => !n.IsArchived && !n.IsRead, ct);
        return items.Count;
    }

    /// <summary>
    /// 写入通知。CategoryKey 非空且已有未归档通知时合并到该条（刷新内容、置顶、置为未读、累计次数），
    /// 否则新建——保证同一来源（如同一定时任务）只落在同一条里。
    /// </summary>
    public async Task<InboxNotificationDto> CreateAsync(CreateInboxNotificationRequest request, CancellationToken ct = default)
    {
        var category = string.IsNullOrWhiteSpace(request.Category) ? InboxCategories.System : request.Category.Trim();
        var categoryKey = request.CategoryKey?.Trim() ?? string.Empty;
        var level = string.IsNullOrWhiteSpace(request.Level) ? InboxLevels.Info : request.Level.Trim();
        var title = request.Title?.Trim() ?? string.Empty;
        var content = request.Content?.Trim();

        var now = DateTimeOffset.UtcNow;
        InboxNotification? notification;

        if (!string.IsNullOrEmpty(categoryKey))
        {
            var existing = await _unitOfWork.InboxNotifications.FindAsync(
                n => n.CategoryKey == categoryKey && !n.IsArchived, ct);
            notification = existing.FirstOrDefault();
        }
        else
        {
            notification = null;
        }

        if (notification != null)
        {
            notification.Category = category;
            notification.Level = level;
            notification.Title = title;
            notification.Content = content;
            notification.Link = request.Link;
            notification.IsRead = false;
            notification.IsArchived = false;
            notification.OccurrenceCount += 1;
            notification.UpdatedAt = now;
            await _unitOfWork.InboxNotifications.UpdateAsync(notification, ct);
        }
        else
        {
            notification = new InboxNotification
            {
                Id = Guid.NewGuid(),
                Category = category,
                CategoryKey = categoryKey,
                Level = level,
                Title = title,
                Content = content,
                Link = request.Link,
                OccurrenceCount = 1,
                CreatedAt = now,
                UpdatedAt = now,
            };
            await _unitOfWork.InboxNotifications.AddAsync(notification, ct);
        }

        await _unitOfWork.SaveChangesAsync(ct);
        return MapToDto(notification!);
    }

    /// <summary>标记已读/未读</summary>
    public async Task<ApiResponse> SetReadAsync(Guid id, bool isRead, CancellationToken ct = default)
        => await SetAsync(id, n => n.IsRead = isRead, ct);

    /// <summary>归档/取消归档</summary>
    public async Task<ApiResponse> SetArchivedAsync(Guid id, bool isArchived, CancellationToken ct = default)
        => await SetAsync(id, n => n.IsArchived = isArchived, ct);

    /// <summary>批量操作：read | unread | archive | unarchive | delete，返回影响条数</summary>
    public async Task<ApiResponse<int>> BatchAsync(InboxBatchRequest request, CancellationToken ct = default)
    {
        if (request.Ids.Count == 0) return ApiResponse<int>.Ok(0);

        var ids = request.Ids.ToHashSet();
        var items = await _unitOfWork.InboxNotifications.FindAsync(n => ids.Contains(n.Id), ct);
        var now = DateTimeOffset.UtcNow;
        var affected = 0;

        foreach (var item in items)
        {
            switch (request.Action)
            {
                case InboxBatchActions.Read:
                    item.IsRead = true;
                    break;
                case InboxBatchActions.Unread:
                    item.IsRead = false;
                    break;
                case InboxBatchActions.Archive:
                    item.IsArchived = true;
                    break;
                case InboxBatchActions.Unarchive:
                    item.IsArchived = false;
                    break;
                case InboxBatchActions.Delete:
                    item.IsDeleted = true;
                    item.IsArchived = true;
                    break;
                default:
                    return ApiResponse<int>.Fail(_localizer.T("inbox.unsupportedAction", request.Action));
            }
            item.UpdatedAt = now;
            await _unitOfWork.InboxNotifications.UpdateAsync(item, ct);
            affected++;
        }

        await _unitOfWork.SaveChangesAsync(ct);
        return ApiResponse<int>.Ok(affected);
    }

    /// <summary>删除（软删除）</summary>
    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var item = await _unitOfWork.InboxNotifications.GetByIdAsync(id, ct);
        if (item == null) return ApiResponse.Fail(_localizer.T("inbox.itemNotFound"));

        item.IsDeleted = true;
        item.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.InboxNotifications.UpdateAsync(item, ct);
        await _unitOfWork.SaveChangesAsync(ct);
        return ApiResponse.Ok();
    }

    private async Task<ApiResponse> SetAsync(Guid id, Action<InboxNotification> mutate, CancellationToken ct)
    {
        var item = await _unitOfWork.InboxNotifications.GetByIdAsync(id, ct);
        if (item == null) return ApiResponse.Fail(_localizer.T("inbox.itemNotFound"));

        mutate(item);
        item.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.InboxNotifications.UpdateAsync(item, ct);
        await _unitOfWork.SaveChangesAsync(ct);
        return ApiResponse.Ok();
    }

    private static InboxNotificationDto MapToDto(InboxNotification n) => new()
    {
        Id = n.Id,
        Category = n.Category,
        CategoryKey = n.CategoryKey,
        Level = n.Level,
        Title = n.Title,
        Content = n.Content,
        IsRead = n.IsRead,
        IsArchived = n.IsArchived,
        OccurrenceCount = n.OccurrenceCount,
        Link = n.Link,
        CreatedAt = n.CreatedAt,
        UpdatedAt = n.UpdatedAt,
    };
}
