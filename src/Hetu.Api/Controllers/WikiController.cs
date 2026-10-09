using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Projects;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>
/// 项目 Wiki：为「项目」页登记的本地项目生成 AI Wiki 文档，按项目查阅与管理。
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

    /// <summary>Wiki 文档列表；可按项目过滤</summary>
    [HttpGet]
    public Task<ApiResponse<List<WikiDocumentDto>>> GetAll(Guid? projectId, CancellationToken cancellationToken)
        => _wikiService.GetAllAsync(projectId, cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<WikiDocumentDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _wikiService.GetByIdAsync(id, cancellationToken);

    /// <summary>为指定项目生成一篇 Wiki 文档（读取本地目录资料后由 LLM 撰写，耗时较长）</summary>
    [HttpPost("projects/{projectId:guid}/generate")]
    public Task<ApiResponse<WikiDocumentDto>> Generate(Guid projectId, CancellationToken cancellationToken)
        => _wikiService.GenerateAsync(projectId, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _wikiService.DeleteAsync(id, cancellationToken);
}
