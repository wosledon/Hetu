using Hetu.Shared.Common;
using Hetu.Shared.Projects;

namespace Hetu.Core.Interfaces;

/// <summary>
/// 项目 Wiki 服务：读取项目目录资料（本地文件系统或 SSH 远端），交由 LLM 规划并生成 DeepWiki 风格的多页文档。
/// 生成过程较长：入队后由后台任务执行，通过 <see cref="GetJobAsync"/> 轮询进度。
/// </summary>
public interface IWikiService
{
    /// <summary>查询 Wiki 页面；可按项目过滤，按套件聚合（新套件在前，套件内总览在前）</summary>
    Task<ApiResponse<List<WikiDocumentDto>>> GetAllAsync(Guid? projectId, CancellationToken cancellationToken = default);

    /// <summary>查询 Wiki 套件（含过期状态）；可按项目过滤</summary>
    Task<ApiResponse<List<WikiSetDto>>> GetSetsAsync(Guid? projectId, CancellationToken cancellationToken = default);

    Task<ApiResponse<WikiDocumentDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>入队一次 Wiki 生成；同一项目已有进行中任务时返回该任务</summary>
    Task<ApiResponse<WikiGenerationJobDto>> EnqueueGenerateAsync(Guid projectId, Guid? modelId, CancellationToken cancellationToken = default);

    /// <summary>查询生成任务；可按项目过滤，新的在前</summary>
    Task<ApiResponse<List<WikiGenerationJobDto>>> GetJobsAsync(Guid? projectId, CancellationToken cancellationToken = default);

    Task<ApiResponse<WikiGenerationJobDto>> GetJobAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>执行生成任务（后台处理器调用）：规划分页 → 并行生成主题页 → 生成总览</summary>
    Task RunGenerationAsync(Guid jobId, Guid? modelId, CancellationToken cancellationToken = default);

    /// <summary>用最新项目资料重生成单个页面（保留标题与要点）</summary>
    Task<ApiResponse<WikiDocumentDto>> RegeneratePageAsync(Guid id, CancellationToken cancellationToken = default);

    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>导出一套 Wiki 为 zip（每页一个 Markdown + 目录索引）</summary>
    Task<ApiResponse<byte[]>> ExportSetAsync(Guid setId, CancellationToken cancellationToken = default);
}
