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
                    groupId = p.GroupId,
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
    public string Description => "新建受管项目（本地目录或 SSH 远程目录），可同时指定分组与分类，出现在「项目」页";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public string? UsageGuideline => "用户明确要求新建项目时调用；目录路径必须由用户确认，不要凭空编造路径。SSH 项目需填 sshHost（必要时 sshUser / sshAuthType / sshKeyPath / sshPassword）；分组 ID 取自 list_project_groups。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "name": { "type": "string", "description": "项目名称" },
            "directoryPath": { "type": "string", "description": "项目目录（本地绝对路径；SSH 项目为远程主机上的绝对路径）" },
            "description": { "type": "string" },
            "projectType": { "type": "string", "description": "Local（本地目录，默认）| Ssh（SSH 远程目录）" },
            "sshHost": { "type": "string", "description": "SSH 主机地址（projectType=Ssh 必填）" },
            "sshPort": { "type": "integer", "description": "SSH 端口（默认 22）" },
            "sshUser": { "type": "string", "description": "SSH 登录用户（可选）" },
            "sshAuthType": { "type": "string", "description": "Key | Password | Agent（默认 Key）" },
            "sshKeyPath": { "type": "string", "description": "SSH 私钥文件路径（authType=Key 时使用）" },
            "sshPassword": { "type": "string", "description": "SSH 密码（authType=Password 必填）" },
            "groupId": { "type": "string", "description": "所属分组 ID（可选，见 list_project_groups）" },
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

            var (groupId, groupIdError) = ParseGroupId(argumentsJson);
            if (groupIdError != null) return ToolExecutionResult.Error(groupIdError);

            var result = await _projectService.CreateAsync(new CreateManagedProjectRequest
            {
                Name = name.Trim(),
                DirectoryPath = dir.Trim(),
                Description = ListProjectsTool.ReadString(argumentsJson, "description"),
                ProjectType = NormalizeProjectType(ListProjectsTool.ReadString(argumentsJson, "projectType")),
                SshHost = ListProjectsTool.ReadString(argumentsJson, "sshHost"),
                SshPort = ToolArgs.ReadInt(argumentsJson, "sshPort") ?? 22,
                SshUser = ListProjectsTool.ReadString(argumentsJson, "sshUser"),
                SshAuthType = NormalizeAuthType(ListProjectsTool.ReadString(argumentsJson, "sshAuthType")),
                SshKeyPath = ListProjectsTool.ReadString(argumentsJson, "sshKeyPath"),
                SshPassword = ListProjectsTool.ReadString(argumentsJson, "sshPassword"),
                GroupId = groupId,
                Category = ListProjectsTool.ReadString(argumentsJson, "category"),
                Tags = ListProjectsTool.SplitTags(ListProjectsTool.ReadString(argumentsJson, "tags")),
            }, cancellationToken);

            return result.Success && result.Data != null
                ? ToolExecutionResult.Success(ToolJson.Serialize(new { id = result.Data.Id, name = result.Data.Name, projectType = result.Data.ProjectType, groupName = result.Data.GroupName }))
                : ToolExecutionResult.Error(result.Error ?? "创建项目失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"创建项目失败: {ex.Message}");
        }
    }

    /// <summary>
    /// 读分组 ID 参数：未传 / 空串 → null（不分组或移出分组）；
    /// 传了非 GUID 值 → 返回错误，避免把分组名当成 ID 而悄悄移出分组。
    /// </summary>
    internal static (Guid? GroupId, string? Error) ParseGroupId(string argumentsJson)
    {
        var raw = ListProjectsTool.ReadString(argumentsJson, "groupId");
        if (raw == null || string.IsNullOrWhiteSpace(raw)) return (null, null);
        return Guid.TryParse(raw.Trim(), out var gid)
            ? (gid, null)
            : (null, "groupId 必须是有效 GUID（见 list_project_groups）；传空串表示移出分组");
    }

    /// <summary>项目类型归一：仅 Ssh 走远程，其余（含未传）按本地</summary>
    internal static string NormalizeProjectType(string? raw)
        => string.Equals(raw?.Trim(), "Ssh", StringComparison.OrdinalIgnoreCase) ? "Ssh" : "Local";

    /// <summary>SSH 认证方式归一：Key | Password | Agent，默认 Key</summary>
    internal static string NormalizeAuthType(string? raw)
    {
        var value = raw?.Trim();
        return string.Equals(value, "Password", StringComparison.OrdinalIgnoreCase) ? "Password"
            : string.Equals(value, "Agent", StringComparison.OrdinalIgnoreCase) ? "Agent"
            : "Key";
    }
}

public class UpdateProjectTool : IToolExecutor
{
    private readonly IManagedProjectService _projectService;

    public UpdateProjectTool(IManagedProjectService projectService) => _projectService = projectService;

    public string Name => "update_project";
    public string Description => "修改受管项目：名称、描述、类型（本地/SSH）、目录、SSH 连接、分组、分类、标签";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public string? UsageGuideline => "先用 list_projects 拿到项目 ID；只传需要改动的字段，未传字段保持原值（含分组与 SSH 连接信息）。groupId 传空串表示移出分组。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "id": { "type": "string", "description": "项目 ID（见 list_projects）" },
            "name": { "type": "string" },
            "description": { "type": "string" },
            "directoryPath": { "type": "string" },
            "projectType": { "type": "string", "description": "Local（本地）| Ssh（SSH 远程）；不传保持不变" },
            "groupId": { "type": "string", "description": "目标分组 ID（见 list_project_groups）；传空串移出分组，不传保持不变" },
            "category": { "type": "string" },
            "tags": { "type": "string", "description": "标签，逗号分隔；传空串清空标签" },
            "sshHost": { "type": "string", "description": "SSH 主机地址（仅 Ssh 项目）" },
            "sshPort": { "type": "integer", "description": "SSH 端口" },
            "sshUser": { "type": "string", "description": "SSH 登录用户；传空串清除" },
            "sshAuthType": { "type": "string", "description": "Key | Password | Agent" },
            "sshKeyPath": { "type": "string", "description": "SSH 私钥路径；传空串清除" },
            "sshPassword": { "type": "string", "description": "SSH 密码（authType=Password 时填写；不传保持原密码）" }
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

            var data = current.Data;
            var (groupId, groupIdError) = CreateProjectTool.ParseGroupId(argumentsJson);
            if (groupIdError != null) return ToolExecutionResult.Error(groupIdError);
            // 未显式传入的字段沿用现值：服务端对缺失的 SSH 用户 / 私钥路径与分组按「清空」处理，
            // 漏传会把项目移出分组、SSH 连接信息被抹掉
            var targetType = ToolArgs.Has(argumentsJson, "projectType")
                ? CreateProjectTool.NormalizeProjectType(ListProjectsTool.ReadString(argumentsJson, "projectType"))
                : data.ProjectType;
            var targetAuth = ToolArgs.Has(argumentsJson, "sshAuthType")
                ? CreateProjectTool.NormalizeAuthType(ListProjectsTool.ReadString(argumentsJson, "sshAuthType"))
                : data.SshAuthType;

            var result = await _projectService.UpdateAsync(id, new UpdateManagedProjectRequest
            {
                Name = ListProjectsTool.ReadString(argumentsJson, "name") ?? data.Name,
                Description = ListProjectsTool.ReadString(argumentsJson, "description") ?? data.Description,
                ProjectType = targetType,
                DirectoryPath = ListProjectsTool.ReadString(argumentsJson, "directoryPath") ?? data.DirectoryPath,
                GroupId = ToolArgs.Has(argumentsJson, "groupId") ? groupId : data.GroupId,
                Category = ListProjectsTool.ReadString(argumentsJson, "category") ?? data.Category,
                Tags = ListProjectsTool.SplitTags(ListProjectsTool.ReadString(argumentsJson, "tags")) ?? data.Tags,
                SshHost = ToolArgs.Has(argumentsJson, "sshHost")
                    ? ListProjectsTool.ReadString(argumentsJson, "sshHost")
                    : data.SshHost,
                SshPort = ToolArgs.ReadInt(argumentsJson, "sshPort") ?? data.SshPort,
                SshUser = ToolArgs.Has(argumentsJson, "sshUser")
                    ? ListProjectsTool.ReadString(argumentsJson, "sshUser")
                    : data.SshUser,
                SshAuthType = targetAuth,
                SshKeyPath = ToolArgs.Has(argumentsJson, "sshKeyPath")
                    ? ListProjectsTool.ReadString(argumentsJson, "sshKeyPath")
                    : data.SshKeyPath,
                // 密码：null 保持原值，空串清除，新值覆盖
                SshPassword = ListProjectsTool.ReadString(argumentsJson, "sshPassword"),
            }, cancellationToken);

            return result.Success
                ? ToolExecutionResult.Success($"已更新项目「{result.Data?.Name ?? data.Name}」")
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

/// <summary>项目分组工具：分组的查询与增删改，支撑「把项目归类到分组」。</summary>
public class ListProjectGroupsTool : IToolExecutor
{
    private readonly IProjectGroupService _groupService;

    public ListProjectGroupsTool(IProjectGroupService groupService) => _groupService = groupService;

    public string Name => "list_project_groups";
    public string Description => "列出全部项目分组（名称/说明/组内项目数），创建或移动项目前用本工具拿到分组 ID";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "要把项目归类分组、或确认分组是否存在时先调用；目标分组不存在时用 create_project_group 新建。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {}
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            var result = await _groupService.GetAllAsync(cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "获取项目分组失败");

            var items = result.Data
                .Select(g => new
                {
                    id = g.Id,
                    name = g.Name,
                    description = g.Description,
                    projectCount = g.ProjectCount,
                })
                .ToList();

            return ToolExecutionResult.Success(ToolJson.Serialize(new { total = items.Count, items }));
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"获取项目分组失败: {ex.Message}");
        }
    }
}

public class CreateProjectGroupTool : IToolExecutor
{
    private readonly IProjectGroupService _groupService;

    public CreateProjectGroupTool(IProjectGroupService groupService) => _groupService = groupService;

    public string Name => "create_project_group";
    public string Description => "新建项目分组（用于把项目按主题归类组织）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public string? UsageGuideline => "用户要把项目归类分组但目标分组不存在时调用；名称重复会报错，可先 list_project_groups 确认。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "name": { "type": "string", "description": "分组名称" },
            "description": { "type": "string", "description": "分组说明（可选）" }
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
            if (string.IsNullOrWhiteSpace(name))
                return ToolExecutionResult.Error("name 不能为空");

            var result = await _groupService.CreateAsync(new CreateProjectGroupRequest
            {
                Name = name.Trim(),
                Description = ListProjectsTool.ReadString(argumentsJson, "description"),
            }, cancellationToken);

            return result.Success && result.Data != null
                ? ToolExecutionResult.Success(ToolJson.Serialize(new { id = result.Data.Id, name = result.Data.Name }))
                : ToolExecutionResult.Error(result.Error ?? "创建项目分组失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"创建项目分组失败: {ex.Message}");
        }
    }
}

public class UpdateProjectGroupTool : IToolExecutor
{
    private readonly IProjectGroupService _groupService;

    public UpdateProjectGroupTool(IProjectGroupService groupService) => _groupService = groupService;

    public string Name => "update_project_group";
    public string Description => "修改项目分组：重命名、改说明、调整排序";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public string? UsageGuideline => "先用 list_project_groups 拿到分组 ID；未传 sortOrder 时保持原排序，组内项目不受影响。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "id": { "type": "string", "description": "分组 ID（见 list_project_groups）" },
            "name": { "type": "string", "description": "新分组名称（可选）" },
            "description": { "type": "string", "description": "分组说明（可选；传空串清除）" },
            "sortOrder": { "type": "integer", "description": "排序值（可选，不传保持不变）" }
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

            var all = await _groupService.GetAllAsync(cancellationToken);
            if (!all.Success || all.Data == null)
                return ToolExecutionResult.Error(all.Error ?? "获取项目分组失败");

            var group = all.Data.FirstOrDefault(g => g.Id == id);
            if (group == null)
                return ToolExecutionResult.Error("分组不存在");

            var result = await _groupService.UpdateAsync(id, new UpdateProjectGroupRequest
            {
                Name = ListProjectsTool.ReadString(argumentsJson, "name") ?? group.Name,
                Description = ToolArgs.Has(argumentsJson, "description")
                    ? ListProjectsTool.ReadString(argumentsJson, "description")
                    : group.Description,
                SortOrder = ToolArgs.ReadInt(argumentsJson, "sortOrder") ?? group.SortOrder,
            }, cancellationToken);

            return result.Success
                ? ToolExecutionResult.Success($"已更新分组「{result.Data?.Name ?? group.Name}」")
                : ToolExecutionResult.Error(result.Error ?? "更新项目分组失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"更新项目分组失败: {ex.Message}");
        }
    }
}

public class DeleteProjectGroupTool : IToolExecutor
{
    private readonly IProjectGroupService _groupService;

    public DeleteProjectGroupTool(IProjectGroupService groupService) => _groupService = groupService;

    public string Name => "delete_project_group";
    public string Description => "删除项目分组（组内项目移到「未分组」，不会删除项目本身）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public string? UsageGuideline => "破坏性操作：必须先用 ask_question 与用户确认分组名称与 ID，再调用。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "id": { "type": "string", "description": "分组 ID（见 list_project_groups）" }
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

            var result = await _groupService.DeleteAsync(id, cancellationToken);
            return result.Success
                ? ToolExecutionResult.Success("分组已删除，组内项目已移到「未分组」")
                : ToolExecutionResult.Error(result.Error ?? "删除项目分组失败");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"删除项目分组失败: {ex.Message}");
        }
    }
}
