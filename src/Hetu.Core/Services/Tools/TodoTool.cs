using System.Text.Json;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services.Tools;

public class TodoTool : IToolExecutor
{
    public string Name => "todo";
    public string Description => "规划和追踪你的工作步骤。使用规则：(1) 收到复杂任务时，先用 action=create 把任务拆解为多个子步骤；(2) 开始执行某一步前，调用 action=update 把它的 status 改为 in-progress；(3) 完成某一步后，立即调用 action=complete 把它标记完成；(4) 这是强制流程：每完成一个子步骤都必须调用一次 complete，不要等到最后才更新；(5) update/complete 时优先用 create 时返回的 id，也可以用 title 精确匹配。";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["create", "update", "list", "complete"],
                "description": "create=创建步骤, update=更新进度, list=查看当前计划, complete=标记完成"
            },
            "id": { "type": "string", "description": "步骤 ID（update/complete 时使用，从 create 的返回结果中获取）" },
            "title": { "type": "string", "description": "步骤标题（create 时需要；complete/update 时若不确定 id 可传 title 来匹配）" },
            "description": { "type": "string", "description": "步骤详细说明（可选）" },
            "status": {
                "type": "string",
                "enum": ["not-started", "in-progress", "completed"],
                "description": "当前进度（update 时需要）"
            }
        },
        "required": ["action"]
    }
    """).RootElement;

    public JsonElement ParametersSchema => _schema;

    public Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        // Pass through arguments as-is; the Agent Loop will intercept and handle the todo state
        return Task.FromResult(ToolExecutionResult.Success(argumentsJson));
    }
}
