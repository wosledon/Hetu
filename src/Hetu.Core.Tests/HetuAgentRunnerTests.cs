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
    public async Task RunAsync_自定义历史提供者_只传当前输入()
    {
        var provider = new ScriptedProvider([[ContentFrame("新回答")]]);
        await using var services = CreateServices(CreateExecutor("test_tool", ToolApprovalMode.Auto), provider);
        var runner = services.GetRequiredService<IAgentRunner>();
        var history = new PreloadedChatHistoryProvider(
        [
            new ChatMessage(ChatRole.User, "历史问题"),
            new ChatMessage(ChatRole.Assistant, "历史回答"),
        ]);

        var result = await runner.RunAsync(new AgentLoopRequest
        {
            Messages = [new ChatMessage(ChatRole.User, "新问题")],
            ChatHistoryProvider = history,
            SessionId = "custom-history",
            CompressHistory = false,
        }, CancellationToken.None);

        Assert.Null(result.Error);
        var received = Assert.Single(provider.ReceivedMessages);
        Assert.Contains(received, message => message.Content.Contains("历史问题", StringComparison.Ordinal));
        Assert.Contains(received, message => message.Content.Contains("历史回答", StringComparison.Ordinal));
        Assert.Contains(received, message => message.Content.Contains("新问题", StringComparison.Ordinal));
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
            CancellationToken.None,
            interactiveInputSupported: false);

        Assert.True(results[0].isError);
        Assert.Equal("toolExec.approvalUnavailable", results[0].content);
    }

    [Fact]
    public async Task RunAsync_无交互通道_Ask直接返回错误不等待()
    {
        var executor = CreateExecutor("write_tool", ToolApprovalMode.Ask);
        var provider = new ScriptedProvider([
            [ToolCallsFrame("call-1", "write_tool", """{"path":"a.txt"}""")],
            [ContentFrame("收尾")],
        ]);
        await using var services = CreateServices(executor, provider);
        var runner = services.GetRequiredService<IAgentRunner>();

        var result = await runner.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["write_tool"],
            SessionId = "no-interaction",
            CompressHistory = false,
            InteractiveToolsSupported = false,
            MaxIterations = 3,
            MaxContinuations = 0,
            Sink = new CapturingSink(),
        }, CancellationToken.None);

        Assert.Null(result.Error);
        Assert.Contains("收尾", result.Content);
        Assert.Contains(result.ToolCalls, call =>
            call.Name == "write_tool"
            && call.IsError
            && call.Result == "toolExec.approvalUnavailable");
    }

    [Fact]
    public async Task RunAsync_重复只读调用_复用结果不重复执行()
    {
        var executions = 0;
        var executor = CreateExecutor("read_tool", ToolApprovalMode.Auto);
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                executions++;
                return ToolExecutionResult.Success("file-content");
            });

        var provider = new ScriptedProvider([
            [ToolCallsFrame("call-1", "read_tool", """{"path":"a.txt"}""")],
            [ToolCallsFrame("call-2", "read_tool", """{"path":"a.txt"}""")],
            [ContentFrame("完成")],
        ]);
        await using var services = CreateServices(executor, provider);
        var runner = services.GetRequiredService<IAgentRunner>();
        var sink = new CapturingSink();

        var result = await runner.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["read_tool"],
            SessionId = "reuse-read",
            CompressHistory = false,
            MaxIterations = 4,
            MaxContinuations = 0,
            Sink = sink,
        }, CancellationToken.None);

        Assert.Null(result.Error);
        Assert.Equal(1, executions);
        Assert.Contains("完成", result.Content);
        Assert.Contains(sink.Events, e => e.Contains("toolExec.reusedResult", StringComparison.Ordinal));
    }

    [Fact]
    public async Task RunAsync_同一调用连续失败两次_第三次被拦下()
    {
        var executions = 0;
        var executor = CreateExecutor("write_tool", ToolApprovalMode.Auto);
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                executions++;
                return ToolExecutionResult.Error("boom");
            });

        var provider = new ScriptedProvider([
            [ToolCallsFrame("call-1", "write_tool", """{"path":"a.txt"}""")],
            [ToolCallsFrame("call-2", "write_tool", """{"path":"a.txt"}""")],
            [ToolCallsFrame("call-3", "write_tool", """{"path":"a.txt"}""")],
            [ContentFrame("已停止")],
        ]);
        await using var services = CreateServices(executor, provider);
        var runner = services.GetRequiredService<IAgentRunner>();
        var sink = new CapturingSink();

        var result = await runner.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["write_tool"],
            SessionId = "repeat-failure",
            CompressHistory = false,
            MaxIterations = 5,
            MaxContinuations = 0,
            Sink = sink,
        }, CancellationToken.None);

        Assert.Null(result.Error);
        Assert.Equal(2, executions);
        Assert.Contains("已停止", result.Content);
        Assert.Contains(sink.Events, e => e.Contains("toolExec.repeatedFailure", StringComparison.Ordinal));
    }

    [Fact]
    public async Task RunAsync_连续重复只读调用_停滞检测后收尾()
    {
        var executor = CreateExecutor("read_tool", ToolApprovalMode.Auto);
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ => ToolExecutionResult.Success("file-content"));
        var provider = new ScriptedProvider([
            [ToolCallsFrame("call-1", "read_tool", """{"path":"a.txt"}""")],
            [ToolCallsFrame("call-2", "read_tool", """{"path":"a.txt"}""")],
            [ToolCallsFrame("call-3", "read_tool", """{"path":"a.txt"}""")],
            [ContentFrame("收尾")],
        ]);
        await using var services = CreateServices(executor, provider);
        var runner = services.GetRequiredService<IAgentRunner>();
        var sink = new CapturingSink();

        var result = await runner.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["read_tool"],
            SessionId = "stalled",
            CompressHistory = false,
            MaxIterations = 5,
            MaxContinuations = 0,
            Sink = sink,
        }, CancellationToken.None);

        Assert.Null(result.Error);
        Assert.True(result.Stalled);
        Assert.Contains("收尾", result.Content);
        Assert.Contains(sink.Events, e => e.Contains("agent_stalled", StringComparison.Ordinal));
    }

    [Fact]
    public async Task RunAsync_达到单段迭代上限且有进展_自动续跑()
    {
        var executions = 0;
        var executor = CreateExecutor("write_tool", ToolApprovalMode.Auto);
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                executions++;
                return ToolExecutionResult.Success("ok");
            });
        var provider = new ScriptedProvider([
            [ToolCallsFrame("call-1", "write_tool", """{"path":"a.txt"}""")],
            [ContentFrame("第一段")],
            [ContentFrame("第二段")],
        ]);
        await using var services = CreateServices(executor, provider);
        var runner = services.GetRequiredService<IAgentRunner>();
        var sink = new CapturingSink();

        var result = await runner.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["write_tool"],
            SessionId = "continuation",
            CompressHistory = false,
            MaxIterations = 1,
            MaxContinuations = 1,
            Sink = sink,
        }, CancellationToken.None);

        Assert.Null(result.Error);
        Assert.Equal(1, executions);
        Assert.Equal(1, result.ContinuationCount);
        Assert.Contains("第一段", result.Content);
        Assert.Contains("第二段", result.Content);
        Assert.Contains(sink.Events, e => e.Contains("iteration_continue", StringComparison.Ordinal));
    }

    [Fact]
    public async Task RunAsync_单轮请求超过锚点_压缩长文本并通知()
    {
        var executor = CreateExecutor("write_tool", ToolApprovalMode.Auto);
        var provider = new ScriptedProvider([[ContentFrame("完成")]]);
        await using var services = CreateServices(executor, provider);
        var runner = services.GetRequiredService<IAgentRunner>();
        var sink = new CapturingSink();
        var repeatedLog = string.Join('\n', Enumerable.Repeat(
            "2026-01-01 ERROR repeated log line with some payload 123", 200));

        var result = await runner.RunAsync(new AgentLoopRequest
        {
            Messages = [new ChatMessage(ChatRole.User, repeatedLog)],
            SessionId = "context-anchor",
            CompressHistory = false,
            ContextWindowTokens = 5000,
            MaxIterations = 1,
            MaxContinuations = 0,
            Sink = sink,
        }, CancellationToken.None);

        Assert.Null(result.Error);
        Assert.False(result.ContextFull);
        Assert.Contains("完成", result.Content);
        Assert.Contains(sink.Events, e => e.Contains("context_anchor", StringComparison.Ordinal));
    }

    [Fact]
    public async Task RunAsync_上下文超过硬上限_停止工具调用并收尾()
    {
        var executor = CreateExecutor("write_tool", ToolApprovalMode.Auto);
        var provider = new ScriptedProvider([[ContentFrame("收尾")]]);
        await using var services = CreateServices(executor, provider);
        var runner = services.GetRequiredService<IAgentRunner>();
        var sink = new CapturingSink();

        var result = await runner.RunAsync(new AgentLoopRequest
        {
            Messages = [new ChatMessage(ChatRole.User, new string('x', 40))],
            SessionId = "context-full",
            CompressHistory = false,
            ContextWindowTokens = 1,
            MaxIterations = 1,
            MaxContinuations = 0,
            Sink = sink,
        }, CancellationToken.None);

        Assert.Null(result.Error);
        Assert.True(result.ContextFull);
        Assert.Contains("收尾", result.Content);
        Assert.Contains(sink.Events, e => e.Contains("context_full", StringComparison.Ordinal));
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

    private static string ToolCallsFrame(string id, string name, string arguments)
        => $"<tool_call>{JsonSerializer.Serialize(new { id, name, arguments = JsonDocument.Parse(arguments).RootElement })}</tool_call>";

    private static string FinishFrame(string reason) => string.Empty;
    private static string ContentFrame(string text) => text;

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