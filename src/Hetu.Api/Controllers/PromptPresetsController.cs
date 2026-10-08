using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/prompt-presets")]
public class PromptPresetsController : ControllerBase
{
    private readonly IPromptPresetService _promptPresetService;
    private readonly ILocalPromptPresetService _localPromptPresetService;

    public PromptPresetsController(IPromptPresetService promptPresetService, ILocalPromptPresetService localPromptPresetService)
    {
        _promptPresetService = promptPresetService;
        _localPromptPresetService = localPromptPresetService;
    }

    [HttpGet]
    public Task<ApiResponse<List<PromptPresetDto>>> GetAll(CancellationToken cancellationToken)
        => _promptPresetService.GetAllAsync(cancellationToken);

    [HttpGet("local")]
    public Task<ApiResponse<List<LocalPromptPresetDto>>> GetLocal(CancellationToken cancellationToken)
        => _localPromptPresetService.ScanAllAsync(cancellationToken);

    [HttpGet("directories")]
    public Task<ApiResponse<List<string>>> GetDirectories(CancellationToken cancellationToken)
        => _localPromptPresetService.GetDirectoriesAsync(cancellationToken);

    [HttpPut("directories")]
    public Task<ApiResponse> UpdateDirectories([FromBody] List<string> directories, CancellationToken cancellationToken)
        => _localPromptPresetService.UpdateDirectoriesAsync(directories, cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<PromptPresetDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _promptPresetService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<PromptPresetDto>> Create([FromBody] CreatePromptPresetRequest request, CancellationToken cancellationToken)
        => _promptPresetService.CreateAsync(request, cancellationToken);

    /// <summary>从通用智能体创建专业智能体：复用其提示词与工具配置，生成专业版草稿</summary>
    [HttpPost("{id:guid}/create-professional")]
    public Task<ApiResponse<PromptPresetDto>> CreateProfessionalFrom(Guid id, CancellationToken cancellationToken)
        => _promptPresetService.CreateProfessionalFromAsync(id, cancellationToken);

    /// <summary>从本地通用智能体创建专业智能体（落库为数据库专业智能体草稿）</summary>
    [HttpPost("local/create-professional")]
    public Task<ApiResponse<PromptPresetDto>> CreateProfessionalFromLocal([FromBody] CreateProfessionalFromLocalRequest request, CancellationToken cancellationToken)
        => _promptPresetService.CreateProfessionalFromLocalAsync(request.LocalId, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<PromptPresetDto>> Update(Guid id, [FromBody] UpdatePromptPresetRequest request, CancellationToken cancellationToken)
        => _promptPresetService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _promptPresetService.DeleteAsync(id, cancellationToken);

    [HttpGet("export")]
    public Task<ApiResponse<List<PromptPresetDto>>> Export(CancellationToken cancellationToken)
        => _promptPresetService.ExportAsync(cancellationToken);

    [HttpPost("import")]
    public Task<ApiResponse<int>> Import([FromBody] List<ImportPromptPresetItem> items, CancellationToken cancellationToken)
        => _promptPresetService.ImportAsync(items, cancellationToken);
}
