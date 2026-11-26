using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

namespace Hetu.Agents;

/// <summary>
/// MAF ChatHistoryProvider 的消息压缩器：
/// 短消息跳过；长消息替换文本内容；历史接近上下文上限时先摘要旧消息、保留最近消息。
/// </summary>
internal sealed class HetuChatReducer : IChatReducer
{
    private const int KeepRecent = 6;
    private const int DefaultContextWindow = 128_000;
    private const double AutoCompactRatio = 0.8;

    private readonly CompressionPipelineService _compression;
    private readonly IContextCompactor _contextCompactor;
    private readonly AgentRunState _state;
    private readonly int _inputChars;
    private readonly int _contextWindowTokens;

    public HetuChatReducer(
        CompressionPipelineService compression,
        IContextCompactor contextCompactor,
        AgentRunState state,
        int inputChars,
        int? contextWindowTokens)
    {
        _compression = compression;
        _contextCompactor = contextCompactor;
        _state = state;
        _inputChars = inputChars;
        _contextWindowTokens = contextWindowTokens is > 0 ? contextWindowTokens.Value : DefaultContextWindow;
    }

    public async Task<IEnumerable<ChatMessage>> ReduceAsync(
        IEnumerable<ChatMessage> messages,
        CancellationToken cancellationToken = default)
    {
        var source = messages.ToList();
        if (_state.Result.FirstIterationInputChars == 0)
        {
            _state.Result.FirstIterationInputChars = _inputChars + source.Sum(message => message.Text.Length);
        }

        var reduced = await TrySummarizeAsync(source, cancellationToken)
                      ?? await CompressMessagesAsync(source, cancellationToken);

        if (_state.Result.FirstIterationCompressedChars == 0)
        {
            _state.Result.FirstIterationCompressedChars = _inputChars + reduced.Sum(message => message.Text.Length);
        }
        return reduced;
    }

    private async Task<List<ChatMessage>?> TrySummarizeAsync(
        IReadOnlyList<ChatMessage> source,
        CancellationToken cancellationToken)
    {
        if (source.Count <= KeepRecent) return null;

        var estimatedTokens = source.Sum(message => message.Text.Length) / 3;
        if (estimatedTokens < _contextWindowTokens * AutoCompactRatio) return null;

        var older = source.Take(source.Count - KeepRecent)
            .Select(AgentMessageMapper.ToLlmMessage)
            .ToList();
        var summary = await _contextCompactor.SummarizeTurnAsync(older, _state.Request.ModelId, cancellationToken);
        if (string.IsNullOrWhiteSpace(summary)) return null;

        var reduced = new List<ChatMessage>(KeepRecent + 1)
        {
            new(ChatRole.User, $"（以下是此前对话的压缩摘要，原文已不再随上下文发送，可据此继续）\n{summary.Trim()}"),
        };
        reduced.AddRange(await CompressMessagesAsync(source.Skip(source.Count - KeepRecent).ToList(), cancellationToken));
        return reduced;
    }

    private async Task<List<ChatMessage>> CompressMessagesAsync(
        IReadOnlyList<ChatMessage> source,
        CancellationToken cancellationToken)
    {
        var reduced = new List<ChatMessage>(source.Count);
        foreach (var message in source)
        {
            var contents = new List<AIContent>(message.Contents.Count);
            var changed = false;
            foreach (var content in message.Contents)
            {
                if (content is not TextContent text || string.IsNullOrWhiteSpace(text.Text))
                {
                    contents.Add(content);
                    continue;
                }

                var compressed = await _compression.PrepareForContextAsync(text.Text, cancellationToken);
                if (compressed == text.Text)
                {
                    contents.Add(content);
                    continue;
                }

                contents.Add(new TextContent(compressed));
                changed = true;
            }

            reduced.Add(changed
                ? new ChatMessage(message.Role, contents)
                {
                    AuthorName = message.AuthorName,
                    MessageId = message.MessageId,
                    AdditionalProperties = message.AdditionalProperties,
                }
                : message);
        }
        return reduced;
    }
}