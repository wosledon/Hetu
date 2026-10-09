using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Projects;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>
/// 项目 Wiki：为「项目」页登记的项目生成 DeepWiki 风格多页文档（总览 + 主题页 + 图表）。
/// 生成耗时较长：POST 入队后返回任务，前端轮询任务进度，完成后按套件阅读。
/// </summary>
[ApiController]
[Route("api/wiki")]
public class WikiController : ControllerBase
{
    private readonly IWikiService _wikiService;

    public WikiController(IWikiService wikiService)
    {
        _wikiService = wikiService;
    }

    /// <summary>Wiki 页面列表；可按项目过滤，按套件聚合</summary>
    [HttpGet]
    public Task<ApiResponse<List<WikiDocumentDto>>> GetAll(Guid? projectId, CancellationToken cancellationToken)
        => _wikiService.GetAllAsync(projectId, cancellationToken);

    /// <summary>Wiki 套件列表（含过期状态与页面清单）；可按项目过滤</summary>
    [HttpGet("sets")]
    public Task<ApiResponse<List<WikiSetDto>>> GetSets(Guid? projectId, CancellationToken cancellationToken)
        => _wikiService.GetSetsAsync(projectId, cancellationToken);

    /// <summary>生成任务列表；可按项目过滤</summary>
    [HttpGet("jobs")]
    public Task<ApiResponse<List<WikiGenerationJobDto>>> GetJobs(Guid? projectId, CancellationToken cancellationToken)
        => _wikiService.GetJobsAsync(projectId, cancellationToken);

    [HttpGet("jobs/{id:guid}")]
    public Task<ApiResponse<WikiGenerationJobDto>> GetJob(Guid id, CancellationToken cancellationToken)
        => _wikiService.GetJobAsync(id, cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<WikiDocumentDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _wikiService.GetByIdAsync(id, cancellationToken);

    /// <summary>入队一次 Wiki 生成；同一项目已有进行中任务时返回该任务</summary>
    [HttpPost("projects/{projectId:guid}/generate")]
    public Task<ApiResponse<WikiGenerationJobDto>> Generate(Guid projectId, [FromBody] GenerateWikiRequest? request, CancellationToken cancellationToken)
        => _wikiService.EnqueueGenerateAsync(projectId, request?.ModelId, cancellationToken);

    /// <summary>用最新项目资料重生成单个页面</summary>
    [HttpPost("{id:guid}/regenerate")]
    public Task<ApiResponse<WikiDocumentDto>> Regenerate(Guid id, CancellationToken cancellationToken)
        => _wikiService.RegeneratePageAsync(id, cancellationToken);

    /// <summary>导出一套 Wiki 为 zip（每页一个 Markdown + README 索引）</summary>
    [HttpGet("sets/{setId:guid}/export")]
    public async Task<IActionResult> ExportSet(Guid setId, CancellationToken cancellationToken)
    {
        var result = await _wikiService.ExportSetAsync(setId, cancellationToken);
        if (!result.Success || result.Data == null)
            return BadRequest(ApiResponse.Fail(result.Error ?? "导出失败"));
        return File(result.Data, "application/zip", $"wiki-{setId:N}.zip");
    }

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _wikiService.DeleteAsync(id, cancellationToken);
}
