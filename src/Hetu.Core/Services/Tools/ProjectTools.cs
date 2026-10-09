using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Shared.Projects;

namespace Hetu.Core.Services.Tools;

/// <summary>项目管理工具：受管项目（项目管理页）与 Code 视图挂载的项目。</summary>
public class ListProjectsTool : IToolExecutor
{
    private readonly IManagedProjectService _projectService;

    public ListProjectsTool(IManagedProjectService projectService) => _projectService = projectService;

    public string Name => "list_projects";
    public string Description => "列出全部受管项目（名称/分组/分类/标签/目录/关联 Code 项目）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "用户提到「我的项目」「某个项目」时先调用本工具拿到项目 ID 与目录，再做后续操作。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "keyword": { "type": "string", "description": "按名称/分类/标签过滤（可选）" }
        }
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var result = await _projectService.GetAllAsync(cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "获取项目列表失败");

            var keyword = ReadString(argumentsJson, "keyword");
            var items = result.Data
                .Where(p => string.IsNullOrWhiteSpace(keyword)
                    || p.Name.Contains(keyword, StringComparison.OrdinalIgnoreCase)
                    || (p.Category ?? "").Contains(keyword, StringComparison.OrdinalIgnoreCase)
                    || string.Join(",", p.Tags).Contains(keyword, StringComparison.OrdinalIgnoreCase))
                .Select(p => new
                {
                    id = p.Id,
                    name = p.Name,
                    description = p.Description,
                    projectType = p.ProjectType,
                    directoryPath = p.DirectoryPath,
                    groupName = p.GroupName,
                    category = p.Category,
                    tags = string.Join(",", p.Tags),
                    workProjectId = p.WorkProjectId,
                })
                .ToList();

            return ToolExecutionResult.Success(ToolJson.Serialize(new { total = items.Count, items }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"获取项目列表失败: {ex.Message}");
        }
    }

    internal static string? ReadString(string argumentsJson, string property)
    {
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(argumentsJson) ? "{}" : argumentsJson);
            return doc.RootElement.TryGetProperty(property, out var v) && v.ValueKind == JsonValueKind.String
                ? v.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>逗号/中文逗号分隔的标签串 → 列表；未传时返回 null（表示不改动）</summary>
    internal static List<string>? SplitTags(string? raw)
    {
        if (raw == null) return null;
        return raw.Split([',', '，', ';', '；'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
    }
}

public class CreateProjectTool : IToolExecutor
{
    private readonly IManagedProjectService _projectService;

    public CreateProjectTool(IManagedProjectService projectService) => _projectService = projectService;

    public string Name => "create_project";
    public string Description => "新建受管项目（本地目录或 SSH 远程目录），出现在「项目」页";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public string? UsageGuideline => "用户明确要求新建项目时调用；目录路径必须由用户确认，不要凭空编造路径。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "name": { "type": "string", "description": "项目名称" },
            "directoryPath": { "type": "string", "description": "项目目录（本地绝对路径）" },
            "description": { "type": "string" },
            "category": { "type": "string", "description": "分类（可选）" },
            "tags": { "type": "string", "description": "标签，逗号分隔（可选）" }
        },
        "required": ["name", "directoryPath"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var name = ListProjectsTool.ReadString(argumentsJson, "name");
            var dir = ListProjectsTool.ReadString(argumentsJson, "directoryPath");
            if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(dir))
                return ToolExecutionResult.Error("name 与 directoryPath 不能为空");

            var result = await _projectService.CreateAsync(new CreateManagedProjectRequest
            {
                Name = name.Trim(),
                DirectoryPath = dir.Trim(),
                Description = ListProjectsTool.ReadString(argumentsJson, "description"),
                Category = ListProjectsTool.ReadString(argumentsJson, "category"),
                Tags = ListProjectsTool.SplitTags(ListProjectsTool.ReadString(argumentsJson, "tags")),
            }, cancellationToken);

            return result.Success && result.Data != null
                ? ToolExecutionResult.Success(ToolJson.Serialize(new { id = result.Data.Id, name = result.Data.Name }))
                : ToolExecutionResult.Error(result.Error ?? "创建项目失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"创建项目失败: {ex.Message}");
        }
    }
}

public class UpdateProjectTool : IToolExecutor
{
    private readonly IManagedProjectService _projectService;

    public UpdateProjectTool(IManagedProjectService projectService) => _projectService = projectService;

    public string Name => "update_project";
    public string Description => "修改受管项目：名称、描述、分类、标签、目录";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public string? UsageGuideline => "先用 list_projects 拿到项目 ID；只传需要改动的字段。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "id": { "type": "string", "description": "项目 ID（见 list_projects）" },
            "name": { "type": "string" },
            "description": { "type": "string" },
            "category": { "type": "string" },
            "tags": { "type": "string", "description": "标签，逗号分隔" },
            "directoryPath": { "type": "string" }
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

            var current = await _projectService.GetByIdAsync(id, cancellationToken);
            if (!current.Success || current.Data == null)
                return ToolExecutionResult.Error(current.Error ?? "项目不存在");

            var result = await _projectService.UpdateAsync(id, new UpdateManagedProjectRequest
            {
                Name = ListProjectsTool.ReadString(argumentsJson, "name") ?? current.Data.Name,
                Description = ListProjectsTool.ReadString(argumentsJson, "description") ?? current.Data.Description,
                Category = ListProjectsTool.ReadString(argumentsJson, "category") ?? current.Data.Category,
                Tags = ListProjectsTool.SplitTags(ListProjectsTool.ReadString(argumentsJson, "tags")) ?? current.Data.Tags,
                DirectoryPath = ListProjectsTool.ReadString(argumentsJson, "directoryPath") ?? current.Data.DirectoryPath,
            }, cancellationToken);

            return result.Success
                ? ToolExecutionResult.Success($"已更新项目「{result.Data?.Name ?? current.Data.Name}」")
                : ToolExecutionResult.Error(result.Error ?? "更新项目失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"更新项目失败: {ex.Message}");
        }
    }
}

public class DeleteProjectTool : IToolExecutor
{
    private readonly IManagedProjectService _projectService;

    public DeleteProjectTool(IManagedProjectService projectService) => _projectService = projectService;

    public string Name => "delete_project";
    public string Description => "删除受管项目（只删除条目，不动磁盘文件）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public string? UsageGuideline => "破坏性操作：必须先用 ask_question 与用户确认项目名称与 ID，再调用。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": { "id": { "type": "string", "description": "项目 ID" } },
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

            var result = await _projectService.DeleteAsync(id, cancellationToken);
            return result.Success ? ToolExecutionResult.Success("项目已删除（磁盘文件未改动）") : ToolExecutionResult.Error(result.Error ?? "删除项目失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"删除项目失败: {ex.Message}");
        }
    }
}

/// <summary>Code 视图挂载的项目（含会话数），与文件类工具的项目上下文一致。</summary>
public class ListWorkProjectsTool : IToolExecutor
{
    private readonly IWorkProjectService _workProjectService;

    public ListWorkProjectsTool(IWorkProjectService workProjectService) => _workProjectService = workProjectService;

    public string Name => "list_work_projects";
    public string Description => "列出 Code 视图可挂载的项目（名称/根目录/会话数/连接的 MCP 与技能）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "用户在对话里问「有哪些可编码的项目」时调用；本工具与文件工具不同，不需要项目上下文。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": { "keyword": { "type": "string", "description": "按名称过滤（可选）" } }
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var result = await _workProjectService.GetAllAsync(cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "获取 Code 项目失败");

            var keyword = ListProjectsTool.ReadString(argumentsJson, "keyword");
            var items = result.Data
                .Where(p => string.IsNullOrWhiteSpace(keyword) || p.Name.Contains(keyword, StringComparison.OrdinalIgnoreCase))
                .Select(p => new
                {
                    id = p.Id,
                    name = p.Name,
                    rootPath = p.RootPath,
                    connectionType = p.ConnectionType,
                    sessionCount = p.SessionCount,
                    groupName = p.GroupName,
                    category = p.Category,
                })
                .ToList();

            return ToolExecutionResult.Success(ToolJson.Serialize(new { total = items.Count, items }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"获取 Code 项目失败: {ex.Message}");
        }
    }
}
