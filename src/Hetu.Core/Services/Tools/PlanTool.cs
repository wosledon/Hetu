using System.Text.Json;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services.Tools;

/// <summary>
/// 计划工具：Agent 把即将实施的步骤整理成结构化计划提交给用户确认。
/// 与 ask_question 一样属于交互型工具——参数原样透传，由 Agent Loop 拦截，
/// 通过 SSE 弹出抽屉等待用户批准 / 驳回（可附修改意见）。
/// </summary>
public class PlanTool : IToolExecutor
{
    public string Name => "plan";
    public string Description => "向用户提交一份执行计划以供确认。适用于多步骤、有副作用或影响面较大的任务：先列出计划步骤，用户批准后再执行；被驳回时根据反馈修改计划。";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public string? UsageGuideline => "用户需求涉及 ≥2 个执行步骤、或包含写操作/删除/安装依赖等副作用时，先提交计划等用户批准再动手；需求本身很单一时不要滥用。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "title": { "type": "string", "description": "计划标题（一句话概括要做什么）" },
            "summary": { "type": "string", "description": "背景与目标说明（可选）" },
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": { "type": "string", "description": "步骤标题" },
                        "description": { "type": "string", "description": "步骤详细说明（可选）" }
                    },
                    "required": ["title"]
                },
                "description": "按执行顺序排列的步骤列表"
            }
        },
        "required": ["title", "steps"]
    }
    """).RootElement;

    public JsonElement ParametersSchema => _schema;

    public Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        // Pass through arguments as-is; the Agent Loop will intercept and send via SSE to the frontend
        return Task.FromResult(ToolExecutionResult.Success(argumentsJson));
    }
}
