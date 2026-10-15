using System.Text.Json;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services.Tools;

/// <summary>
/// 唤起前端工作台面板：通过 SignalR 推 uiAction，由界面切换到对应标签页。
/// 后端不依赖前端请求即可主动触发，是「智能体操作界面」的入口。
/// </summary>
public class OpenPanelTool : IToolExecutor
{
    private readonly IUiPushService _uiPush;

    public OpenPanelTool(IUiPushService uiPush) => _uiPush = uiPush;

    public string Name => "open_panel";
    public string Description => "唤起 Code 工作台的界面面板（浏览器 / PR / Git / 终端等），界面会实时切换到对应标签页。当需要让用户在界面上看到某个面板时调用。";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "只在对用户有直接价值时唤起：预览网页用 browser（配合 url）、查看/创建 PR 用 pr、查看构建输出用 terminal、查看改动用 changes；纯内部的代码读写不要唤起面板打断用户。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "panel": {
                "type": "string",
                "enum": ["browser", "pr", "git", "terminal", "changes", "checkpoints"],
                "description": "要唤起的面板：browser=内置浏览器, pr=Pull Request, git=版本控制, terminal=终端, changes=文件更改, checkpoints=检查点"
            },
            "url": { "type": "string", "description": "panel=browser 时要打开的网址（可选，不传则显示起始页）" }
        },
        "required": ["panel"]
    }
    """).RootElement;

    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        string panel;
        string? url = null;
        try
        {
            using var doc = JsonDocument.Parse(argumentsJson);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("panel", out var panelNode)
                || panelNode.ValueKind != JsonValueKind.String
                || string.IsNullOrWhiteSpace(panelNode.GetString()))
            {
                return ToolExecutionResult.Error("缺少必填参数 panel");
            }
            panel = panelNode.GetString()!;
            if (root.TryGetProperty("url", out var urlNode) && urlNode.ValueKind == JsonValueKind.String)
                url = urlNode.GetString();
        }
        catch (JsonException ex)
        {
            return ToolExecutionResult.Error($"参数解析失败：{ex.Message}");
        }

        await _uiPush.PublishAsync("open_panel", new { panel, url }, cancellationToken);
        return ToolExecutionResult.Success(url == null
            ? $"已唤起面板：{panel}"
            : $"已在内置浏览器中打开 {url}");
    }
}
