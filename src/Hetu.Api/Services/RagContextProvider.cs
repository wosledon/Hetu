using Hetu.Api.Streaming;
using Hetu.Core.Interfaces;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

namespace Hetu.Api.Services;

/// <summary>
/// 把网络搜索 / 知识库 / 记忆检索包装成 MAF AIContextProvider：
/// 首次调用时执行检索并返回上下文消息，后续迭代直接复用，避免每轮重复搜索。
/// </summary>
public sealed class RagContextProvider : AIContextProvider
{
    private readonly ChatContextInjector _injector;
    private readonly bool _webSearch;
    private readonly bool _knowledgeBase;
    private readonly bool _memory;
    private readonly string _content;
    private readonly SseStreamWriter _writer;
    private readonly Guid? _modelId;
    private readonly Guid? _topicId;
    private readonly Guid? _projectId;
    private readonly object _gate = new();
    private IReadOnlyList<ChatMessage>? _messages;
    private bool _loaded;

    public RagContextProvider(
        ChatContextInjector injector,
        bool webSearch,
        bool knowledgeBase,
        bool memory,
        string content,
        SseStreamWriter writer,
        Guid? modelId,
        Guid? topicId,
        Guid? projectId)
        : base(null, null, null)
    {
        _injector = injector;
        _webSearch = webSearch;
        _knowledgeBase = knowledgeBase;
        _memory = memory;
        _content = content;
        _writer = writer;
        _modelId = modelId;
        _topicId = topicId;
        _projectId = projectId;
    }

    public ChatContextInjector.RagResult Result { get; private set; } = new(null, null, null);

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

        if (!_webSearch && !_knowledgeBase && !_memory)
            return new AIContext { Messages = [] };

        var messages = new List<ChatMessage>
        {
            new(ChatRole.User, _content),
        };
        Result = await _injector.InjectRagAsync(
            _webSearch,
            _knowledgeBase,
            _memory,
            _content,
            messages,
            _writer,
            _modelId,
            _topicId,
            _projectId,
            cancellationToken);

        // 注入器把上下文插在占位用户消息之前，返回时去掉占位消息。
        _messages = messages.Take(Math.Max(0, messages.Count - 1)).ToList();
        return new AIContext { Messages = _messages };
    }
}