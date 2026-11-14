using System.Text.Json;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services.Tools;

public class TodoTool : IToolExecutor
{
    public string Name => "todo";
    public string Description => "规划和追踪复杂多步骤工作：create 创建步骤，update 开始步骤，complete 完成步骤。update/complete 优先使用 create 返回的 id，也可以用 title 精确匹配；每一步完成后及时更新，不要最后批量补记。";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public string? UsageGuideline => "复杂多步骤任务或经 plan 批准的计划用 todo 跟踪；简单任务不要额外创建清单，也不要为同一计划再次调用 plan。开始步骤前 update→in-progress，完成后立即 complete，禁止批量完成。";

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
