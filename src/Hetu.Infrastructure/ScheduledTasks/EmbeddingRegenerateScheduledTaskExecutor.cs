using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Tasks;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.ScheduledTasks;

/// <summary>
/// 重新生成全部笔记 Embedding 的定时任务执行器
/// </summary>
public class EmbeddingRegenerateScheduledTaskExecutor : IScheduledTaskExecutor
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly INoteEmbeddingService _embeddingService;
    private readonly ILogger<EmbeddingRegenerateScheduledTaskExecutor> _logger;

    public EmbeddingRegenerateScheduledTaskExecutor(
        IUnitOfWork unitOfWork,
        INoteEmbeddingService embeddingService,
        ILogger<EmbeddingRegenerateScheduledTaskExecutor> logger)
    {
        _unitOfWork = unitOfWork;
        _embeddingService = embeddingService;
        _logger = logger;
    }

    public string Kind => ScheduledTaskKinds.EmbeddingRegenerate;

    public async Task<string> ExecuteAsync(ScheduledTask task, CancellationToken cancellationToken = default)
    {
        var notes = await _unitOfWork.Notes.GetListAsync(includeDeleted: false, cancellationToken: cancellationToken);
        var success = 0;
        var failed = 0;

        _logger.LogInformation("开始重新生成 Embedding，共 {Count} 篇笔记", notes.Count);

        foreach (var note in notes)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                // 全量重建：忽略已有分块与向量，避免复用旧数据
                await _embeddingService.GenerateEmbeddingAsync(note.Id, cancellationToken, force: true);
                success++;
            }
            catch
            {
                failed++;
            }
        }

        return $"Embedding 重建完成：成功 {success}，失败 {failed}";
    }
}
