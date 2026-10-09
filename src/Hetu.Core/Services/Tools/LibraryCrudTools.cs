using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Workflows;
using Hetu.Shared.AI;
using Hetu.Shared.Chat;
using Hetu.Shared.Workflow;

namespace Hetu.Core.Services.Tools;

/// <summary>工具参数读取：只在显式传入时才算「要改这一项」，便于做部分更新。</summary>
internal static class ToolArgs
{
    public static bool Has(string argumentsJson, string property)
    {
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(argumentsJson) ? "{}" : argumentsJson);
            return doc.RootElement.ValueKind == JsonValueKind.Object
                && doc.RootElement.TryGetProperty(property, out var v)
                && v.ValueKind is not JsonValueKind.Null;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    public static bool? ReadBool(string argumentsJson, string property)
    {
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(argumentsJson) ? "{}" : argumentsJson);
            if (doc.RootElement.TryGetProperty(property, out var v)
                && v.ValueKind is JsonValueKind.True or JsonValueKind.False)
                return v.GetBoolean();
        }
        catch (JsonException) { /* 非法 JSON 交给必填参数校验 */ }
        return null;
    }

    public static int? ReadInt(string argumentsJson, string property)
    {
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(argumentsJson) ? "{}" : argumentsJson);
            if (doc.RootElement.TryGetProperty(property, out var v) && v.ValueKind == JsonValueKind.Number
                && v.TryGetInt32(out var i))
                return i;
        }
        catch (JsonException) { /* 非法 JSON 交给必填参数校验 */ }
        return null;
    }

    /// <summary>
    /// 读 GUID 参数：容忍模型多带引号、花括号或把名称写在后面（"id (名称)" / "{id}"），
    /// 无法解析时返回 null，由调用方给出「id 必须是有效 GUID」提示。
    /// </summary>
    public static Guid? ReadGuid(string argumentsJson, string property)
    {
        var raw = ListProjectsTool.ReadString(argumentsJson, property)?.Trim().Trim('"', '\'', '{', '}', '`');
        if (string.IsNullOrWhiteSpace(raw)) return null;
        if (Guid.TryParse(raw, out var id)) return id;

        var match = System.Text.RegularExpressions.Regex.Match(
            raw, @"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
        return match.Success && Guid.TryParse(match.Value, out var extracted) ? extracted : null;
    }
}

/// <summary>内置技能（数据库技能）的增删改。</summary>
public class CreateSkillTool : IToolExecutor
{
    private readonly ISkillService _skillService;

    public CreateSkillTool(ISkillService skillService) => _skillService = skillService;

    public string Name => "create_skill";
    public string Description => "新建一个内置技能（数据库技能），技能通过 /名称 或 use_skill 触发";
    public string? UsageGuideline =>
        "用户要求「把某个流程沉淀成技能」时使用；先用 list_skills 确认没有同名技能，名称用 kebab-case（如 weekly-report）。config 是 JSON 字符串，可含 promptTemplate、tools 等字段。";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public ToolRisk Risk => ToolRisk.Write;

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "name": { "type": "string", "description": "技能名称（触发用，kebab-case，如 weekly-report）" },
            "description": { "type": "string", "description": "一句话说明技能做什么" },
            "category": { "type": "string", "description": "分类（可选，如 写作 / 开发）" },
            "config": { "type": "string", "description": "技能配置 JSON 字符串（可选，可含 promptTemplate / tools 等）" }
        },
        "required": ["name", "description"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var name = ListProjectsTool.ReadString(argumentsJson, "name");
            if (string.IsNullOrWhiteSpace(name)) return ToolExecutionResult.Error("name 不能为空");

            var result = await _skillService.CreateAsync(new CreateSkillRequest
            {
                Name = name.Trim(),
                Description = ListProjectsTool.ReadString(argumentsJson, "description") ?? string.Empty,
                Category = ListProjectsTool.ReadString(argumentsJson, "category") ?? string.Empty,
                Config = ListProjectsTool.ReadString(argumentsJson, "config"),
            }, cancellationToken);

            return result.Success && result.Data != null
                ? ToolExecutionResult.Success(ToolJson.Serialize(new
                {
                    id = result.Data.Id,
                    name = result.Data.Name,
                    isEnabled = result.Data.IsEnabled,
                    message = "技能已创建（默认启用）",
                }))
                : ToolExecutionResult.Error(result.Error ?? "创建技能失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"创建技能失败: {ex.Message}");
        }
    }
}

public class UpdateSkillTool : IToolExecutor
{
    private readonly ISkillService _skillService;

    public UpdateSkillTool(ISkillService skillService) => _skillService = skillService;

    public string Name => "update_skill";
    public string Description => "修改内置技能（名称/说明/分类/配置/启用状态），只需传要改的字段";
    public string? UsageGuideline => "用户要求改名、改说明、停用/启用技能时使用；id 先用 list_skills 获取，未传的字段保持原值。";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public ToolRisk Risk => ToolRisk.Write;

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "id": { "type": "string", "description": "技能 ID（见 list_skills）" },
            "name": { "type": "string", "description": "新名称（可选）" },
            "description": { "type": "string", "description": "新说明（可选）" },
            "category": { "type": "string", "description": "新分类（可选）" },
            "config": { "type": "string", "description": "新配置 JSON（可选）" },
            "isEnabled": { "type": "boolean", "description": "是否启用（可选）" },
            "sortOrder": { "type": "integer", "description": "排序值（可选）" }
        },
        "required": ["id"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var id = ToolArgs.ReadGuid(argumentsJson, "id");
            if (id is null) return ToolExecutionResult.Error("id 必须是有效 GUID（见 list_skills）");

            var current = await _skillService.GetByIdAsync(id.Value, cancellationToken);
            if (!current.Success || current.Data == null) return ToolExecutionResult.Error(current.Error ?? "技能不存在");
            var skill = current.Data;

            var request = new UpdateSkillRequest
            {
                Name = ToolArgs.Has(argumentsJson, "name") ? (ListProjectsTool.ReadString(argumentsJson, "name") ?? skill.Name) : skill.Name,
                Description = ToolArgs.Has(argumentsJson, "description") ? (ListProjectsTool.ReadString(argumentsJson, "description") ?? string.Empty) : skill.Description,
                Category = ToolArgs.Has(argumentsJson, "category") ? (ListProjectsTool.ReadString(argumentsJson, "category") ?? string.Empty) : skill.Category,
                Config = ToolArgs.Has(argumentsJson, "config") ? ListProjectsTool.ReadString(argumentsJson, "config") : skill.Config,
                IsEnabled = ToolArgs.ReadBool(argumentsJson, "isEnabled") ?? skill.IsEnabled,
                SortOrder = ToolArgs.ReadInt(argumentsJson, "sortOrder") ?? skill.SortOrder,
            };

            var result = await _skillService.UpdateAsync(id.Value, request, cancellationToken);
            return result.Success && result.Data != null
                ? ToolExecutionResult.Success(ToolJson.Serialize(new
                {
                    id = result.Data.Id,
                    name = result.Data.Name,
                    isEnabled = result.Data.IsEnabled,
                    message = "技能已更新",
                }))
                : ToolExecutionResult.Error(result.Error ?? "更新技能失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"更新技能失败: {ex.Message}");
        }
    }
}

public class DeleteSkillTool : IToolExecutor
{
    private readonly ISkillService _skillService;

    public DeleteSkillTool(ISkillService skillService) => _skillService = skillService;

    public string Name => "delete_skill";
    public string Description => "删除一个内置技能（不可恢复）";
    public string? UsageGuideline => "用户明确要求删除某个技能时使用；删除前必须先把技能名称/ID 反馈给用户确认。";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public ToolRisk Risk => ToolRisk.Write;

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "id": { "type": "string", "description": "技能 ID（见 list_skills；与 name 二选一）" },
            "name": { "type": "string", "description": "技能名称（见 list_skills；与 id 二选一）" }
        }
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var id = ToolArgs.ReadGuid(argumentsJson, "id");
            if (id is null)
            {
                var name = ListProjectsTool.ReadString(argumentsJson, "name");
                if (string.IsNullOrWhiteSpace(name)) return ToolExecutionResult.Error("请提供技能 id 或 name（见 list_skills）");

                var all = await _skillService.GetAllAsync(cancellationToken);
                var match = all.Data?.FirstOrDefault(s => string.Equals(s.Name, name.Trim(), StringComparison.OrdinalIgnoreCase))
                    ?? all.Data?.FirstOrDefault(s => s.Name.Contains(name.Trim(), StringComparison.OrdinalIgnoreCase));
                if (match == null) return ToolExecutionResult.Error($"未找到名为「{name}」的技能");
                id = match.Id;
            }

            var result = await _skillService.DeleteAsync(id.Value, cancellationToken);
            return result.Success
                ? ToolExecutionResult.Success(ToolJson.Serialize(new { id = id.Value, message = "技能已删除" }))
                : ToolExecutionResult.Error(result.Error ?? "删除技能失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"删除技能失败: {ex.Message}");
        }
    }
}

/// <summary>智能体（提示词预设）的增删改。</summary>
public class CreateAgentTool : IToolExecutor
{
    private readonly IPromptPresetService _presetService;

    public CreateAgentTool(IPromptPresetService presetService) => _presetService = presetService;

    public string Name => "create_agent";
    public string Description => "新建一个智能体（提示词预设），内容作为系统提示注入";
    public string? UsageGuideline =>
        "用户要求「创建一个智能体/角色」时使用；content 写系统提示词（角色、职责、输出要求），名称尽量简短；先用 list_agents 避免重名。";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public ToolRisk Risk => ToolRisk.Write;

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "name": { "type": "string", "description": "智能体名称" },
            "content": { "type": "string", "description": "系统提示词正文" },
            "category": { "type": "string", "description": "分类（可选，如 开发 / 写作）" },
            "agentType": { "type": "string", "description": "General（通用，默认）| Professional（专业，可绑定子智能体与模型）" },
            "modelId": { "type": "string", "description": "绑定模型 ID（可选，仅专业智能体）" },
            "reasoningEffort": { "type": "string", "description": "绑定模型推理强度（可选，如 low/medium/high）" },
            "subAgentIds": { "type": "string", "description": "子智能体 ID 的 JSON 数组字符串（可选，仅专业智能体）" },
            "toolsConfig": { "type": "string", "description": "工具配置 JSON 字符串（可选）" }
        },
        "required": ["name", "content"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var name = ListProjectsTool.ReadString(argumentsJson, "name");
            var content = ListProjectsTool.ReadString(argumentsJson, "content");
            if (string.IsNullOrWhiteSpace(name)) return ToolExecutionResult.Error("name 不能为空");
            if (string.IsNullOrWhiteSpace(content)) return ToolExecutionResult.Error("content 不能为空");

            Guid? modelId = Guid.TryParse(ListProjectsTool.ReadString(argumentsJson, "modelId"), out var mid) ? mid : null;
            var result = await _presetService.CreateAsync(new CreatePromptPresetRequest
            {
                Name = name.Trim(),
                Content = content,
                Category = ListProjectsTool.ReadString(argumentsJson, "category") ?? string.Empty,
                AgentType = ListProjectsTool.ReadString(argumentsJson, "agentType") ?? "General",
                ModelId = modelId,
                ReasoningEffort = ListProjectsTool.ReadString(argumentsJson, "reasoningEffort"),
                SubAgentIds = ListProjectsTool.ReadString(argumentsJson, "subAgentIds"),
                ToolsConfig = ListProjectsTool.ReadString(argumentsJson, "toolsConfig"),
            }, cancellationToken);

            return result.Success && result.Data != null
                ? ToolExecutionResult.Success(ToolJson.Serialize(new
                {
                    id = result.Data.Id,
                    name = result.Data.Name,
                    category = result.Data.Category,
                    message = "智能体已创建",
                }))
                : ToolExecutionResult.Error(result.Error ?? "创建智能体失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"创建智能体失败: {ex.Message}");
        }
    }
}

public class UpdateAgentTool : IToolExecutor
{
    private readonly IPromptPresetService _presetService;

    public UpdateAgentTool(IPromptPresetService presetService) => _presetService = presetService;

    public string Name => "update_agent";
    public string Description => "修改智能体（名称/分类/提示词/类型/绑定模型等），只需传要改的字段";
    public string? UsageGuideline => "用户要求调整某个智能体的提示词或属性时使用；id 先用 list_agents 获取，未传的字段保持原值。";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public ToolRisk Risk => ToolRisk.Write;

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "id": { "type": "string", "description": "智能体 ID（见 list_agents，仅数据库智能体可改）" },
            "name": { "type": "string", "description": "新名称（可选）" },
            "content": { "type": "string", "description": "新系统提示词（可选）" },
            "category": { "type": "string", "description": "新分类（可选）" },
            "agentType": { "type": "string", "description": "General | Professional（可选）" },
            "modelId": { "type": "string", "description": "绑定模型 ID（可选）" },
            "reasoningEffort": { "type": "string", "description": "推理强度（可选）" },
            "subAgentIds": { "type": "string", "description": "子智能体 ID JSON 数组字符串（可选）" },
            "toolsConfig": { "type": "string", "description": "工具配置 JSON 字符串（可选）" }
        },
        "required": ["id"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var id = ToolArgs.ReadGuid(argumentsJson, "id");
            if (id is null) return ToolExecutionResult.Error("id 必须是有效 GUID（见 list_agents）");

            var current = await _presetService.GetByIdAsync(id.Value, cancellationToken);
            if (!current.Success || current.Data == null) return ToolExecutionResult.Error(current.Error ?? "智能体不存在");
            var preset = current.Data;
            if (preset.IsBuiltIn) return ToolExecutionResult.Error("内置智能体不可修改，请先用 create_agent 另存一份");

            Guid? modelId = preset.ModelId;
            if (ToolArgs.Has(argumentsJson, "modelId"))
                modelId = Guid.TryParse(ListProjectsTool.ReadString(argumentsJson, "modelId"), out var mid) ? mid : null;

            var request = new UpdatePromptPresetRequest
            {
                Name = ToolArgs.Has(argumentsJson, "name") ? (ListProjectsTool.ReadString(argumentsJson, "name") ?? preset.Name) : preset.Name,
                Content = ToolArgs.Has(argumentsJson, "content") ? (ListProjectsTool.ReadString(argumentsJson, "content") ?? preset.Content) : preset.Content,
                Category = ToolArgs.Has(argumentsJson, "category") ? (ListProjectsTool.ReadString(argumentsJson, "category") ?? string.Empty) : preset.Category,
                AgentType = ToolArgs.Has(argumentsJson, "agentType") ? (ListProjectsTool.ReadString(argumentsJson, "agentType") ?? preset.AgentType) : preset.AgentType,
                ModelId = modelId,
                ReasoningEffort = ToolArgs.Has(argumentsJson, "reasoningEffort") ? ListProjectsTool.ReadString(argumentsJson, "reasoningEffort") : preset.ReasoningEffort,
                SubAgentIds = ToolArgs.Has(argumentsJson, "subAgentIds") ? ListProjectsTool.ReadString(argumentsJson, "subAgentIds") : preset.SubAgentIds,
                ToolsConfig = ToolArgs.Has(argumentsJson, "toolsConfig") ? ListProjectsTool.ReadString(argumentsJson, "toolsConfig") : preset.ToolsConfig,
                Variables = preset.Variables,
                SortOrder = preset.SortOrder,
            };

            var result = await _presetService.UpdateAsync(id.Value, request, cancellationToken);
            return result.Success && result.Data != null
                ? ToolExecutionResult.Success(ToolJson.Serialize(new
                {
                    id = result.Data.Id,
                    name = result.Data.Name,
                    message = "智能体已更新",
                }))
                : ToolExecutionResult.Error(result.Error ?? "更新智能体失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"更新智能体失败: {ex.Message}");
        }
    }
}

public class DeleteAgentTool : IToolExecutor
{
    private readonly IPromptPresetService _presetService;

    public DeleteAgentTool(IPromptPresetService presetService) => _presetService = presetService;

    public string Name => "delete_agent";
    public string Description => "删除一个智能体（不可恢复，内置智能体不可删）";
    public string? UsageGuideline => "用户明确要求删除某个智能体时使用；删除前必须先把名称/ID 反馈给用户确认。";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public ToolRisk Risk => ToolRisk.Write;

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "id": { "type": "string", "description": "智能体 ID（见 list_agents；与 name 二选一）" },
            "name": { "type": "string", "description": "智能体名称（见 list_agents；与 id 二选一）" }
        }
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var id = ToolArgs.ReadGuid(argumentsJson, "id");
            if (id is null)
            {
                var name = ListProjectsTool.ReadString(argumentsJson, "name");
                if (string.IsNullOrWhiteSpace(name)) return ToolExecutionResult.Error("请提供智能体 id 或 name（见 list_agents）");

                var all = await _presetService.GetAllAsync(cancellationToken);
                var match = all.Data?.Where(p => !p.IsBuiltIn).FirstOrDefault(p => string.Equals(p.Name, name.Trim(), StringComparison.OrdinalIgnoreCase))
                    ?? all.Data?.Where(p => !p.IsBuiltIn).FirstOrDefault(p => p.Name.Contains(name.Trim(), StringComparison.OrdinalIgnoreCase));
                if (match == null) return ToolExecutionResult.Error($"未找到名为「{name}」的智能体（内置智能体不可删除）");
                id = match.Id;
            }

            var current = await _presetService.GetByIdAsync(id.Value, cancellationToken);
            if (current.Success && current.Data is { IsBuiltIn: true })
                return ToolExecutionResult.Error("内置智能体不可删除");

            var result = await _presetService.DeleteAsync(id.Value, cancellationToken);
            return result.Success
                ? ToolExecutionResult.Success(ToolJson.Serialize(new { id = id.Value, message = "智能体已删除" }))
                : ToolExecutionResult.Error(result.Error ?? "删除智能体失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"删除智能体失败: {ex.Message}");
        }
    }
}

/// <summary>工作流的增删改（节点与连线用 JSON 描述）。</summary>
public class CreateWorkflowTool : IToolExecutor
{
    private readonly IWorkflowService _workflowService;

    public CreateWorkflowTool(IWorkflowService workflowService) => _workflowService = workflowService;

    public string Name => "create_workflow";
    public string Description => "新建工作流（节点 + 连线），可在工作流页或 run_workflow 执行";
    public string? UsageGuideline =>
        "用户要求「把某套多步流程固化成工作流」时使用。nodes 是 JSON 数组字符串，元素形如 { \"id\": \"n1\", \"type\": \"start|agent|tool|condition|loop|parallel|merge|human|subworkflow|end\", \"label\": \"节点标题\", \"agentId\": \"智能体 GUID（agent 节点用）\", \"config\": \"节点配置 JSON（tool 节点放工具名等）\", \"x\": 0, \"y\": 0 }；edges 形如 { \"id\": \"e1\", \"source\": \"n1\", \"target\": \"n2\", \"sourceHandle\": \"true\" }。字段名必须与上述一致（label 不是 name，source/target 不是 from/to）。创建后用 list_workflows 复核。";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public ToolRisk Risk => ToolRisk.Write;

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "name": { "type": "string", "description": "工作流名称" },
            "description": { "type": "string", "description": "一句话说明（可选）" },
            "nodes": { "type": "string", "description": "节点 JSON 数组字符串，元素形如：id / type(start|agent|tool|condition|loop|parallel|merge|human|subworkflow|end) / label / agentId / config / x / y" },
            "edges": { "type": "string", "description": "连线 JSON 数组字符串，元素形如：id / source / target / sourceHandle" },
            "isEnabled": { "type": "boolean", "description": "是否启用（默认 true）" }
        },
        "required": ["name"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var name = ListProjectsTool.ReadString(argumentsJson, "name");
            if (string.IsNullOrWhiteSpace(name)) return ToolExecutionResult.Error("name 不能为空");

            if (!WorkflowJson.TryParseNodes(ListProjectsTool.ReadString(argumentsJson, "nodes"), out var nodes, out var nodeError))
                return ToolExecutionResult.Error(nodeError);
            if (!WorkflowJson.TryParseEdges(ListProjectsTool.ReadString(argumentsJson, "edges"), out var edges, out var edgeError))
                return ToolExecutionResult.Error(edgeError);

            var result = await _workflowService.CreateAsync(new CreateWorkflowRequest
            {
                Name = name.Trim(),
                Description = ListProjectsTool.ReadString(argumentsJson, "description") ?? string.Empty,
                Nodes = nodes,
                Edges = edges,
                IsEnabled = ToolArgs.ReadBool(argumentsJson, "isEnabled") ?? true,
            }, cancellationToken);

            return result.Success && result.Data != null
                ? ToolExecutionResult.Success(ToolJson.Serialize(new
                {
                    id = result.Data.Id,
                    name = result.Data.Name,
                    nodeCount = result.Data.Nodes?.Count ?? 0,
                    isEnabled = result.Data.IsEnabled,
                    message = "工作流已创建",
                }))
                : ToolExecutionResult.Error(result.Error ?? "创建工作流失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"创建工作流失败: {ex.Message}");
        }
    }
}

public class UpdateWorkflowTool : IToolExecutor
{
    private readonly IWorkflowService _workflowService;

    public UpdateWorkflowTool(IWorkflowService workflowService) => _workflowService = workflowService;

    public string Name => "update_workflow";
    public string Description => "修改工作流（名称/描述/节点/连线/启用状态），只需传要改的字段";
    public string? UsageGuideline => "用户要求调整工作流节点或启停时使用；id 先用 list_workflows 获取，未传字段保持原值。";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public ToolRisk Risk => ToolRisk.Write;

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "id": { "type": "string", "description": "工作流 ID（见 list_workflows）" },
            "name": { "type": "string", "description": "新名称（可选）" },
            "description": { "type": "string", "description": "新说明（可选）" },
            "nodes": { "type": "string", "description": "新的节点 JSON 数组字符串（可选）" },
            "edges": { "type": "string", "description": "新的连线 JSON 数组字符串（可选）" },
            "isEnabled": { "type": "boolean", "description": "是否启用（可选）" }
        },
        "required": ["id"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var id = ToolArgs.ReadGuid(argumentsJson, "id");
            if (id is null) return ToolExecutionResult.Error("id 必须是有效 GUID（见 list_workflows）");

            var current = await _workflowService.GetByIdAsync(id.Value, cancellationToken);
            if (!current.Success || current.Data == null) return ToolExecutionResult.Error(current.Error ?? "工作流不存在");
            var workflow = current.Data;

            var nodes = workflow.Nodes ?? [];
            if (ToolArgs.Has(argumentsJson, "nodes")
                && !WorkflowJson.TryParseNodes(ListProjectsTool.ReadString(argumentsJson, "nodes"), out nodes, out var nodeError))
                return ToolExecutionResult.Error(nodeError);

            var edges = workflow.Edges ?? [];
            if (ToolArgs.Has(argumentsJson, "edges")
                && !WorkflowJson.TryParseEdges(ListProjectsTool.ReadString(argumentsJson, "edges"), out edges, out var edgeError))
                return ToolExecutionResult.Error(edgeError);

            var result = await _workflowService.UpdateAsync(id.Value, new UpdateWorkflowRequest
            {
                Name = ToolArgs.Has(argumentsJson, "name") ? (ListProjectsTool.ReadString(argumentsJson, "name") ?? workflow.Name) : workflow.Name,
                Description = ToolArgs.Has(argumentsJson, "description") ? (ListProjectsTool.ReadString(argumentsJson, "description") ?? string.Empty) : workflow.Description,
                Nodes = nodes,
                Edges = edges,
                InputSchema = workflow.InputSchema,
                Variables = workflow.Variables,
                IsEnabled = ToolArgs.ReadBool(argumentsJson, "isEnabled") ?? workflow.IsEnabled,
                SortOrder = workflow.SortOrder,
            }, cancellationToken);

            return result.Success && result.Data != null
                ? ToolExecutionResult.Success(ToolJson.Serialize(new
                {
                    id = result.Data.Id,
                    name = result.Data.Name,
                    nodeCount = result.Data.Nodes?.Count ?? 0,
                    isEnabled = result.Data.IsEnabled,
                    message = "工作流已更新",
                }))
                : ToolExecutionResult.Error(result.Error ?? "更新工作流失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"更新工作流失败: {ex.Message}");
        }
    }
}

public class DeleteWorkflowTool : IToolExecutor
{
    private readonly IWorkflowService _workflowService;

    public DeleteWorkflowTool(IWorkflowService workflowService) => _workflowService = workflowService;

    public string Name => "delete_workflow";
    public string Description => "删除一个工作流（不可恢复）";
    public string? UsageGuideline => "用户明确要求删除某个工作流时使用；删除前必须先把名称/ID 反馈给用户确认。";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public ToolRisk Risk => ToolRisk.Write;

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "id": { "type": "string", "description": "工作流 ID（见 list_workflows；与 name 二选一）" },
            "name": { "type": "string", "description": "工作流名称（见 list_workflows；与 id 二选一）" }
        }
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var id = ToolArgs.ReadGuid(argumentsJson, "id");
            if (id is null)
            {
                var name = ListProjectsTool.ReadString(argumentsJson, "name");
                if (string.IsNullOrWhiteSpace(name)) return ToolExecutionResult.Error("请提供工作流 id 或 name（见 list_workflows）");

                var all = await _workflowService.GetAllAsync(cancellationToken);
                var match = all.Data?.FirstOrDefault(w => string.Equals(w.Name, name.Trim(), StringComparison.OrdinalIgnoreCase))
                    ?? all.Data?.FirstOrDefault(w => w.Name.Contains(name.Trim(), StringComparison.OrdinalIgnoreCase));
                if (match == null) return ToolExecutionResult.Error($"未找到名为「{name}」的工作流");
                id = match.Id;
            }

            var result = await _workflowService.DeleteAsync(id.Value, cancellationToken);
            return result.Success
                ? ToolExecutionResult.Success(ToolJson.Serialize(new { id = id.Value, message = "工作流已删除" }))
                : ToolExecutionResult.Error(result.Error ?? "删除工作流失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"删除工作流失败: {ex.Message}");
        }
    }
}

/// <summary>工作流 nodes / edges 的 JSON 解析（同一份规则供创建与更新复用）。</summary>
/// <remarks>
/// 模型产出的嵌套 JSON 经常不规范（数字写成字符串、坐标写成 "[N]" 占位符等），
/// 这里逐字段宽容读取：结构正确就尽量转成节点，单个字段异常时回退默认值，不整单失败。
/// </remarks>
internal static class WorkflowJson
{
    public static bool TryParseNodes(string? json, out List<NodeDto> nodes, out string error)
    {
        nodes = [];
        error = string.Empty;
        if (string.IsNullOrWhiteSpace(json)) return true;

        if (!TryReadArray(json, "nodes", out var items, out error)) return false;

        for (var i = 0; i < items.Count; i++)
        {
            var item = items[i];
            if (item.ValueKind != JsonValueKind.Object)
            {
                error = $"nodes[{i}] 不是对象";
                return false;
            }

            nodes.Add(new NodeDto
            {
                Id = ReadString(item, "id") ?? $"n{i + 1}",
                Type = ReadString(item, "type") ?? WorkflowNodeTypes.Agent,
                Label = ReadString(item, "label") ?? ReadString(item, "name") ?? string.Empty,
                AgentId = Guid.TryParse(ReadString(item, "agentId"), out var agentId) ? agentId : null,
                Config = ReadString(item, "config"),
                X = ReadDouble(item, "x"),
                Y = ReadDouble(item, "y"),
            });
        }

        return true;
    }

    public static bool TryParseEdges(string? json, out List<EdgeDto> edges, out string error)
    {
        edges = [];
        error = string.Empty;
        if (string.IsNullOrWhiteSpace(json)) return true;

        if (!TryReadArray(json, "edges", out var items, out error)) return false;

        for (var i = 0; i < items.Count; i++)
        {
            var item = items[i];
            if (item.ValueKind != JsonValueKind.Object)
            {
                error = $"edges[{i}] 不是对象";
                return false;
            }

            edges.Add(new EdgeDto
            {
                Id = ReadString(item, "id") ?? $"e{i + 1}",
                Source = ReadString(item, "source") ?? ReadString(item, "from") ?? string.Empty,
                Target = ReadString(item, "target") ?? ReadString(item, "to") ?? string.Empty,
                SourceHandle = ReadString(item, "sourceHandle"),
                TargetHandle = ReadString(item, "targetHandle"),
            });
        }

        return true;
    }

    private static bool TryReadArray(string json, string field, out List<JsonElement> items, out string error)
    {
        items = [];
        error = string.Empty;
        try
        {
            if (TryReadArrayCore(json, out items, out var firstError)) return true;

            // 弱模型常用反斜杠当引号、把数字写成 [N] 占位符、留尾逗号：修一遍再试
            var repaired = Repair(json);
            if (repaired != json && TryReadArrayCore(repaired, out items, out _)) return true;

            error = $"{field} 不是合法的 JSON 数组: {firstError}";
            return false;
        }
        catch (JsonException ex)
        {
            error = $"{field} 不是合法的 JSON 数组: {ex.Message}";
            return false;
        }
    }

    private static bool TryReadArrayCore(string json, out List<JsonElement> items, out string error)
    {
        items = [];
        error = string.Empty;
        var doc = JsonDocument.Parse(json);
        try
        {
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
            {
                error = "必须是 JSON 数组";
                return false;
            }
            // JsonElement 绑定在 JsonDocument 上，必须先 Clone 再释放文档
            items = doc.RootElement.EnumerateArray().Select(e => e.Clone()).ToList();
            return true;
        }
        finally
        {
            doc.Dispose();
        }
    }

    /// <summary>常见畸形 JSON 的修复：反斜杠引号、[N]/N 占位数字、尾逗号</summary>
    private static string Repair(string json)
    {
        var result = json;
        if (!result.Contains('"') && result.Contains('\\')) result = result.Replace('\\', '"');
        // 占位数字：{"x": [N]} / {"x": N}
        result = System.Text.RegularExpressions.Regex.Replace(result, @":\s*\[\s*[^\]""{]{0,12}\]", ": 0");
        result = System.Text.RegularExpressions.Regex.Replace(result, @":\s*[NnXx](?=\s*[,}\]])", ": 0");
        // 尾逗号
        result = System.Text.RegularExpressions.Regex.Replace(result, @",\s*([\]}])", "$1");
        return result;
    }

    private static string? ReadString(JsonElement item, string property)
        => item.TryGetProperty(property, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    /// <summary>坐标等数字：数字直读，字符串能转就转，其余（含 "[N]" 占位符）回退 0</summary>
    private static double ReadDouble(JsonElement item, string property)
    {
        if (!item.TryGetProperty(property, out var v)) return 0;
        return v.ValueKind switch
        {
            JsonValueKind.Number => v.GetDouble(),
            JsonValueKind.String => double.TryParse(v.GetString(), out var d) ? d : 0,
            _ => 0,
        };
    }
}
