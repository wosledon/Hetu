using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

namespace Hetu.Agents;

/// <summary>
/// 由调用方从数据库加载好历史后交给 MAF 的 ChatHistoryProvider。
/// 历史在本次运行内继续累积（续跑时可见前一段消息），数据库持久化仍由 Controller 负责。
/// </summary>
public sealed class PreloadedChatHistoryProvider : ChatHistoryProvider
{
    private readonly List<ChatMessage> _messages;
    private readonly object _gate = new();

    public PreloadedChatHistoryProvider(IEnumerable<ChatMessage> initialMessages)
    {
        _messages = initialMessages.ToList();
    }

    public override IReadOnlyList<string> StateKeys => ["hetu-preloaded-history"];

    protected override ValueTask<IEnumerable<ChatMessage>> ProvideChatHistoryAsync(
        InvokingContext context,
        CancellationToken cancellationToken = default)
    {
        lock (_gate)
        {
            return new ValueTask<IEnumerable<ChatMessage>>(_messages.ToList());
        }
    }

    protected override ValueTask StoreChatHistoryAsync(
        InvokedContext context,
        CancellationToken cancellationToken = default)
    {
        lock (_gate)
        {
            _messages.AddRange(context.RequestMessages);
            if (context.ResponseMessages is not null)
                _messages.AddRange(context.ResponseMessages);
        }
        return default;
    }
}