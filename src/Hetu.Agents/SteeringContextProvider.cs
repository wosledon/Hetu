using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

namespace Hetu.Agents;

/// <summary>
/// MAF AIContextProvider：在每次模型调用前把运行中引导注入为一条 user 消息。
/// </summary>
internal sealed class SteeringContextProvider : AIContextProvider
{
    private const string SteeringPrefix = "【运行中引导，请立即结合它调整当前工作】\n";

    private readonly AgentRunState _state;

    public SteeringContextProvider(AgentRunState state)
        : base(null, null, null)
    {
        _state = state;
    }

    protected override async ValueTask<AIContext> ProvideAIContextAsync(
        InvokingContext context,
        CancellationToken cancellationToken = default)
    {
        if (_state.Request.DrainSteering is not { } drain)
            return new AIContext { Messages = [] };

        var messages = new List<ChatMessage>();
        foreach (var guidance in drain())
        {
            if (string.IsNullOrWhiteSpace(guidance)) continue;
            messages.Add(new ChatMessage(ChatRole.User, SteeringPrefix + guidance));
            await _state.Sink.OnSteeringAsync(guidance);
        }
        return new AIContext { Messages = messages };
    }
}