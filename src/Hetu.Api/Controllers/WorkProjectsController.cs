using Hetu.Api.Services;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;
using Hetu.Core.Services.Work;
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
    private readonly IWorkCommandRunnerFactory _commandRunnerFactory;
    private readonly ILogger<WorkProjectsController> _logger;

    public WorkProjectsController(
        IWorkProjectService projectService,
        IWorkSessionService sessionService,
        IWorkApprovalRuleService approvalRuleService,
        IWorkCodeIndexService codeIndexService,
        IWorkCommandRunnerFactory commandRunnerFactory,
        ILogger<WorkProjectsController> logger)
    {
        _projectService = projectService;
        _sessionService = sessionService;
        _approvalRuleService = approvalRuleService;
        _codeIndexService = codeIndexService;
        _commandRunnerFactory = commandRunnerFactory;
        _logger = logger;
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

    /// <summary>用外部应用打开项目目录（vscode / cursor / explorer / terminal）</summary>
    [HttpPost("{id:guid}/open")]
    public async Task<ApiResponse<string>> Open(Guid id, [FromQuery] string app, [FromServices] WorkOpenInAppService openService, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(app)) return ApiResponse<string>.Fail("缺少 app 参数");
        var (success, output) = await openService.OpenAsync(id, app, cancellationToken);
        return success ? ApiResponse<string>.Ok(output) : ApiResponse<string>.Fail(output);
    }
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

    /// <summary>
    /// GitHub Copilot 资产：扫描项目 .github 目录下的指令 / 自定义智能体 / 提示词 / 技能。
    /// 智能体会自动出现在 Work 会话的 Agent 下拉框中（前缀 copilot:），其正文作为 AgentPrompt 生效。
    /// SSH 项目通过远端 shell 扫描（远端 .github 常为软链），本地项目直接读文件系统。
    /// </summary>
    [HttpGet("{id:guid}/copilot-assets")]
    public async Task<ApiResponse<WorkCopilotAssetsDto>> GetCopilotAssets(Guid id, CancellationToken cancellationToken)
    {
        var project = await _projectService.GetByIdAsync(id, cancellationToken);
        if (!project.Success || project.Data == null)
            return ApiResponse<WorkCopilotAssetsDto>.Fail(project.Error ?? "项目不存在");

        var runner = await _commandRunnerFactory.GetRunnerAsync(id, cancellationToken);
        // 显式刷新（下拉框/智能体页每次打开都会调）：跳过缓存，但仍然失败不抛
        WorkCopilotAssets.CopilotAssets assets;
        try
        {
            assets = await WorkCopilotAssets.LoadAsync(project.Data.RootPath, runner, cancellationToken, force: true);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "[WorkProjects] 加载 .github 资产失败，返回空资产");
            assets = WorkCopilotAssets.Empty;
        }
        var dto = new WorkCopilotAssetsDto
        {
            Agents = assets.Agents.Select(a => new WorkCopilotAgentDto
            {
                Id = $"copilot:{a.Name}",
                Name = a.Name,
                Description = a.Description,
                Content = a.Body
            }).ToList(),
            Prompts = assets.Prompts.Select(p => new WorkCopilotAssetItemDto
            {
                Name = p.Name,
                Description = p.Description,
                FilePath = p.FilePath,
                Content = ClipAssetBody(p.Text)
            }).ToList(),
            Skills = assets.Skills.Select(s => new WorkCopilotAssetItemDto
            {
                Name = s.Name,
                Description = s.Description,
                FilePath = s.FilePath,
                Content = ClipAssetBody(s.Text)
            }).ToList(),
            Instructions = assets.Instructions.Select(i => new WorkCopilotAssetItemDto
            {
                Name = i.Label,
                Description = i.Description ?? "",
                FilePath = i.FilePath
            }).ToList(),
        };
        return ApiResponse<WorkCopilotAssetsDto>.Ok(dto);
    }

    /// <summary>资产正文上限：超长截断，与列表加载时的读取共用同一份内容（避免逐文件再读一次）。</summary>
    private static string ClipAssetBody(string text)
    {
        const int maxChars = 12_000;
        return text.Length > maxChars ? text[..maxChars] : text;
    }

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
