using Hetu.Core.Services;

namespace Hetu.Core.Interfaces;

/// <summary>
/// Hetu 的 Agent 执行入口。实现由 <c>Hetu.Agents</c> 提供，内部直接使用 Microsoft Agent Framework 的 <c>AIAgent</c>，
/// 不再保留自实现的模型/工具循环适配层。
/// </summary>
public interface IAgentRunner
{
    /// <summary>解析请求模型 / 回退模型 / 默认对话模型，返回给控制器展示用的模型信息。</summary>
    Task<AgentModelInfo?> ResolveModelAsync(string? requestedModelId, Guid? fallbackModelId, CancellationToken ct);

    /// <summary>异步加载指定 MCP 服务器的工具并注册为运行时工具，返回工具名列表。</summary>
    Task<List<string>> LoadMcpToolsAsync(List<Guid> mcpServerIds, CancellationToken ct);

    /// <summary>执行一次 Agent 运行。</summary>
    Task<AgentLoopResult> RunAsync(AgentLoopRequest request, CancellationToken ct);
}