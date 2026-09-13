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
    private readonly IWorkCodeIndexService _codeIndexService;

    public WorkProjectsController(
        IWorkProjectService projectService,
        IWorkSessionService sessionService,
        IWorkApprovalRuleService approvalRuleService,
        IWorkCodeIndexService codeIndexService)
    {
        _projectService = projectService;
        _sessionService = sessionService;
        _approvalRuleService = approvalRuleService;
        _codeIndexService = codeIndexService;
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

    /// <summary>会话列表，query 为标题/消息内容关键字</summary>
    [HttpGet("{id:guid}/sessions")]
    public Task<ApiResponse<List<WorkSessionDto>>> GetSessions(Guid id, [FromQuery] string? query, CancellationToken cancellationToken)
        => _sessionService.GetByProjectAsync(id, query, cancellationToken);

    /// <summary>代码向量索引状态</summary>
    [HttpGet("{id:guid}/code-index")]
    public async Task<ApiResponse<WorkCodeIndexStatusDto>> GetCodeIndexStatus(Guid id, CancellationToken cancellationToken)
        => await _codeIndexService.GetStatusAsync(id, cancellationToken);

    /// <summary>重建代码向量索引（force=true 时忽略哈希缓存全量重建）</summary>
    [HttpPost("{id:guid}/code-index")]
    public async Task<ApiResponse<WorkCodeIndexResultDto>> RebuildCodeIndex(Guid id, [FromQuery] bool force, CancellationToken cancellationToken)
        => await _codeIndexService.IndexProjectAsync(id, force, cancellationToken);

    /// <summary>清空代码向量索引</summary>
    [HttpDelete("{id:guid}/code-index")]
    public async Task<ApiResponse> ClearCodeIndex(Guid id, CancellationToken cancellationToken)
        => await _codeIndexService.ClearAsync(id, cancellationToken);

    /// <summary>在代码向量索引上做语义检索</summary>
    [HttpGet("{id:guid}/code-index/search")]
    public async Task<ApiResponse<List<WorkCodeSearchHitDto>>> SearchCodeIndex(Guid id, [FromQuery] string query, [FromQuery] int limit, CancellationToken cancellationToken)
        => await _codeIndexService.SearchAsync(id, query ?? "", limit <= 0 ? 8 : limit, cancellationToken);

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
