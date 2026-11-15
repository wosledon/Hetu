using System.Runtime.CompilerServices;
using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Core.Services.Tools;
using Hetu.Shared.Common;
using Hetu.Shared.Settings;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NSubstitute;

namespace Hetu.Core.Tests;

public class AgentExecutionSafetyTests
{
    private static readonly JsonElement ToolSchema = JsonDocument.Parse("""{"type":"object"}""").RootElement;

    [Fact]
    public async Task RunAsync_工具调用解析后取消_不执行工具()
    {
        using var cts = new CancellationTokenSource();
        var executor = CreateExecutor("test_tool");
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        var provider = Substitute.For<ILLMProvider>();
        provider.ChatStreamAsync(Arg.Any<IReadOnlyList<LlmChatMessage>>(), Arg.Any<ChatOptions>(), Arg.Any<CancellationToken>())
            .Returns(call => ToolCallThenCancel(cts, call.Arg<CancellationToken>()));
        using var services = CreateToolServices(registry);
        var service = CreateAgentLoop(provider, registry, services, localizer);

        var result = await service.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            MaxIterations = 1,
            CompressHistory = false,
        }, cts.Token);

        Assert.True(result.Cancelled);
        Assert.Empty(result.ToolCalls);
    }

    [Fact]
    public async Task ExecuteToolCallsAsync_执行器取消_传播取消且不继续后续工具()
    {
        using var cts = new CancellationTokenSource();
        var executor = CreateExecutor("test_tool");
        var executions = 0;
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns<Task<ToolExecutionResult>>(_ =>
            {
                executions++;
                cts.Cancel();
                throw new OperationCanceledException(cts.Token);
            });
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var service = CreateToolExecution(services, localizer);
        var calls = new List<LlmToolCall>
        {
            new() { Id = "call-1", Name = "test_tool" },
            new() { Id = "call-2", Name = "test_tool" },
        };

        await Assert.ThrowsAsync<OperationCanceledException>(() => service.ExecuteToolCallsAsync(
            "session",
            calls,
            [],
            [],
            _ => Task.CompletedTask,
            _ => Task.CompletedTask,
            cts.Token));

        Assert.Equal(1, executions);
    }

    [Theory]
    [InlineData("plan")]
    [InlineData("ask_question")]
    public async Task ExecuteToolCallsAsync_交互事件发布时_等待状态已可提交(string toolName)
    {
        using var cts = new CancellationTokenSource();
        var executor = CreateExecutor(toolName);
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var service = CreateToolExecution(services, localizer);
        var accepted = false;

        async Task WriteJsonAsync(object payload)
        {
            var type = payload.GetType().GetProperty("type")?.GetValue(payload)?.ToString();
            if (type == "plan")
                accepted = service.TrySetPlanDecision("session", "call-1", true, "");
            else if (type == "question")
                accepted = service.TrySetAnswer("session", "call-1", "answer");
            if ((type is "plan" or "question") && !accepted) cts.Cancel();
            await Task.CompletedTask;
        }

        var results = await service.ExecuteToolCallsAsync(
            "session",
            [new LlmToolCall { Id = "call-1", Name = toolName }],
            [],
            [],
            _ => Task.CompletedTask,
            WriteJsonAsync,
            cts.Token);

        Assert.True(accepted);
        Assert.Single(results);
    }

    [Fact]
    public async Task RunAsync_多个工具调用事件_全部累加执行()
    {
        var executor = CreateExecutor("test_tool");
        var executions = 0;
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                executions++;
                return ToolExecutionResult.Success("ok");
            });
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var provider = Substitute.For<ILLMProvider>();
        var invocation = 0;
        ChatOptions? receivedOptions = null;
        provider.ChatStreamAsync(Arg.Any<IReadOnlyList<LlmChatMessage>>(), Arg.Any<ChatOptions>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                receivedOptions = call.Arg<ChatOptions>();
                return invocation++ == 0
                    ? Frames(
                        ToolCallsFrame("call-1", "{}"),
                        ToolCallsFrame("call-2", "{}"),
                        FinishFrame("stop"))
                    : Frames(ContentFrame("done"), FinishFrame("stop"));
            });
        var service = CreateAgentLoop(provider, registry, services, localizer);

        var result = await service.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            MaxIterations = 2,
            ReasoningEffort = "high",
            ReasoningBudgetTokens = 1024,
            MaxTokens = 2048,
            Temperature = 0.2,
            CompressHistory = false,
        }, CancellationToken.None);

        Assert.Equal(2, executions);
        Assert.Equal(2, result.ToolCalls.Count);
        Assert.Equal("done", result.Content);
        Assert.Equal("high", receivedOptions?.ReasoningEffort);
        Assert.Equal(1024, receivedOptions?.ReasoningBudgetTokens);
        Assert.Equal(2048, receivedOptions?.MaxTokens);
        Assert.Equal(0.2, receivedOptions?.Temperature);
    }

    [Theory]
    [InlineData("length", "{}")]
    [InlineData("stop", "{")]
    public async Task RunAsync_截断或畸形调用_不执行工具(string finishReason, string arguments)
    {
        var executor = CreateExecutor("test_tool");
        var executions = 0;
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                executions++;
                return ToolExecutionResult.Success("unexpected");
            });
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var provider = Substitute.For<ILLMProvider>();
        provider.ChatStreamAsync(Arg.Any<IReadOnlyList<LlmChatMessage>>(), Arg.Any<ChatOptions>(), Arg.Any<CancellationToken>())
            .Returns(_ => Frames(ToolCallsFrame("call-1", arguments), FinishFrame(finishReason)));
        var service = CreateAgentLoop(provider, registry, services, localizer);

        var result = await service.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            MaxIterations = 1,
            CompressHistory = false,
        }, CancellationToken.None);

        Assert.False(string.IsNullOrWhiteSpace(result.Error));
        Assert.Equal(0, executions);
    }

    [Fact]
    public async Task RunAsync_工具调用超过单轮上限_执行前N个并为其余补错误结果()
    {
        var executor = CreateExecutor("test_tool");
        var executions = 0;
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                executions++;
                return ToolExecutionResult.Success("ok");
            });
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var provider = Substitute.For<ILLMProvider>();
        var invocation = 0;
        List<LlmChatMessage>? secondTurnMessages = null;
        provider.ChatStreamAsync(Arg.Any<IReadOnlyList<LlmChatMessage>>(), Arg.Any<ChatOptions>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                if (invocation++ == 0)
                    return Frames(
                        JsonSerializer.Serialize(new
                        {
                            type = "tool_calls",
                            toolCalls = new[]
                            {
                                new { id = "call-1", name = "test_tool", arguments = "{}" },
                                new { id = "call-2", name = "test_tool", arguments = "{}" },
                            },
                        }),
                        FinishFrame("stop"));
                secondTurnMessages = call.Arg<IReadOnlyList<LlmChatMessage>>().ToList();
                return Frames(ContentFrame("done"), FinishFrame("stop"));
            });
        var service = CreateAgentLoop(provider, registry, services, localizer);

        var result = await service.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            MaxIterations = 2,
            MaxToolCallsPerTurn = 1,
            CompressHistory = false,
        }, CancellationToken.None);

        Assert.Equal(1, executions);
        Assert.Null(result.Error);
        Assert.Equal("done", result.Content);
        // 跳过的调用也必须有一条错误结果，否则 assistant.tool_calls 与 tool 结果不配对
        Assert.Contains(secondTurnMessages ?? [], m => m.Role == "tool" && m.ToolCallId == "call-2");
        var assistant = Assert.Single(secondTurnMessages ?? [], m => m.Role == "assistant" && m.ToolCalls != null);
        Assert.Equal(2, assistant.ToolCalls!.Count);
    }

    [Fact]
    public async Task RunAsync_达到迭代上限_禁用工具生成收尾()
    {
        var executor = CreateExecutor("test_tool");
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(ToolExecutionResult.Success("ok"));
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var provider = Substitute.For<ILLMProvider>();
        var invocation = 0;
        ChatOptions? finalOptions = null;
        provider.ChatStreamAsync(Arg.Any<IReadOnlyList<LlmChatMessage>>(), Arg.Any<ChatOptions>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                if (invocation++ == 0) return Frames(ToolCallsFrame("call-1", "{}"), FinishFrame("stop"));
                finalOptions = call.Arg<ChatOptions>();
                return Frames(ContentFrame("summary"), FinishFrame("stop"));
            });
        var service = CreateAgentLoop(provider, registry, services, localizer);

        var result = await service.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            MaxIterations = 1,
            MaxContinuations = 0,
            CompressHistory = false,
        }, CancellationToken.None);

        Assert.True(result.IterationLimitReached);
        Assert.Equal("summary", result.Content);
        Assert.Equal("none", finalOptions?.ToolChoice);
        Assert.Null(finalOptions?.Tools);
    }

    /// <summary>互不相同的散文行：压缩管道应原样保留（非日志行、无重复、无结构化载荷）</summary>
    private static string UniqueProse(int lines = 60)
        => string.Join("\n", Enumerable.Range(0, lines).Select(i => $"line {i} unique prose content padding padding padding"));

    [Fact]
    public async Task RunAsync_段内请求_消息纯追加不改写已发送前缀()
    {
        var payload = UniqueProse(100);
        var executor = CreateExecutor("test_tool");
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ => ToolExecutionResult.Success(payload));
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var provider = Substitute.For<ILLMProvider>();
        var invocation = 0;
        var snapshots = new List<List<string>>();
        provider.ChatStreamAsync(Arg.Any<IReadOnlyList<LlmChatMessage>>(), Arg.Any<ChatOptions>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                snapshots.Add(call.Arg<IReadOnlyList<LlmChatMessage>>().Select(m => m.Content ?? "").ToList());
                var current = invocation++;
                return current < 4
                    ? Frames(ToolCallsFrame($"call-{current + 1}", "{}"), FinishFrame("stop"))
                    : Frames(ContentFrame("done"), FinishFrame("stop"));
            });
        var service = CreateAgentLoop(provider, registry, services, localizer);

        await service.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            MaxIterations = 6,
            CompressHistory = false,
        }, CancellationToken.None);

        Assert.Equal(5, snapshots.Count);
        for (var i = 1; i < snapshots.Count; i++)
        {
            var prev = snapshots[i - 1];
            var cur = snapshots[i];
            Assert.True(cur.Count >= prev.Count);
            // 不变量：已发送的消息内容逐条保持不变，只允许尾部追加
            for (var k = 0; k < prev.Count; k++) Assert.Equal(prev[k], cur[k]);
        }
        // 工具结果保持完整（单条上限内），模型不会因「忘了」而重读
        Assert.All(snapshots[^1].Where(c => c.Length == payload.Length), c => Assert.DoesNotMatch("^\\[tool-output-compacted", c));
        Assert.Contains(snapshots[^1], c => c == payload);
    }

    [Fact]
    public async Task RunAsync_上下文触顶_收尾本轮且不改写前缀()
    {
        var payload = UniqueProse();
        var executor = CreateExecutor("test_tool");
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ => ToolExecutionResult.Success(payload));
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var provider = Substitute.For<ILLMProvider>();
        var invocation = 0;
        var snapshots = new List<List<string>>();
        provider.ChatStreamAsync(Arg.Any<IReadOnlyList<LlmChatMessage>>(), Arg.Any<ChatOptions>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                snapshots.Add(call.Arg<IReadOnlyList<LlmChatMessage>>().Select(m => m.Content ?? "").ToList());
                var current = invocation++;
                return current < 2
                    ? Frames(ToolCallsFrame($"call-{current + 1}", "{}"), FinishFrame("stop"))
                    : Frames(ContentFrame("done"), FinishFrame("stop"));
            });
        var service = CreateAgentLoop(provider, registry, services, localizer);

        var result = await service.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            MaxIterations = 10,
            // 硬上限 = 2000 * 3 * 80% = 4800 字符：两条 3000 字符结果后即触顶
            ContextWindowTokens = 2000,
            CompressHistory = false,
        }, CancellationToken.None);

        // 触顶后不再继续迭代，直接收尾（第 3 次请求是无工具收尾）
        Assert.Equal(3, invocation);
        Assert.Equal("done", result.Content);
        Assert.False(result.IterationLimitReached);
        // 收尾请求里早期工具结果仍是原文：触顶靠收尾解决，而不是改写前缀
        Assert.Contains(snapshots[^1], c => c.Length == payload.Length);
        Assert.All(snapshots[^1], c => Assert.DoesNotMatch("^\\[tool-output-compacted", c));
    }

    [Fact]
    public async Task RunAsync_续跑锚点_当前轮压成交接摘要后继续()
    {
        var payload = UniqueProse();
        var executor = CreateExecutor("test_tool");
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ => ToolExecutionResult.Success(payload));
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var provider = Substitute.For<ILLMProvider>();
        var invocation = 0;
        var snapshots = new List<List<string>>();
        provider.ChatStreamAsync(Arg.Any<IReadOnlyList<LlmChatMessage>>(), Arg.Any<ChatOptions>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                snapshots.Add(call.Arg<IReadOnlyList<LlmChatMessage>>().Select(m => m.Content ?? "").ToList());
                var current = invocation++;
                return current < 2
                    ? Frames(ToolCallsFrame($"call-{current + 1}", "{}"), FinishFrame("stop"))
                    : Frames(ContentFrame("done"), FinishFrame("stop"));
            });
        var service = CreateAgentLoop(provider, registry, services, localizer);

        await service.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            MaxIterations = 2,
            MaxContinuations = 1,
            // 锚点阈值 = 4000 * 3 * 40% = 4800 字符：段末两条散文结果超过它
            ContextWindowTokens = 4000,
            CompressHistory = false,
            Messages = [new LlmChatMessage { Role = "user", Content = "task" }],
        }, CancellationToken.None);

        Assert.Equal(3, invocation);
        var afterAnchor = snapshots[2];
        // 段边界一次改写：当前轮原文被交接摘要替换；本轮任务消息在边界之前仍保留
        Assert.Contains(afterAnchor, c => c.Contains("【进展交接】", StringComparison.Ordinal));
        Assert.Contains(afterAnchor, c => c == "task");
        Assert.DoesNotContain(afterAnchor, c => c.Length == payload.Length);
    }

    [Fact]
    public async Task RunAsync_用户粘贴重复日志_进上下文前已被压缩()
    {
        var executor = CreateExecutor("test_tool");
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var provider = Substitute.For<ILLMProvider>();
        List<string>? firstRequest = null;
        provider.ChatStreamAsync(Arg.Any<IReadOnlyList<LlmChatMessage>>(), Arg.Any<ChatOptions>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                firstRequest ??= call.Arg<IReadOnlyList<LlmChatMessage>>().Select(m => m.Content ?? "").ToList();
                return Frames(ContentFrame("done"), FinishFrame("stop"));
            });
        var service = CreateAgentLoop(provider, registry, services, localizer, appSettings: EnabledCompressionSettings());
        var paste = string.Join("\n", Enumerable.Range(0, 200).Select(i =>
            $"2026-11-15 10:00:{i % 60:00} INFO  heartbeat seq={i}"));

        await service.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            Messages = [new LlmChatMessage { Role = "user", Content = paste }],
        }, CancellationToken.None);

        Assert.NotNull(firstRequest);
        Assert.Contains(firstRequest!, c => c.Contains("← 重复 200 次", StringComparison.Ordinal));
        Assert.All(firstRequest!, c => Assert.True(c.Length < paste.Length));
    }

    [Fact]
    public async Task RunAsync_工具重复日志_进上下文前已被压缩()
    {
        var logs = string.Join("\n", Enumerable.Range(0, 200).Select(i =>
            $"2026-11-15 10:00:{i % 60:00} INFO  heartbeat seq={i}"));
        var executor = CreateExecutor("test_tool");
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ => ToolExecutionResult.Success(logs));
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var provider = Substitute.For<ILLMProvider>();
        var invocation = 0;
        List<string>? secondRequest = null;
        provider.ChatStreamAsync(Arg.Any<IReadOnlyList<LlmChatMessage>>(), Arg.Any<ChatOptions>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                var current = invocation++;
                if (current == 1) secondRequest = call.Arg<IReadOnlyList<LlmChatMessage>>().Select(m => m.Content ?? "").ToList();
                return current == 0
                    ? Frames(ToolCallsFrame("call-1", "{}"), FinishFrame("stop"))
                    : Frames(ContentFrame("done"), FinishFrame("stop"));
            });
        var service = CreateAgentLoop(provider, registry, services, localizer, appSettings: EnabledCompressionSettings());

        await service.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            MaxIterations = 4,
            Messages = [new LlmChatMessage { Role = "user", Content = "run it" }],
        }, CancellationToken.None);

        Assert.NotNull(secondRequest);
        Assert.Contains(secondRequest!, c => c.Contains("← 重复 200 次", StringComparison.Ordinal));
        Assert.DoesNotContain(secondRequest!, c => c == logs);
    }

    [Fact]
    public async Task RunAsync_相同历史两次运行_首次请求逐字一致()
    {
        var history = string.Join("\n", Enumerable.Range(0, 120).Select(i =>
            $"2026-11-15 09:00:{i % 60:00} INFO  build step={i} ok"));
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([CreateExecutor("test_tool")], localizer);
        using var services = CreateToolServices(registry);
        var snapshots = new List<List<string>>();
        var provider = Substitute.For<ILLMProvider>();
        provider.ChatStreamAsync(Arg.Any<IReadOnlyList<LlmChatMessage>>(), Arg.Any<ChatOptions>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                snapshots.Add(call.Arg<IReadOnlyList<LlmChatMessage>>().Select(m => m.Content ?? "").ToList());
                return Frames(ContentFrame("done"), FinishFrame("stop"));
            });
        var service = CreateAgentLoop(provider, registry, services, localizer, appSettings: EnabledCompressionSettings());
        var request = new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            Messages =
            [
                new LlmChatMessage { Role = "user", Content = history },
                new LlmChatMessage { Role = "assistant", Content = "previous answer" },
                new LlmChatMessage { Role = "user", Content = "next question" },
            ],
        };

        await service.RunAsync(request, CancellationToken.None);
        await service.RunAsync(request, CancellationToken.None);

        Assert.Equal(2, snapshots.Count);
        Assert.Equal(snapshots[0], snapshots[1]);
    }

    private static IAppSettingService EnabledCompressionSettings()
    {
        var settings = Substitute.For<IAppSettingService>();
        settings.GetAsync("CompressionConfig", Arg.Any<CancellationToken>())
            .Returns(ApiResponse<AppSettingDto?>.Ok(new AppSettingDto
            {
                Key = "CompressionConfig",
                Value = JsonSerializer.Serialize(new CompressionPipelineDto { Enabled = true, Mode = "algorithmic" }),
            }));
        return settings;
    }

    [Fact]
    public async Task RunAsync_连续重复只读调用_提前收尾不烧完迭代()
    {
        var executions = 0;
        var executor = CreateExecutor("test_tool");
        executor.Risk.Returns(ToolRisk.Read);
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                executions++;
                return ToolExecutionResult.Success("same-result");
            });
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var provider = Substitute.For<ILLMProvider>();
        var invocation = 0;
        provider.ChatStreamAsync(Arg.Any<IReadOnlyList<LlmChatMessage>>(), Arg.Any<ChatOptions>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                invocation++;
                // 名字与参数完全相同：首轮执行并缓存，之后每轮都命中复用而被跳过
                return invocation <= 3
                    ? Frames(ToolCallsFrame($"call-{invocation}", "{}"), FinishFrame("stop"))
                    : Frames(ContentFrame("done"), FinishFrame("stop"));
            });
        var service = CreateAgentLoop(provider, registry, services, localizer);

        var result = await service.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            MaxIterations = 10,
            CompressHistory = false,
        }, CancellationToken.None);

        // 第 1 轮执行，第 2、3 轮全部被跳过 → 判定打转并收尾，收尾请求是第 4 次
        Assert.Equal(4, invocation);
        Assert.Equal(1, executions);
        Assert.Equal("done", result.Content);
    }

    [Fact]
    public async Task RunAsync_逐次用量_仅每轮首次请求带压缩前后规模()
    {
        var executor = CreateExecutor("test_tool");
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ => ToolExecutionResult.Success("ok"));
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var provider = Substitute.For<ILLMProvider>();
        var invocation = 0;
        provider.ChatStreamAsync(Arg.Any<IReadOnlyList<LlmChatMessage>>(), Arg.Any<ChatOptions>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                invocation++;
                return invocation <= 2
                    ? Frames(ToolCallsFrame($"call-{invocation}", "{}"), FinishFrame("stop"))
                    : Frames(ContentFrame("done"), FinishFrame("stop"));
            });
        var recorder = new CapturingUsageRecorder();
        // 内置默认 Enabled=false：测试里显式开启压缩管道，否则首轮也不会产生压缩规模
        var appSettings = Substitute.For<IAppSettingService>();
        appSettings.GetAsync("CompressionConfig", Arg.Any<CancellationToken>())
            .Returns(ApiResponse<AppSettingDto?>.Ok(new AppSettingDto
            {
                Key = "CompressionConfig",
                Value = JsonSerializer.Serialize(new CompressionPipelineDto { Enabled = true, Mode = "algorithmic" }),
            }));
        var service = CreateAgentLoop(provider, registry, services, localizer, recorder, appSettings);
        // 重复长历史：算法压缩能明显压短，首轮请求才会记下压缩前 / 压缩后
        var history = string.Join("\n", Enumerable.Repeat("the quick brown fox jumps over the lazy dog", 200));

        await service.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            MaxIterations = 4,
            Messages =
            [
                new LlmChatMessage { Role = "user", Content = history },
                new LlmChatMessage { Role = "user", Content = "current question" },
            ],
        }, CancellationToken.None);

        Assert.Equal(3, recorder.Records.Count);
        Assert.All(recorder.Records, r => Assert.Equal(recorder.Records[0].TurnId, r.TurnId));
        var first = recorder.Records[0];
        Assert.Equal(1, first.Iteration);
        Assert.NotNull(first.CompressedTokens);
        Assert.True(first.CompressedTokens < first.InputTokens);
        // 后续迭代没有走压缩：压缩后必须留空，否则明细里整轮都显示 0% 像没压缩过
        foreach (var later in recorder.Records.Skip(1))
        {
            Assert.Null(later.CompressedTokens);
            Assert.NotNull(later.InputTokens);
        }
    }

    [Fact]
    public async Task ExecuteToolCallsAsync_后台Plan处理器_立即返回且不等待()
    {
        var executor = CreateExecutor("plan");
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var service = CreateToolExecution(services, localizer);

        var results = await service.ExecuteToolCallsAsync(
            "background",
            [new LlmToolCall { Id = "call-1", Name = "plan" }],
            [],
            [],
            _ => Task.CompletedTask,
            _ => Task.CompletedTask,
            CancellationToken.None,
            planHandler: _ => Task.FromResult(new PlanDecision(true, "")));

        Assert.Single(results);
        Assert.False(results[0].isError);
    }

    [Fact]
    public async Task ExecuteToolCallsAsync_待办ID不存在_返回错误且不修改其他步骤()
    {
        var executor = CreateExecutor("todo");
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var service = CreateToolExecution(services, localizer);
        var todos = new List<SessionTodo>
        {
            new() { Id = "step-1", Title = "first", Description = "details", Status = "not-started" },
        };

        var results = await service.ExecuteToolCallsAsync(
            "session",
            [new LlmToolCall { Id = "call-1", Name = "todo", Arguments = "{\"action\":\"complete\",\"id\":\"missing\"}" }],
            [],
            todos,
            _ => Task.CompletedTask,
            _ => Task.CompletedTask,
            CancellationToken.None);

        Assert.True(results[0].isError);
        Assert.Equal("not-started", todos[0].Status);
        Assert.Equal("details", todos[0].Description);
    }

    [Fact]
    public async Task ExecuteToolCallsAsync_单条结果产生_立即回调后再执行下一条()
    {
        var executor = CreateExecutor("test_tool");
        var persisted = 0;
        var observedDuringExecution = new List<int>();
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                observedDuringExecution.Add(persisted);
                return ToolExecutionResult.Success("ok");
            });
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var service = CreateToolExecution(services, localizer);

        await service.ExecuteToolCallsAsync(
            "session",
            [
                new LlmToolCall { Id = "call-1", Name = "test_tool" },
                new LlmToolCall { Id = "call-2", Name = "test_tool" },
            ],
            [],
            [],
            _ => Task.CompletedTask,
            _ => Task.CompletedTask,
            CancellationToken.None,
            onToolResult: _ =>
            {
                persisted++;
                return Task.CompletedTask;
            });

        Assert.Equal([0, 1], observedDuringExecution);
    }

    [Fact]
    public async Task ExecuteToolCallsAsync_等待计划期间_可查询并恢复交互()
    {
        var executor = CreateExecutor("plan");
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var service = CreateToolExecution(services, localizer);
        var published = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        async Task WriteJsonAsync(object payload)
        {
            if (payload.GetType().GetProperty("type")?.GetValue(payload)?.ToString() == "plan")
                published.TrySetResult(true);
            await Task.CompletedTask;
        }

        var execution = service.ExecuteToolCallsAsync(
            "session",
            [new LlmToolCall { Id = "call-1", Name = "plan", Arguments = "{\"title\":\"demo\"}" }],
            [],
            [],
            _ => Task.CompletedTask,
            WriteJsonAsync,
            CancellationToken.None);
        await published.Task;

        var pending = Assert.Single(service.GetPendingInteractions("session"));
        Assert.Equal("call-1", pending.ToolCallId);
        Assert.Equal("plan", pending.Type);
        Assert.Equal("{\"title\":\"demo\"}", pending.Data);
        Assert.Equal(1, service.ResolvePendingInteractions("session"));
        await execution;
        Assert.Empty(service.GetPendingInteractions("session"));
    }

    [Fact]
    public async Task RunAsync_迭代上限用尽_自动续跑而不是收尾()
    {
        var executor = CreateExecutor("test_tool");
        var executions = 0;
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                executions++;
                return ToolExecutionResult.Success("ok");
            });
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var provider = Substitute.For<ILLMProvider>();
        var invocation = 0;
        provider.ChatStreamAsync(Arg.Any<IReadOnlyList<LlmChatMessage>>(), Arg.Any<ChatOptions>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                var turn = invocation++;
                if (turn < 2) return Frames(ToolCallsFrame($"call-{turn + 1}", "{}"), FinishFrame("stop"));
                return Frames(ContentFrame("done"), FinishFrame("stop"));
            });
        var service = CreateAgentLoop(provider, registry, services, localizer);

        var result = await service.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            MaxIterations = 2,
            MaxContinuations = 1,
            CompressHistory = false,
        }, CancellationToken.None);

        Assert.Equal(1, result.ContinuationCount);
        Assert.Equal(2, executions);
        Assert.Equal(3, result.Iterations);
        Assert.False(result.IterationLimitReached);
        Assert.Equal("done", result.Content);
    }

    [Fact]
    public async Task RunAsync_Provider瞬时失败_重试后成功()
    {
        var executor = CreateExecutor("test_tool");
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var provider = Substitute.For<ILLMProvider>();
        var calls = 0;
        provider.ChatStreamAsync(Arg.Any<IReadOnlyList<LlmChatMessage>>(), Arg.Any<ChatOptions>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                if (calls++ < 2) throw new HttpRequestException("503");
                return Frames(ContentFrame("恢复成功"), FinishFrame("stop"));
            });
        var service = CreateAgentLoop(provider, registry, services, localizer);

        var result = await service.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            MaxIterations = 1,
            ProviderRetryDelayMs = 0,
            CompressHistory = false,
        }, CancellationToken.None);

        Assert.Equal(3, calls);
        Assert.Equal("恢复成功", result.Content);
        Assert.Null(result.Error);
    }

    [Fact]
    public async Task RunAsync_模型返回空回合_重试一次()
    {
        var executor = CreateExecutor("test_tool");
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var provider = Substitute.For<ILLMProvider>();
        var calls = 0;
        provider.ChatStreamAsync(Arg.Any<IReadOnlyList<LlmChatMessage>>(), Arg.Any<ChatOptions>(), Arg.Any<CancellationToken>())
            .Returns(_ => calls++ == 0
                ? Frames(FinishFrame("stop"))
                : Frames(ContentFrame("第二次有内容"), FinishFrame("stop")));
        var service = CreateAgentLoop(provider, registry, services, localizer);

        var result = await service.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            MaxIterations = 1,
            ProviderRetryDelayMs = 0,
            CompressHistory = false,
        }, CancellationToken.None);

        Assert.Equal(2, calls);
        Assert.Equal("第二次有内容", result.Content);
    }

    [Fact]
    public async Task RunAsync_只读调用重复_复用结果不再执行()
    {
        var executor = CreateExecutor("test_tool");
        executor.Risk.Returns(ToolRisk.Read);
        var executions = 0;
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                executions++;
                return ToolExecutionResult.Success("cached-body");
            });
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var provider = Substitute.For<ILLMProvider>();
        var invocation = 0;
        List<LlmChatMessage>? thirdTurn = null;
        provider.ChatStreamAsync(Arg.Any<IReadOnlyList<LlmChatMessage>>(), Arg.Any<ChatOptions>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                var turn = invocation++;
                if (turn == 0) return Frames(ToolCallsFrame("call-1", "{}"), FinishFrame("stop"));
                if (turn == 1) return Frames(ToolCallsFrame("call-2", "{}"), FinishFrame("stop"));
                thirdTurn = call.Arg<IReadOnlyList<LlmChatMessage>>().ToList();
                return Frames(ContentFrame("done"), FinishFrame("stop"));
            });
        var service = CreateAgentLoop(provider, registry, services, localizer);

        await service.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            MaxIterations = 3,
            CompressHistory = false,
        }, CancellationToken.None);

        Assert.Equal(1, executions);
        Assert.Contains(thirdTurn ?? [], m => m.Role == "tool" && m.ToolCallId == "call-2" && m.Content.Contains("toolExec.reusedResult"));
    }

    [Fact]
    public async Task RunAsync_同一调用连续失败两次_第三次被拦下()
    {
        var executor = CreateExecutor("test_tool");
        var executions = 0;
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                executions++;
                return ToolExecutionResult.Error("broken");
            });
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var provider = Substitute.For<ILLMProvider>();
        var invocation = 0;
        provider.ChatStreamAsync(Arg.Any<IReadOnlyList<LlmChatMessage>>(), Arg.Any<ChatOptions>(), Arg.Any<CancellationToken>())
            .Returns(_ => invocation++ < 3
                ? Frames(ToolCallsFrame("call-" + invocation, "{}"), FinishFrame("stop"))
                : Frames(ContentFrame("ended"), FinishFrame("stop")));
        var service = CreateAgentLoop(provider, registry, services, localizer);

        var result = await service.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            MaxIterations = 4,
            MaxContinuations = 0,
            CompressHistory = false,
        }, CancellationToken.None);

        Assert.Equal(2, executions);
        Assert.Equal("ended", result.Content);
    }

    [Fact]
    public async Task RunAsync_工具执行超过超时_返回超时结果()
    {
        var executor = CreateExecutor("test_tool");
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(async call =>
            {
                await Task.Delay(Timeout.InfiniteTimeSpan, call.Arg<CancellationToken>());
                return ToolExecutionResult.Success("unreachable");
            });
        var localizer = CreateLocalizer();
        var registry = new ToolRegistry([executor], localizer);
        using var services = CreateToolServices(registry);
        var provider = Substitute.For<ILLMProvider>();
        var invocation = 0;
        List<(string id, string content, bool isError)>? captured = null;
        provider.ChatStreamAsync(Arg.Any<IReadOnlyList<LlmChatMessage>>(), Arg.Any<ChatOptions>(), Arg.Any<CancellationToken>())
            .Returns(_ => invocation++ == 0
                ? Frames(ToolCallsFrame("call-1", "{}"), FinishFrame("stop"))
                : Frames(ContentFrame("timeout-handled"), FinishFrame("stop")));
        var service = CreateAgentLoop(provider, registry, services, localizer);

        var result = await service.RunAsync(new AgentLoopRequest
        {
            ToolNames = ["test_tool"],
            MaxIterations = 2,
            ToolTimeout = TimeSpan.FromMilliseconds(50),
            CompressHistory = false,
        }, CancellationToken.None);

        captured = result.ToolCalls.Select(t => (t.Id, t.Result ?? "", t.IsError)).ToList();
        Assert.Contains(captured, t => t.isError && t.content.Contains("toolExec.timeout"));
        Assert.Equal("timeout-handled", result.Content);
    }

    private static AgentLoopService CreateAgentLoop(
        ILLMProvider provider,
        ToolRegistry registry,
        ServiceProvider services,
        ILocalizer localizer,
        ILlmUsageRecorder? usageRecorder = null,
        IAppSettingService? appSettings = null,
        ContextCompactionService? contextCompaction = null)
    {
        var factory = Substitute.For<ILLMProviderFactory>();
        factory.CreateChatProviderAsync(Arg.Any<CancellationToken>()).Returns(provider);
        return new AgentLoopService(
            factory,
            registry,
            CreateToolExecution(services, localizer),
            new CompressionPipelineService(
                appSettings ?? Substitute.For<IAppSettingService>(),
                Substitute.For<ILogger<CompressionPipelineService>>(),
                factory,
                Substitute.For<ILlmUsageRecorder>()),
            contextCompaction ?? new ContextCompactionService(
                Substitute.For<IUnitOfWork>(),
                factory,
                Substitute.For<ILlmUsageRecorder>(),
                Substitute.For<ILogger<ContextCompactionService>>(),
                localizer),
            Substitute.For<IUnitOfWork>(),
            usageRecorder ?? Substitute.For<ILlmUsageRecorder>(),
            Substitute.For<ILogger<AgentLoopService>>(),
            localizer);
    }

    /// <summary>记录每次落库的用量行，供断言逐次请求的口径</summary>
    private sealed class CapturingUsageRecorder : ILlmUsageRecorder
    {
        public List<LlmUsageRecord> Records { get; } = [];

        public Task RecordAsync(LlmUsageRecord record, CancellationToken ct = default)
        {
            Records.Add(record);
            return Task.CompletedTask;
        }

        public Task RecordAsync(
            string source,
            LlmUsage? usage,
            Guid? refId = null,
            Guid? modelId = null,
            int? inputTokens = null,
            int? compressedTokens = null,
            int? latencyMs = null,
            string? contentPreview = null,
            Guid? turnId = null,
            int? iteration = null,
            string requestKind = LlmUsageRequestKinds.Agent,
            string? finishReason = null,
            int? toolCallCount = null,
            CancellationToken ct = default)
            => RecordAsync(new LlmUsageRecord
            {
                Source = source,
                InputTokens = inputTokens,
                CompressedTokens = compressedTokens,
                TurnId = turnId,
                Iteration = iteration,
            }, ct);
    }

    private static IToolExecutor CreateExecutor(string name)
    {
        var executor = Substitute.For<IToolExecutor>();
        executor.Name.Returns(name);
        executor.Description.Returns("test tool");
        executor.ParametersSchema.Returns(ToolSchema);
        executor.DefaultApproval.Returns(ToolApprovalMode.Auto);
        executor.Risk.Returns(ToolRisk.Write);
        return executor;
    }

    private static ILocalizer CreateLocalizer()
    {
        var localizer = Substitute.For<ILocalizer>();
        localizer.T(Arg.Any<string>(), Arg.Any<object[]>()).Returns(call => call.Arg<string>());
        return localizer;
    }

    private static ServiceProvider CreateToolServices(ToolRegistry registry) => new ServiceCollection()
        .AddScoped(_ => new WorkToolContext())
        .AddScoped(_ => registry)
        .BuildServiceProvider();

    private static ToolExecutionService CreateToolExecution(IServiceProvider services, ILocalizer localizer) => new(
        Substitute.For<ILogger<ToolExecutionService>>(),
        services.GetRequiredService<IServiceScopeFactory>(),
        localizer);

    private static string ToolCallsFrame(string id, string arguments) => JsonSerializer.Serialize(new
    {
        type = "tool_calls",
        toolCalls = new[] { new { id, name = "test_tool", arguments } },
    });

    private static string FinishFrame(string reason) => JsonSerializer.Serialize(new { type = "finish", reason });

    private static string ContentFrame(string text) => JsonSerializer.Serialize(new { type = "content", text });

    private static async IAsyncEnumerable<string> Frames(params string[] frames)
    {
        await Task.CompletedTask;
        foreach (var frame in frames) yield return frame;
    }

    private static async IAsyncEnumerable<string> ToolCallThenCancel(
        CancellationTokenSource cts,
        [EnumeratorCancellation] CancellationToken ct)
    {
        yield return """{"type":"tool_calls","toolCalls":[{"id":"call-1","name":"test_tool","arguments":"{}"}]}""";
        cts.CancelAfter(TimeSpan.FromMilliseconds(20));
        await Task.Delay(Timeout.InfiniteTimeSpan, ct);
    }
}
