using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Workflows;
using Hetu.Shared.AI;
using Microsoft.Extensions.DependencyInjection;

namespace Hetu.Core.Services.Tools;

/// <summary>工作流工具：查看与执行工作流（含节点结果摘要）。</summary>
public class ListWorkflowsTool : IToolExecutor
{
    private readonly IWorkflowService _workflowService;

    public ListWorkflowsTool(IWorkflowService workflowService) => _workflowService = workflowService;

    public string Name => "list_workflows";
    public string Description => "列出可执行的工作流（名称/描述/是否启用/节点数）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "用户要求「跑一下某个流程」时先调用本工具确认工作流 ID 与是否启用，再用 run_workflow 执行。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": { "keyword": { "type": "string", "description": "按名称/描述过滤（可选）" } }
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var result = await _workflowService.GetAllAsync(cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "获取工作流失败");

            var keyword = ListProjectsTool.ReadString(argumentsJson, "keyword");
            var items = result.Data
                .Where(w => string.IsNullOrWhiteSpace(keyword)
                    || w.Name.Contains(keyword, StringComparison.OrdinalIgnoreCase)
                    || (w.Description ?? "").Contains(keyword, StringComparison.OrdinalIgnoreCase))
                .Select(w => new
                {
                    id = w.Id,
                    name = w.Name,
                    description = w.Description,
                    isEnabled = w.IsEnabled,
                    nodeCount = w.Nodes?.Count ?? 0,
                    updatedAt = w.UpdatedAt,
                })
                .ToList();

            return ToolExecutionResult.Success(ToolJson.Serialize(new { total = items.Count, items }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"获取工作流失败: {ex.Message}");
        }
    }
}

public class RunWorkflowTool : IToolExecutor
{
    private const int MaxOutputChars = 6000;

    private readonly IServiceProvider _services;

    /// <summary>
    /// 通过服务定位器延迟解析执行引擎：引擎依赖节点执行器，节点执行器又依赖 ToolRegistry，
    /// 构造期直接注入会形成循环依赖。
    /// </summary>
    public RunWorkflowTool(IServiceProvider services) => _services = services;

    public string Name => "run_workflow";
    public string Description => "执行一个工作流并返回结果（含失败的节点信息）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public string? UsageGuideline =>
        "先用 list_workflows 确认工作流已启用且是用户真正要跑的那个；工作流内部可能调用工具与模型，属于重操作，只跑一次不要循环重试。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "id": { "type": "string", "description": "工作流 ID（见 list_workflows）" },
            "input": { "type": "string", "description": "传给工作流的输入文本（可选）" }
        },
        "required": ["id"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            if (!Guid.TryParse(ListProjectsTool.ReadString(argumentsJson, "id"), out var id))
                return ToolExecutionResult.Error("id 必须是有效 GUID");

            var input = ListProjectsTool.ReadString(argumentsJson, "input");
            var engine = _services.GetRequiredService<WorkflowExecutionEngine>();
            var result = await engine.ExecuteAsync(id, input, cancellationToken);

            var output = result.Output ?? "";
            if (output.Length > MaxOutputChars)
                output = output[..MaxOutputChars] + "\n…（输出已截断）";

            return string.Equals(result.Status, "Failed", StringComparison.OrdinalIgnoreCase)
                ? ToolExecutionResult.Error(ToolJson.Serialize(new { status = result.Status, error = result.Error, runId = result.RunId }))
                : ToolExecutionResult.Success(ToolJson.Serialize(new
                {
                    status = result.Status,
                    runId = result.RunId,
                    totalIterations = result.TotalIterations,
                    output,
                }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"执行工作流失败: {ex.Message}");
        }
    }
}

/// <summary>智能体工具：列出可用智能体（数据库 + 本地目录）。</summary>
public class ListAgentsTool : IToolExecutor
{
    private readonly IPromptPresetService _presetService;
    private readonly ILocalPromptPresetService _localPresetService;

    public ListAgentsTool(IPromptPresetService presetService, ILocalPromptPresetService localPresetService)
    {
        _presetService = presetService;
        _localPresetService = localPresetService;
    }

    public string Name => "list_agents";
    public string Description => "列出可用智能体（数据库 + 本地目录：名称/分类/类型/是否专业智能体）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "用户问「有哪些智能体」「该找谁做某事」时调用；本工具只用于展示与推荐，不能切换当前人格。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": { "keyword": { "type": "string", "description": "按名称/分类过滤（可选）" } }
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var keyword = ListProjectsTool.ReadString(argumentsJson, "keyword");
            var items = new List<object>();

            var presets = await _presetService.GetAllAsync(cancellationToken);
            if (presets.Success && presets.Data != null)
            {
                items.AddRange(presets.Data
                    .Where(p => string.IsNullOrWhiteSpace(keyword)
                        || p.Name.Contains(keyword, StringComparison.OrdinalIgnoreCase)
                        || (p.Category ?? "").Contains(keyword, StringComparison.OrdinalIgnoreCase))
                    .Select(p => (object)new
                    {
                        id = p.Id.ToString(),
                        name = p.Name,
                        category = p.Category,
                        agentType = p.AgentType,
                        source = "database",
                    }));
            }

            var locals = await _localPresetService.ScanAllAsync(cancellationToken);
            if (locals.Success && locals.Data != null)
            {
                items.AddRange(locals.Data
                    .Where(p => p.IsEnabled && (string.IsNullOrWhiteSpace(keyword)
                        || p.Name.Contains(keyword, StringComparison.OrdinalIgnoreCase)
                        || (p.Category ?? "").Contains(keyword, StringComparison.OrdinalIgnoreCase)))
                    .Select(p => (object)new
                    {
                        id = p.Id,
                        name = p.Name,
                        category = p.Category,
                        agentType = "General",
                        source = "local",
                    }));
            }

            return ToolExecutionResult.Success(ToolJson.Serialize(new { total = items.Count, items }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"获取智能体列表失败: {ex.Message}");
        }
    }
}

/// <summary>技能工具：按名称加载技能说明（数据库技能 / 本地技能目录）。</summary>
public class UseSkillTool : IToolExecutor
{
    private const int MaxBodyChars = 8000;

    private readonly ISkillService _skillService;
    private readonly ILocalSkillService _localSkillService;

    public UseSkillTool(ISkillService skillService, ILocalSkillService localSkillService)
    {
        _skillService = skillService;
        _localSkillService = localSkillService;
    }

    public string Name => "use_skill";
    public string Description => "按名称加载某个已启用技能的完整说明，然后按说明完成任务";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "system prompt 里的技能列表只给名称与一句话描述；某个技能明显匹配当前任务时先调用本工具读全文再动手。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": { "name": { "type": "string", "description": "技能名称或 Id（见 list_skills）" } },
        "required": ["name"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var name = ListProjectsTool.ReadString(argumentsJson, "name");
            if (string.IsNullOrWhiteSpace(name))
                return ToolExecutionResult.Error("name 不能为空");

            var scan = await _localSkillService.ScanAllAsync(cancellationToken);
            var skills = scan.Data ?? [];
            var local = skills.FirstOrDefault(s =>
                string.Equals(s.Id, name, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase));

            if (local != null)
            {
                if (!local.IsEnabled)
                    return ToolExecutionResult.Error($"技能「{local.Name}」当前已禁用，请先在设置中启用。");

                var body = File.Exists(local.FilePath)
                    ? await File.ReadAllTextAsync(local.FilePath, cancellationToken)
                    : "（技能文件不存在或已被删除）";
                if (body.Length > MaxBodyChars) body = body[..MaxBodyChars] + "\n…（正文已截断）";
                return ToolExecutionResult.Success($"技能 {local.Name}（{local.Category}）说明：\n\n{body}");
            }

            var dbSkills = (await _skillService.GetAllAsync(cancellationToken)).Data ?? [];
            var db = dbSkills.FirstOrDefault(s =>
                string.Equals(s.Id.ToString(), name, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase));

            if (db == null)
            {
                var available = string.Join("、", skills.Where(s => s.IsEnabled).Select(s => s.Name).Take(20));
                return ToolExecutionResult.Error($"未找到技能「{name}」。已启用技能：{(available.Length > 0 ? available : "（无）")}");
            }

            if (!db.IsEnabled)
                return ToolExecutionResult.Error($"技能「{db.Name}」当前已禁用，请先在设置中启用。");

            var bodyText = ResolveDbSkillBody(db);
            return bodyText.Length > 0
                ? ToolExecutionResult.Success($"技能 {db.Name}（{db.Category}）说明：\n\n{bodyText}")
                : ToolExecutionResult.Error($"技能「{db.Name}」未配置提示词内容（systemPrompt / promptTemplate 都为空）。");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"读取技能失败: {ex.Message}");
        }
    }

    private static string ResolveDbSkillBody(SkillDto skill)
    {
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(skill.Config) ? "{}" : skill.Config);
            foreach (var key in new[] { "promptTemplate", "systemPrompt" })
            {
                if (doc.RootElement.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String)
                {
                    var text = value.GetString();
                    if (!string.IsNullOrWhiteSpace(text)) return text;
                }
            }
        }
        catch (JsonException)
        {
            // Config 非法时按空处理
        }
        return string.Empty;
    }
}
