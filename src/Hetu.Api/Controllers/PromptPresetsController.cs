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

    public PromptPresetsController(IPromptPresetService promptPresetService)
    {
        _promptPresetService = promptPresetService;
    }

    [HttpGet]
    public Task<ApiResponse<List<PromptPresetDto>>> GetAll(CancellationToken cancellationToken)
        => _promptPresetService.GetAllAsync(cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<PromptPresetDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _promptPresetService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<PromptPresetDto>> Create([FromBody] CreatePromptPresetRequest request, CancellationToken cancellationToken)
        => _promptPresetService.CreateAsync(request, cancellationToken);

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
