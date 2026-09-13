using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Work;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/work-projects")]
public class WorkProjectsController : ControllerBase
{
    private readonly IWorkProjectService _projectService;
    private readonly IWorkSessionService _sessionService;
    private readonly IWorkApprovalRuleService _approvalRuleService;

    public WorkProjectsController(
        IWorkProjectService projectService,
        IWorkSessionService sessionService,
        IWorkApprovalRuleService approvalRuleService)
    {
        _projectService = projectService;
        _sessionService = sessionService;
        _approvalRuleService = approvalRuleService;
    }

    [HttpGet]
    public Task<ApiResponse<List<WorkProjectDto>>> GetAll(CancellationToken cancellationToken)
        => _projectService.GetAllAsync(cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<WorkProjectDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _projectService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<WorkProjectDto>> Create([FromBody] CreateWorkProjectRequest request, CancellationToken cancellationToken)
        => _projectService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<WorkProjectDto>> Update(Guid id, [FromBody] UpdateWorkProjectRequest request, CancellationToken cancellationToken)
        => _projectService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _projectService.DeleteAsync(id, cancellationToken);

    [HttpGet("{id:guid}/sessions")]
    public Task<ApiResponse<List<WorkSessionDto>>> GetSessions(Guid id, CancellationToken cancellationToken)
        => _sessionService.GetByProjectAsync(id, cancellationToken);

    /// <summary>项目级工具审批规则（allow 直接放行 / deny 直接拒绝）</summary>
    [HttpGet("{id:guid}/approval-rules")]
    public Task<ApiResponse<List<WorkApprovalRuleDto>>> GetApprovalRules(Guid id, CancellationToken cancellationToken)
        => _approvalRuleService.GetByProjectAsync(id, cancellationToken);

    [HttpPost("{id:guid}/approval-rules")]
    public Task<ApiResponse<WorkApprovalRuleDto>> CreateApprovalRule(Guid id, [FromBody] CreateWorkApprovalRuleRequest request, CancellationToken cancellationToken)
        => _approvalRuleService.CreateAsync(id, request, cancellationToken);
}

[ApiController]
[Route("api/work-approval-rules")]
public class WorkApprovalRulesController : ControllerBase
{
    private readonly IWorkApprovalRuleService _approvalRuleService;

    public WorkApprovalRulesController(IWorkApprovalRuleService approvalRuleService)
    {
        _approvalRuleService = approvalRuleService;
    }

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _approvalRuleService.DeleteAsync(id, cancellationToken);
}
