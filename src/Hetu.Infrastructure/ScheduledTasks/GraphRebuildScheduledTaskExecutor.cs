using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Tasks;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.ScheduledTasks;

/// <summary>
/// 重建知识图谱的定时任务执行器：遍历所有笔记重新提取图谱
/// </summary>
public class GraphRebuildScheduledTaskExecutor : IScheduledTaskExecutor
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IGraphService _graphService;
    private readonly ILogger<GraphRebuildScheduledTaskExecutor> _logger;

    public GraphRebuildScheduledTaskExecutor(
        IUnitOfWork unitOfWork,
        IGraphService graphService,
        ILogger<GraphRebuildScheduledTaskExecutor> logger)
    {
        _unitOfWork = unitOfWork;
        _graphService = graphService;
        _logger = logger;
    }

    public string Kind => ScheduledTaskKinds.GraphRebuild;

    public async Task<string> ExecuteAsync(ScheduledTask task, CancellationToken cancellationToken = default)
    {
        var notes = await _unitOfWork.Notes.GetListAsync(includeDeleted: false, cancellationToken: cancellationToken);
        var success = 0;
        var failed = 0;

        _logger.LogInformation("开始重建知识图谱，共 {Count} 篇笔记", notes.Count);

        foreach (var note in notes)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var result = await _graphService.ExtractFromNoteAsync(note.Id, cancellationToken);
                if (result.Success) success++;
                else failed++;
            }
            catch
            {
                failed++;
            }
        }

        return $"图谱重建完成：成功 {success}，失败 {failed}";
    }
}
