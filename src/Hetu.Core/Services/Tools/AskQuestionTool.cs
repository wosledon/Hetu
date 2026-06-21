using System.Text.Json;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services.Tools;

public class AskQuestionTool : IToolExecutor
{
    public string Name => "ask_question";
    public string Description => "向用户提问以澄清需求或确认信息。提供预设选项的同时，用户可以通过自由输入框补充不在选项中的回答。";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "header": { "type": "string", "description": "问题标题" },
                        "question": { "type": "string", "description": "问题内容" },
                        "options": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "label": { "type": "string", "description": "选项标签" },
                                    "description": { "type": "string", "description": "选项说明" }
                                },
                                "required": ["label"]
                            },
                            "description": "可选项列表"
                        },
                        "allowCustom": {
                            "type": "boolean",
                            "description": "是否允许用户自由输入补充（默认 true）",
                            "default": true
                        }
                    },
                    "required": ["header", "question"]
                },
                "description": "问题列表"
            }
        },
        "required": ["questions"]
    }
    """).RootElement;

    public JsonElement ParametersSchema => _schema;

    public Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        // Pass through arguments as-is; the Agent Loop will intercept and send via SSE to the frontend
        return Task.FromResult(ToolExecutionResult.Success(argumentsJson));
    }
}
