using System.Runtime.CompilerServices;
using System.Text.Json;
using Hetu.Agents;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Core.Services.Tools;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace Hetu.Core.Tests;

public class HetuAgentRunnerTests
{
    private static readonly JsonElement ToolSchema = JsonDocument.Parse("""{"type":"object"}""").RootElement;

    [Fact]
    public async Task RunAsync_审批通过_执行工具并返回正文()
    {
        var executions = 0;
        var executor = CreateExecutor("test_tool", ToolApprovalMode.Ask);
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                executions++;
                return ToolExecutionResult.Success("tool-ok");
            });

        var provider = new ScriptedProvider([
            [ToolCallsFrame("call-1", "test_tool", "{}"), FinishFrame("tool_calls")],
            [ContentFrame("完成"), FinishFrame("stop")],
        ]);
        await using var services = CreateServices(executor, provider);
        var runner = services.GetRequiredService<IAgentRunner>();
        var toolExecution = services.GetRequiredService<ToolExecutionService>();
        var sink = new CapturingSink();
        var request = new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            SessionId = "approval-ok",
            CompressHistory = false,
            MaxIterations = 2,
            ToolApprovals = { ["test_tool"] = ToolApprovalMode.Ask },
            Sink = sink,
        };

        var runTask = runner.RunAsync(request, CancellationToken.None);
        await WaitUntilAsync(() => toolExecution.TrySetApproval("approval-ok", "call-1", true));
        var result = await runTask;

        Assert.Null(result.Error);
        Assert.Equal(1, executions);
        Assert.Contains("完成", result.Content);
        Assert.Contains(result.ToolCalls, call => call.Name == "test_tool" && call.Result == "tool-ok");
    }

    [Fact]
    public async Task RunAsync_审批拒绝_不执行工具并补tool_result()
    {
        var executions = 0;
        var executor = CreateExecutor("test_tool", ToolApprovalMode.Ask);
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                executions++;
                return ToolExecutionResult.Success("should-not-run");
            });

        var provider = new ScriptedProvider([
            [ToolCallsFrame("call-1", "test_tool", "{}"), FinishFrame("tool_calls")],
            [ContentFrame("已取消"), FinishFrame("stop")],
        ]);
        await using var services = CreateServices(executor, provider);
        var runner = services.GetRequiredService<IAgentRunner>();
        var toolExecution = services.GetRequiredService<ToolExecutionService>();
        var sink = new CapturingSink();
        var request = new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            SessionId = "approval-deny",
            CompressHistory = false,
            MaxIterations = 2,
            ToolApprovals = { ["test_tool"] = ToolApprovalMode.Ask },
            Sink = sink,
        };

        var runTask = runner.RunAsync(request, CancellationToken.None);
        await WaitUntilAsync(() => toolExecution.TrySetApproval("approval-deny", "call-1", false));
        var result = await runTask;

        Assert.Null(result.Error);
        Assert.Equal(0, executions);
        Assert.Contains(result.ToolCalls, call => call.Name == "test_tool" && call.IsError);
        Assert.Contains(sink.Events, e => e.Contains("\"type\":\"tool_result\"", StringComparison.Ordinal));
    }

    [Fact]
    public async Task RunAsync_带历史消息_由MAF历史提供者加载完整上下文()
    {
        var provider = new ScriptedProvider([[ContentFrame("继续完成"), FinishFrame("stop")]]);
        await using var services = CreateServices(CreateExecutor("test_tool", ToolApprovalMode.Auto), provider);
        var runner = services.GetRequiredService<IAgentRunner>();
        var request = new AgentLoopRequest
        {
            Messages =
            [
                new ChatMessage(ChatRole.User, "第一轮问题"),
                new ChatMessage(ChatRole.Assistant, "第一轮回答"),
                new ChatMessage(ChatRole.User, "第二轮问题"),
            ],
            CompressHistory = false,
            SessionId = "history-provider",
            Sink = new CapturingSink(),
        };

        var result = await runner.RunAsync(request, CancellationToken.None);

        Assert.Null(result.Error);
        var received = Assert.Single(provider.ReceivedMessages);
        Assert.Equal(3, received.Count);
        Assert.Equal("第一轮问题", received[0].Content);
        Assert.Equal("第一轮回答", received[1].Content);
        Assert.Equal("第二轮问题", received[2].Content);
    }

    [Fact]
    public async Task RunAsync_运行中引导_由AIContextProvider注入()
    {
        var provider = new ScriptedProvider([[ContentFrame("已调整"), FinishFrame("stop")]]);
        await using var services = CreateServices(CreateExecutor("test_tool", ToolApprovalMode.Auto), provider);
        var runner = services.GetRequiredService<IAgentRunner>();
        var queue = new Queue<string>(["改成只读调研"]);
        var request = new AgentLoopRequest
        {
            Messages = [new ChatMessage(ChatRole.User, "继续")],
            CompressHistory = false,
            SessionId = "steering-provider",
            DrainSteering = () => queue.Count > 0 ? new List<string> { queue.Dequeue() } : [],
            Sink = new CapturingSink(),
        };

        var result = await runner.RunAsync(request, CancellationToken.None);

        Assert.Null(result.Error);
        var received = Assert.Single(provider.ReceivedMessages);
        Assert.Contains(received, message => message.Content.Contains("改成只读调研", StringComparison.Ordinal));
    }

    [Fact]
    public async Task RunAsync_上下文接近上限_由ChatReducer自动摘要旧消息()
    {
        var provider = new ScriptedProvider([[ContentFrame("继续"), FinishFrame("stop")]]);
        await using var services = CreateServices(CreateExecutor("test_tool", ToolApprovalMode.Auto), provider);
        var compactor = services.GetRequiredService<IContextCompactor>();
        compactor.SummarizeTurnAsync(Arg.Any<IReadOnlyList<LlmChatMessage>>(), Arg.Any<Guid?>(), Arg.Any<CancellationToken>())
            .Returns("历史摘要");
        var runner = services.GetRequiredService<IAgentRunner>();
        var messages = new List<ChatMessage>();
        for (var i = 0; i < 8; i++)
            messages.Add(new ChatMessage(i % 2 == 0 ? ChatRole.User : ChatRole.Assistant, $"消息 {i}"));
        messages.Add(new ChatMessage(ChatRole.User, "最后一问"));

        var result = await runner.RunAsync(new AgentLoopRequest
        {
            Messages = messages,
            CompressHistory = true,
            ContextWindowTokens = 1,
            SessionId = "auto-compact",
            Sink = new CapturingSink(),
        }, CancellationToken.None);

        Assert.Null(result.Error);
        var received = Assert.Single(provider.ReceivedMessages);
        Assert.Contains(received, message => message.Content.Contains("历史摘要", StringComparison.Ordinal));
    }

    [Fact]
    public async Task RunAsync_工作流工具需要审批但无通道_返回明确错误()
    {
        var executor = CreateExecutor("ask_tool", ToolApprovalMode.Ask);
        await using var services = CreateServices(executor, new ScriptedProvider([]));
        var toolExecution = services.GetRequiredService<ToolExecutionService>();

        var results = await toolExecution.ExecuteToolCallsAsync(
            "workflow-test",
            [new LlmToolCall { Id = "call-1", Name = "ask_tool", Arguments = "{}" }],
            new Dictionary<string, ToolApprovalMode>(),
            [],
            _ => Task.CompletedTask,
            _ => Task.CompletedTask,
            CancellationToken.None,
            interactiveApprovalSupported: false);

        Assert.True(results[0].isError);
        Assert.Equal("toolExec.approvalUnavailable", results[0].content);
    }

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (!condition())
        {
            if (DateTime.UtcNow > deadline) throw new TimeoutException("等待审批注册超时");
            await Task.Delay(10);
        }
    }

    private static IToolExecutor CreateExecutor(string name, ToolApprovalMode approval)
    {
        var executor = Substitute.For<IToolExecutor>();
        executor.Name.Returns(name);
        executor.Description.Returns("test tool");
        executor.ParametersSchema.Returns(ToolSchema);
        executor.DefaultApproval.Returns(approval);
        executor.Risk.Returns(ToolRisk.Read);
        return executor;
    }

    private static ServiceProvider CreateServices(IToolExecutor executor, IScriptedModel provider)
    {
        var localizer = Substitute.For<ILocalizer>();
        localizer.T(Arg.Any<string>(), Arg.Any<object[]>()).Returns(call => call.Arg<string>());
        localizer.T(Arg.Any<string>()).Returns(call => call.Arg<string>());

        var registry = new ToolRegistry([executor], localizer);
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddScoped(_ => new WorkToolContext());
        services.AddScoped(_ => registry);
        services.AddSingleton(localizer);
        services.AddSingleton(Substitute.For<IUnitOfWork>());
        services.AddSingleton(Substitute.For<IAppSettingService>());
        services.AddSingleton(Substitute.For<ILogger<ToolExecutionService>>());
        services.AddSingleton(Substitute.For<ILogger<CompressionPipelineService>>());
        services.AddSingleton<ILogger<HetuAgentRunner>>(NullLogger<HetuAgentRunner>.Instance);
        services.AddSingleton(Substitute.For<ILlmUsageRecorder>());
        services.AddSingleton(Substitute.For<ITextGenerationClient>());
        services.AddSingleton(Substitute.For<IContextCompactor>());
        services.AddSingleton(new McpClientProvider(NullLoggerFactory.Instance));
        services.AddSingleton<ToolExecutionService>();
        services.AddSingleton<CompressionPipelineService>();
        services.AddSingleton<IAgentFactory>(new ScriptedAgentFactory(provider));
        services.AddScoped<HetuAgentRunner>();
        services.AddScoped<IAgentRunner>(sp => sp.GetRequiredService<HetuAgentRunner>());
        return services.BuildServiceProvider();
    }

    private static string ToolCallsFrame(string id, string name, string arguments) => JsonSerializer.Serialize(new
    {
        type = "tool_calls",
        toolCalls = new[] { new { id, name, arguments } },
    });

    private static string FinishFrame(string reason) => JsonSerializer.Serialize(new { type = "finish", reason });
    private static string ContentFrame(string text) => JsonSerializer.Serialize(new { type = "content", text });

    private sealed class CapturingSink : IAgentLoopSink
    {
        public List<string> Events { get; } = [];
        public Task OnEventAsync(object payload)
        {
            Events.Add(JsonSerializer.Serialize(payload));
            return Task.CompletedTask;
        }
    }

    private sealed class ScriptedProvider(IEnumerable<string[]> turns) : IScriptedModel
    {
        private readonly Queue<string[]> _turns = new(turns);

        public List<IReadOnlyList<LlmChatMessage>> ReceivedMessages { get; } = [];

        public string ProviderType => "test";

        public async IAsyncEnumerable<string> ChatStreamAsync(
            IReadOnlyList<LlmChatMessage> messages,
            Hetu.Core.Interfaces.ChatOptions options,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            ReceivedMessages.Add(messages);
            var frames = _turns.Count > 0 ? _turns.Dequeue() : [FinishFrame("stop")];
            await Task.Yield();
            foreach (var frame in frames) yield return frame;
        }
    }
}