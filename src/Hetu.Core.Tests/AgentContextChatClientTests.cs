using System.Runtime.CompilerServices;
using Hetu.Agents;
using Hetu.Core.Services;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

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
            Messages = [new() { Role = "user", Content = "hi" }],
            CompressHistory = false,
            EnableTools = false,
        });
        var client = new AgentContextChatClient(
            inner,
            state,
            Substitute.For<ILlmUsageRecorder>(),
            NullLogger<AgentContextChatClient>.Instance);

        var contents = new List<AIContent>();
        await foreach (var update in client.GetStreamingResponseAsync([new ChatMessage(ChatRole.User, "hi")]))
            contents.AddRange(update.Contents);

        var forwarded = Assert.Single(contents.OfType<FunctionCallContent>());
        Assert.Equal("call-1", forwarded.CallId);
        Assert.Equal("test_tool", forwarded.Name);
    }

    private sealed class SingleUpdateChatClient(ChatResponseUpdate update) : IChatClient
    {
        public Task<ChatResponse> GetResponseAsync(
            IEnumerable<ChatMessage> messages,
            ChatOptions? options = null,
            CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
            IEnumerable<ChatMessage> messages,
            ChatOptions? options = null,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.CompletedTask;
            yield return update;
        }

        public object? GetService(Type serviceType, object? serviceKey = null) => null;
        public void Dispose() { }
    }
}