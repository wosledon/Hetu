using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Infrastructure.Services;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/knowledge-items")]
public class KnowledgeItemsController : ControllerBase
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IBackgroundTaskQueue _taskQueue;
    private readonly IWebHostEnvironment _env;
    private readonly WebContentExtractor _webExtractor;

    public KnowledgeItemsController(
        IUnitOfWork unitOfWork,
        IBackgroundTaskQueue taskQueue,
        IWebHostEnvironment env,
        WebContentExtractor webExtractor)
    {
        _unitOfWork = unitOfWork;
        _taskQueue = taskQueue;
        _env = env;
        _webExtractor = webExtractor;
    }

    /// <summary>
    /// 获取所有知识项（支持类型筛选）
    /// </summary>
    [HttpGet]
    public async Task<ApiResponse<List<KnowledgeItemDto>>> GetList(
        [FromQuery] string? type,
        CancellationToken cancellationToken)
    {
        IReadOnlyList<KnowledgeItem> items;
        if (!string.IsNullOrEmpty(type) && Enum.TryParse<KnowledgeItemType>(type, true, out var itemType))
        {
            items = await _unitOfWork.KnowledgeItems.GetByTypeAsync(itemType, cancellationToken);
        }
        else
        {
            items = await _unitOfWork.KnowledgeItems.GetAllAsync(cancellationToken);
        }

        var result = items.Select(MapToDto).ToList();
        return ApiResponse<List<KnowledgeItemDto>>.Ok(result);
    }

    /// <summary>
    /// 获取单个知识项
    /// </summary>
    [HttpGet("{id:guid}")]
    public async Task<ApiResponse<KnowledgeItemDto>> GetById(Guid id, CancellationToken cancellationToken)
    {
        var item = await _unitOfWork.KnowledgeItems.GetByIdAsync(id, cancellationToken);
        if (item == null)
            return ApiResponse<KnowledgeItemDto>.Fail("知识项不存在");

        return ApiResponse<KnowledgeItemDto>.Ok(MapToDto(item));
    }

    /// <summary>
    /// 添加网址类型知识项（自动抓取网页内容）
    /// </summary>
    [HttpPost("url")]
    public async Task<ApiResponse<KnowledgeItemDto>> AddUrl(
        [FromBody] AddUrlRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Url))
            return ApiResponse<KnowledgeItemDto>.Fail("URL 不能为空");

        var item = new KnowledgeItem
        {
            Type = KnowledgeItemType.Url,
            Title = request.Title ?? request.Url,
            Content = request.Content ?? string.Empty,
            SourceUrl = request.Url,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };

        // 如果没有提供内容，自动抓取网页（失败不阻塞）
        if (string.IsNullOrWhiteSpace(item.Content))
        {
            try
            {
                var result = await _webExtractor.ExtractAsync(request.Url, cancellationToken);
                if (result.Success)
                {
                    item.Title = request.Title ?? result.Title ?? request.Url;
                    item.Content = result.Content;
                }
            }
            catch
            {
                // 抓取失败时仍创建知识项，内容为空，后续可手动补充
            }
        }

        await _unitOfWork.KnowledgeItems.AddAsync(item, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 自动生成索引
        if (!string.IsNullOrWhiteSpace(item.Content))
        {
            await _taskQueue.QueueAsync(
                new BackgroundWorkItem(BackgroundTaskType.GenerateKnowledgeItemEmbedding, item.Id),
                cancellationToken);
        }

        return ApiResponse<KnowledgeItemDto>.Ok(MapToDto(item));
    }

    /// <summary>
    /// 上传文件类型知识项
    /// </summary>
    [HttpPost("file")]
    public async Task<ApiResponse<KnowledgeItemDto>> UploadFile(
        IFormFile file,
        [FromForm] string? title,
        CancellationToken cancellationToken)
    {
        if (file == null || file.Length == 0)
            return ApiResponse<KnowledgeItemDto>.Fail("文件不能为空");

        // 保存文件
        var uploadsDir = Path.Combine(_env.ContentRootPath, "uploads", "knowledge");
        Directory.CreateDirectory(uploadsDir);

        var fileName = $"{Guid.NewGuid()}_{file.FileName}";
        var filePath = Path.Combine(uploadsDir, fileName);

        await using (var stream = new FileStream(filePath, FileMode.Create))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        // 提取文本内容
        var content = await FileContentExtractor.ExtractAsync(filePath, file.ContentType, cancellationToken);

        var item = new KnowledgeItem
        {
            Type = KnowledgeItemType.File,
            Title = title ?? file.FileName,
            Content = content,
            FilePath = filePath,
            FileName = file.FileName,
            FileSize = file.Length,
            MimeType = file.ContentType,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };

        await _unitOfWork.KnowledgeItems.AddAsync(item, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 自动生成索引
        if (!string.IsNullOrWhiteSpace(content))
        {
            await _taskQueue.QueueAsync(
                new BackgroundWorkItem(BackgroundTaskType.GenerateKnowledgeItemEmbedding, item.Id),
                cancellationToken);
        }

        return ApiResponse<KnowledgeItemDto>.Ok(MapToDto(item));
    }

    /// <summary>
    /// 更新知识项
    /// </summary>
    [HttpPut("{id:guid}")]
    public async Task<ApiResponse<KnowledgeItemDto>> Update(
        Guid id,
        [FromBody] UpdateKnowledgeItemRequest request,
        CancellationToken cancellationToken)
    {
        var item = await _unitOfWork.KnowledgeItems.GetByIdAsync(id, cancellationToken);
        if (item == null)
            return ApiResponse<KnowledgeItemDto>.Fail("知识项不存在");

        if (!string.IsNullOrWhiteSpace(request.Title))
            item.Title = request.Title;

        if (request.Content != null)
            item.Content = request.Content;

        item.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.KnowledgeItems.UpdateAsync(item, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return ApiResponse<KnowledgeItemDto>.Ok(MapToDto(item));
    }

    /// <summary>
    /// 删除知识项
    /// </summary>
    [HttpDelete("{id:guid}")]
    public async Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
    {
        var item = await _unitOfWork.KnowledgeItems.GetByIdAsync(id, cancellationToken);
        if (item == null)
            return ApiResponse.Fail("知识项不存在");

        // 删除关联的分块
        await _unitOfWork.KnowledgeItems.DeleteChunksAsync(id, cancellationToken);

        // 如果是文件类型，删除物理文件
        if (item.Type == KnowledgeItemType.File && !string.IsNullOrEmpty(item.FilePath) && System.IO.File.Exists(item.FilePath))
        {
            System.IO.File.Delete(item.FilePath);
        }

        await _unitOfWork.KnowledgeItems.DeleteAsync(item, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return ApiResponse.Ok();
    }

    private static KnowledgeItemDto MapToDto(KnowledgeItem item) => new()
    {
        Id = item.Id,
        Type = item.Type.ToString().ToLower(),
        Title = item.Title,
        Content = item.Content.Length > 200 ? item.Content[..200] + "..." : item.Content,
        SourceUrl = item.SourceUrl,
        FileName = item.FileName,
        FileSize = item.FileSize,
        MimeType = item.MimeType,
        NoteId = item.NoteId,
        CreatedAt = item.CreatedAt,
        UpdatedAt = item.UpdatedAt,
    };
}

// ── Request / DTO ──

public class AddUrlRequest
{
    public string Url { get; set; } = string.Empty;
    public string? Title { get; set; }
    public string? Content { get; set; }
}

public class UpdateKnowledgeItemRequest
{
    public string? Title { get; set; }
    public string? Content { get; set; }
}

public class KnowledgeItemDto
{
    public Guid Id { get; set; }
    public string Type { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string? SourceUrl { get; set; }
    public string? FileName { get; set; }
    public long? FileSize { get; set; }
    public string? MimeType { get; set; }
    public Guid? NoteId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
