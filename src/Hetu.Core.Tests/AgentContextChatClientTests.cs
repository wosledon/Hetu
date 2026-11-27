using System.Runtime.CompilerServices;
using System.Text;
using Hetu.Agents;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using AiChatOptions = Microsoft.Extensions.AI.ChatOptions;

namespace Hetu.Core.Tests;

public class AgentContextChatClientTests
{
    [Fact]
    public async Task GetStreamingResponseAsync_模型返回函数调用_原样透传给工具循环()
    {
        var call = new FunctionCallContent("call-1", "test_tool", new Dictionary<string, object?>());
        var inner = new SingleUpdateChatClient(new ChatResponseUpdate(ChatRole.Assistant, [call]));
        var state = new AgentRunState(new AgentLoopRequest
        {
            Messages = [new ChatMessage(ChatRole.User, "hi")],
            CompressHistory = false,
            EnableTools = false,
        });
        var client = CreateClient(inner, state);

        var contents = new List<AIContent>();
        await foreach (var update in client.GetStreamingResponseAsync([new ChatMessage(ChatRole.User, "hi")]))
            contents.AddRange(update.Contents);

        var forwarded = Assert.Single(contents.OfType<FunctionCallContent>());
        Assert.Equal("call-1", forwarded.CallId);
        Assert.Equal("test_tool", forwarded.Name);
    }

    [Fact]
    public async Task GetStreamingResponseAsync_文本tool_call_转为FunctionCallContent()
    {
        const string text = "前<tool_call>{\"id\":\"text-1\",\"name\":\"work_read_file\",\"arguments\":{\"path\":\"a.ts\"}}</tool_call>后";
        var inner = new SingleUpdateChatClient(new ChatResponseUpdate(ChatRole.Assistant, text));
        var state = new AgentRunState(new AgentLoopRequest
        {
            Messages = [new ChatMessage(ChatRole.User, "hi")],
            CompressHistory = false,
            EnableTools = false,
        });
        var client = CreateClient(inner, state);

        var contents = new List<AIContent>();
        await foreach (var update in client.GetStreamingResponseAsync([new ChatMessage(ChatRole.User, "hi")]))
            contents.AddRange(update.Contents);

        var call = Assert.Single(contents.OfType<FunctionCallContent>());
        Assert.Equal("text-1", call.CallId);
        Assert.Equal("work_read_file", call.Name);
        Assert.Equal("前后", string.Concat(contents.OfType<TextContent>().Select(content => content.Text)));
    }

    [Fact]
    public async Task GetStreamingResponseAsync_Provider附加工具_保留在工具列表()
    {
        var inner = new CapturingChatClient();
        var state = new AgentRunState(new AgentLoopRequest
        {
            Messages = [new ChatMessage(ChatRole.User, "hi")],
            CompressHistory = false,
            EnableTools = true,
        });
        var registryTool = AIFunctionFactory.Create(() => "registry", "registry_tool");
        var providerTool = AIFunctionFactory.Create(() => "provider", "load_skill");
        state.CoreToolNames.Add("registry_tool");
        state.Functions["registry_tool"] = registryTool;
        var client = CreateClient(inner, state);

        await foreach (var _ in client.GetStreamingResponseAsync(
                           [new ChatMessage(ChatRole.User, "hi")],
                           new AiChatOptions { Tools = [registryTool, providerTool] }))
        {
        }

        Assert.NotNull(inner.LastOptions?.Tools);
        Assert.Contains(inner.LastOptions!.Tools!, tool => tool.Name == "registry_tool");
        Assert.Contains(inner.LastOptions!.Tools!, tool => tool.Name == "load_skill");
    }

    [Fact]
    public async Task GetStreamingResponseAsync_MAF移除工具_不再重新声明()
    {
        var inner = new CapturingChatClient();
        var state = new AgentRunState(new AgentLoopRequest
        {
            Messages = [new ChatMessage(ChatRole.User, "hi")],
            CompressHistory = false,
            EnableTools = true,
        });
        state.CoreToolNames.Add("test_tool");
        state.Functions["test_tool"] = AIFunctionFactory.Create(() => "ok", "test_tool");
        var client = CreateClient(inner, state);

        await foreach (var _ in client.GetStreamingResponseAsync(
                           [new ChatMessage(ChatRole.User, "hi")],
                           new AiChatOptions { Tools = null }))
        {
        }

        Assert.NotNull(inner.LastOptions);
        Assert.Null(inner.LastOptions!.Tools);
    }

    [Fact]
    public async Task GetStreamingResponseAsync_瞬时异常_重试后成功()
    {
        var inner = new SequencedChatClient(
            () => throw new HttpRequestException("transient"),
            () => new ChatResponseUpdate(ChatRole.Assistant, "ok"));
        var state = new AgentRunState(new AgentLoopRequest
        {
            Messages = [new ChatMessage(ChatRole.User, "hi")],
            CompressHistory = false,
            EnableTools = false,
            ProviderMaxRetries = 1,
            ProviderRetryDelayMs = 0,
        });
        var client = CreateClient(inner, state);

        var text = new StringBuilder();
        await foreach (var update in client.GetStreamingResponseAsync([new ChatMessage(ChatRole.User, "hi")]))
            foreach (var content in update.Contents.OfType<TextContent>())
                text.Append(content.Text);

        Assert.Equal("ok", text.ToString());
        Assert.Equal(2, inner.Calls);
    }

    [Fact]
    public async Task GetStreamingResponseAsync_空回合_重试一次()
    {
        var inner = new SequencedChatClient(
            () => new ChatResponseUpdate(ChatRole.Assistant, string.Empty),
            () => new ChatResponseUpdate(ChatRole.Assistant, "ok"));
        var state = new AgentRunState(new AgentLoopRequest
        {
            Messages = [new ChatMessage(ChatRole.User, "hi")],
            CompressHistory = false,
            EnableTools = false,
            ProviderMaxRetries = 1,
            ProviderRetryDelayMs = 0,
        });
        var client = CreateClient(inner, state);

        var text = new StringBuilder();
        await foreach (var update in client.GetStreamingResponseAsync([new ChatMessage(ChatRole.User, "hi")]))
            foreach (var content in update.Contents.OfType<TextContent>())
                text.Append(content.Text);

        Assert.Equal("ok", text.ToString());
        Assert.Equal(2, inner.Calls);
    }

    private static AgentContextChatClient CreateClient(IChatClient inner, AgentRunState state)
    {
        var localizer = Substitute.For<ILocalizer>();
        localizer.T(Arg.Any<string>()).Returns(call => call.Arg<string>());
        localizer.T(Arg.Any<string>(), Arg.Any<object[]>()).Returns(call => call.Arg<string>());
        var compression = new CompressionPipelineService(
            Substitute.For<IAppSettingService>(),
            NullLogger<CompressionPipelineService>.Instance,
            Substitute.For<ITextGenerationClient>(),
            Substitute.For<ILlmUsageRecorder>());
        return new AgentContextChatClient(
            inner,
            state,
            Substitute.For<ILlmUsageRecorder>(),
            compression,
            localizer,
            NullLogger<AgentContextChatClient>.Instance);
    }

    private sealed class SingleUpdateChatClient(ChatResponseUpdate update) : IChatClient
    {
        public Task<ChatResponse> GetResponseAsync(
            IEnumerable<ChatMessage> messages,
            AiChatOptions? options = null,
            CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
            IEnumerable<ChatMessage> messages,
            AiChatOptions? options = null,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.CompletedTask;
            yield return update;
        }

        public object? GetService(Type serviceType, object? serviceKey = null) => null;
        public void Dispose() { }
    }

    private sealed class SequencedChatClient(params Func<ChatResponseUpdate>[] turns) : IChatClient
    {
        private int _index;

        public int Calls => _index;

        public Task<ChatResponse> GetResponseAsync(
            IEnumerable<ChatMessage> messages,
            AiChatOptions? options = null,
            CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
            IEnumerable<ChatMessage> messages,
            AiChatOptions? options = null,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            var turn = turns[Math.Min(_index++, turns.Length - 1)];
            await Task.CompletedTask;
            yield return turn();
        }

        public object? GetService(Type serviceType, object? serviceKey = null) => null;
        public void Dispose() { }
    }

    private sealed class CapturingChatClient : IChatClient
    {
        public AiChatOptions? LastOptions { get; private set; }

        public Task<ChatResponse> GetResponseAsync(
            IEnumerable<ChatMessage> messages,
            AiChatOptions? options = null,
            CancellationToken cancellationToken = default)
        {
            LastOptions = options;
            return Task.FromResult(new ChatResponse(new ChatMessage(ChatRole.Assistant, "ok")));
        }

        public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
            IEnumerable<ChatMessage> messages,
            AiChatOptions? options = null,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            LastOptions = options;
            await Task.CompletedTask;
            yield return new ChatResponseUpdate(ChatRole.Assistant, "ok");
        }

        public object? GetService(Type serviceType, object? serviceKey = null) => null;
        public void Dispose() { }
    }
}