using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

namespace Hetu.Agents;

/// <summary>Agent 创建入口；生产实现是 <see cref="HetuAgentFactory"/>，测试可替换为脚本化 ChatClient。</summary>
internal interface IAgentFactory
{
    Task<ResolvedAgentModel?> ResolveAsync(Guid? modelId, CancellationToken ct);
    AIAgent Create(ResolvedAgentModel model, ChatClientAgentOptions agentOptions, AgentRunState state, int maxIterations);
    Task<AIAgent?> CreateTextAgentAsync(Guid? modelId, string? instructions, ChatOptions? overrides, CancellationToken ct);
}