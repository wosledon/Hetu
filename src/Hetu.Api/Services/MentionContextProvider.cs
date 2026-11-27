using Hetu.Api.Streaming;
using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

namespace Hetu.Api.Services;

/// <summary>
/// 把输入框 @ 引用包装成 MAF AIContextProvider：首次调用时解析引用并返回上下文消息。
/// </summary>
public sealed class MentionContextProvider : AIContextProvider
{
    private readonly MentionContextBuilder _builder;
    private readonly IReadOnlyList<ChatMentionRef>? _mentions;
    private readonly SseStreamWriter _writer;
    private readonly object _gate = new();
    private IReadOnlyList<ChatMessage>? _messages;
    private bool _loaded;

    public MentionContextProvider(
        MentionContextBuilder builder,
        IReadOnlyList<ChatMentionRef>? mentions,
        SseStreamWriter writer)
        : base(null, null, null)
    {
        _builder = builder;
        _mentions = mentions;
        _writer = writer;
    }

    protected override async ValueTask<AIContext> ProvideAIContextAsync(
        InvokingContext context,
        CancellationToken cancellationToken = default)
    {
        if (_loaded) return new AIContext { Messages = [] };

        lock (_gate)
        {
            if (_loaded) return new AIContext { Messages = [] };
            _loaded = true;
        }

        if (_mentions is not { Count: > 0 })
            return new AIContext { Messages = [] };

        var messages = new List<ChatMessage>
        {
            new(ChatRole.User, string.Empty),
        };
        var resolved = await _builder.BuildAsync(_mentions.ToList(), messages, cancellationToken);
        if (resolved > 0)
            await _writer.WriteJsonAsync(new { type = "mentions", count = resolved });

        _messages = messages.Take(Math.Max(0, messages.Count - 1)).ToList();
        return new AIContext { Messages = _messages };
    }
}