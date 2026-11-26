using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Hetu.Core.Services;

namespace Hetu.Agents;

/// <summary>
/// MAF ChatHistoryProvider 的消息压缩器：历史消息在每次取用前经过压缩管道，
/// 短消息直接跳过，长消息只替换文本内容，保留工具调用等非文本块。
/// </summary>
internal sealed class HetuChatReducer : IChatReducer
{
    private readonly CompressionPipelineService _compression;
    private readonly AgentRunState _state;
    private readonly int _inputChars;

    public HetuChatReducer(CompressionPipelineService compression, AgentRunState state, int inputChars)
    {
        _compression = compression;
        _state = state;
        _inputChars = inputChars;
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

        if (_state.Result.FirstIterationCompressedChars == 0)
        {
            _state.Result.FirstIterationCompressedChars = _inputChars + reduced.Sum(message => message.Text.Length);
        }
        return reduced;
    }
}