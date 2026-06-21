using System.Text.Json;

namespace Hetu.Core.Interfaces;

/// <summary>
/// 工具执行器接口，每个内置工具实现此接口
/// </summary>
public interface IToolExecutor
{
    /// <summary>工具名称（唯一标识，LLM 调用时使用）</summary>
    string Name { get; }

    /// <summary>工具描述（传给 LLM 让它理解工具用途）</summary>
    string Description { get; }

    /// <summary>参数 JSON Schema（传给 LLM 让它知道如何构造参数）</summary>
    JsonElement ParametersSchema { get; }

    /// <summary>默认审批模式</summary>
    ToolApprovalMode DefaultApproval { get; }

    /// <summary>
    /// 工具使用指引（拼入 system prompt 的"工具使用约定"段落，告诉模型在什么场景下、以什么方式调用本工具）。
    /// 与 Description 互补：Description 描述"是什么 / 怎么调用"，UsageGuideline 描述"何时该用 / 与其他工具的协作规则"。
    /// 留空时该工具不会在 system prompt 中出现额外的约束条目。
    /// </summary>
    string? UsageGuideline => null;

    /// <summary>执行工具</summary>
    Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default);
}

/// <summary>
/// 工具执行结果
/// </summary>
public class ToolExecutionResult
{
    public string Content { get; set; } = string.Empty;
    public bool IsError { get; set; }

    public static ToolExecutionResult Success(string content) => new() { Content = content };
    public static ToolExecutionResult Error(string message) => new() { Content = message, IsError = true };
}
