using Hetu.Core.Interfaces;
using Hetu.Shared.AI;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/skills")]
public class SkillsController : ControllerBase
{
    private readonly ISkillService _skillService;

    public SkillsController(ISkillService skillService)
    {
        _skillService = skillService;
    }

    [HttpGet]
    public Task<ApiResponse<List<SkillDto>>> GetAll(CancellationToken cancellationToken)
        => _skillService.GetAllAsync(cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<SkillDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _skillService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<SkillDto>> Create([FromBody] CreateSkillRequest request, CancellationToken cancellationToken)
        => _skillService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<SkillDto>> Update(Guid id, [FromBody] UpdateSkillRequest request, CancellationToken cancellationToken)
        => _skillService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _skillService.DeleteAsync(id, cancellationToken);

    [HttpPost("{nameOrId}/invoke")]
    public Task<ApiResponse<string>> Invoke(string nameOrId, [FromBody] InvokeSkillRequest request, CancellationToken cancellationToken)
        => _skillService.InvokeAsync(nameOrId, request, cancellationToken);
}
