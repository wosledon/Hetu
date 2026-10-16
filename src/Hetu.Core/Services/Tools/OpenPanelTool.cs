using System.Text.Json;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services.Tools;

/// <summary>
/// 唤起前端界面：通过 SignalR 推 uiAction（panel 走 open_panel、page 走 navigate），
/// 由界面切换工作台标签页或跳转应用页面。后端不依赖前端请求即可主动触发，是「智能体操作界面」的入口。
/// </summary>
public class OpenPanelTool : IToolExecutor
{
    /// <summary>Code 工作台的功能标签页（与前端 WorkExplorer 的 FeatureKind 对应）</summary>
    private static readonly string[] WorkbenchPanels =
        ["browser", "pr", "git", "terminal", "changes", "checkpoints", "files"];

    /// <summary>可跳转的应用页面名 → 前端路由（与 frontend/src/App.tsx 的路由表对应）</summary>
    private static readonly Dictionary<string, string> PageRoutes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["notes"] = "/",
        ["tags"] = "/tags",
        ["code"] = "/code",
        ["graph"] = "/graph",
        ["knowledge"] = "/knowledge-base",
        ["kanban"] = "/kanban",
        ["tasks"] = "/tasks/background",
        ["projects"] = "/projects",
        ["wiki"] = "/wiki",
        ["memories"] = "/memories",
        ["models"] = "/models",
        ["agents"] = "/agents",
        ["skills"] = "/skills",
        ["workflows"] = "/workflows",
        ["usage"] = "/usage",
        ["inbox"] = "/inbox",
        ["apps"] = "/apps",
        ["tools"] = "/tools",
        ["proxy"] = "/proxy",
        ["trash"] = "/trash",
        ["settings"] = "/settings",
    };

    private readonly IUiPushService _uiPush;

    public OpenPanelTool(IUiPushService uiPush) => _uiPush = uiPush;

    public string Name => "open_panel";
    public string Description => "唤起 Hetu 界面：panel 打开 Code 工作台面板（浏览器 / PR / Git / 终端等），page 跳转到应用页面（笔记 / 看板 / 图谱等），界面会实时切换。";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "只在对用户有直接价值时唤起：预览网页用 browser（配合 url）、查看/创建 PR 用 pr、查看构建输出用 terminal、查看改动用 changes、展示某个文件用 files（配合 path）、引导用户去某个页面用 page（如 kanban、inbox）；纯内部的代码读写不要唤起界面打断用户。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "panel": {
                "type": "string",
                "enum": ["browser", "pr", "git", "terminal", "changes", "checkpoints", "files"],
                "description": "要唤起的工作台面板（与 page 二选一）：browser=内置浏览器, pr=Pull Request, git=版本控制, terminal=终端, changes=文件更改, checkpoints=检查点, files=文件树"
            },
            "page": {
                "type": "string",
                "enum": ["notes", "tags", "code", "graph", "knowledge", "kanban", "tasks", "projects", "wiki", "memories", "models", "agents", "skills", "workflows", "usage", "inbox", "apps", "tools", "proxy", "trash", "settings"],
                "description": "要跳转的应用页面（与 panel 二选一）：notes=笔记, graph=知识图谱, knowledge=知识库, kanban=任务看板, tasks=后台任务, inbox=收件箱, settings=设置 等"
            },
            "url": { "type": "string", "description": "panel=browser 时要打开的网址（可选，不传则显示起始页；无协议时按 https 处理）" },
            "path": { "type": "string", "description": "panel=files 时要在编辑器中打开的项目内相对路径（可选，不传则只显示文件树）" }
        }
    }
    """).RootElement;

    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        string? panel = null, page = null, url = null, path = null;
        try
        {
            using var doc = JsonDocument.Parse(argumentsJson);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
                return ToolExecutionResult.Error("参数必须是 JSON 对象");
            panel = ReadString(root, "panel");
            page = ReadString(root, "page");
            url = ReadString(root, "url");
            path = ReadString(root, "path");
        }
        catch (JsonException ex)
        {
            return ToolExecutionResult.Error($"参数解析失败：{ex.Message}");
        }

        if (panel != null && page != null)
            return ToolExecutionResult.Error("panel 与 page 只能传一个");

        if (panel != null)
        {
            var name = panel.ToLowerInvariant();
            if (!WorkbenchPanels.Contains(name))
                return ToolExecutionResult.Error($"未知面板 panel：{panel}，可选值：{string.Join("、", WorkbenchPanels)}");
            if (path != null && name != "files")
                return ToolExecutionResult.Error("path 仅在 panel=files 时可用");
            if (url != null && name != "browser")
                return ToolExecutionResult.Error("url 仅在 panel=browser 时可用");
            if (url != null)
                url = NormalizeUrl(url);

            // 先确保前端位于 /code：WorkPage 未挂载时 open_panel 会被前端暂存，挂载后补发
            await _uiPush.PublishAsync("navigate", new { path = "/code" }, cancellationToken);
            await _uiPush.PublishAsync("open_panel", new { panel = name, url, path }, cancellationToken);

            if (name == "browser" && url != null)
                return ToolExecutionResult.Success($"已在内置浏览器中打开 {url}");
            if (name == "files" && path != null)
                return ToolExecutionResult.Success($"已在编辑器中打开 {path}");
            return ToolExecutionResult.Success($"已唤起面板：{name}");
        }

        if (page != null)
        {
            if (!PageRoutes.TryGetValue(page, out var route))
                return ToolExecutionResult.Error($"未知页面 page：{page}，可选值：{string.Join("、", PageRoutes.Keys)}");
            await _uiPush.PublishAsync("navigate", new { path = route }, cancellationToken);
            return ToolExecutionResult.Success($"已跳转到 {page} 页面");
        }

        return ToolExecutionResult.Error("缺少必填参数：panel 与 page 二选一");
    }

    private static string? ReadString(JsonElement root, string name)
        => root.TryGetProperty(name, out var node) && node.ValueKind == JsonValueKind.String
            && !string.IsNullOrWhiteSpace(node.GetString())
            ? node.GetString()!.Trim()
            : null;

    /// <summary>补全协议：模型常给出 example.com 这类无协议地址</summary>
    private static string NormalizeUrl(string url)
        => url.Contains("://", StringComparison.OrdinalIgnoreCase) ? url : $"https://{url}";
}
