using System.Runtime.CompilerServices;
using System.Text.Json;
using Hetu.Agents;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Core.Services.Tools;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace Hetu.Core.Tests;

public class SubAgentExecutionTests
{
    private static readonly JsonElement ToolSchema = JsonDocument.Parse("""{"type":"object"}""").RootElement;

    [Fact]
    public async Task SubAgentSink_文本与思考增量_合并条目并推送delta帧()
    {
        var frames = new List<JsonElement>();
        var sink = new SubAgentSink(payload =>
        {
            frames.Add(JsonSerializer.SerializeToElement(payload));
            return Task.CompletedTask;
        }, "sa", "调研");

        await sink.OnThinkingAsync("想法");
        await sink.OnThinkingAsync("继续");
        await sink.OnContentAsync("结论");

        Assert.Equal(2, sink.Entries.Count);
        Assert.Equal("thinking", sink.Entries[0].Kind);
        Assert.Equal("想法继续", sink.Entries[0].Text);
        Assert.Equal("text", sink.Entries[1].Kind);
        Assert.Equal(3, frames.Count);
        Assert.All(frames, frame => Assert.Equal("delta", frame.GetProperty("stage").GetString()));
    }

    [Fact]
    public async Task SubAgentSink_工具调用与结果_回填结果并统计步数()
    {
        var frames = new List<JsonElement>();
        var sink = new SubAgentSink(payload =>
        {
            frames.Add(JsonSerializer.SerializeToElement(payload));
            return Task.CompletedTask;
        }, "sa", "调研");

        await sink.OnEventAsync(new { type = "tool_call", id = "c1", name = "work_read_file", arguments = """{"path":"a.ts"}""", hidden = false });
        await sink.OnEventAsync(new { type = "tool_result", id = "c1", name = "work_read_file", content = "file", isError = false, hidden = false });

        Assert.Equal(1, sink.Steps);
        var entry = Assert.Single(sink.Entries);
        Assert.Equal("file", entry.Result);
        Assert.False(entry.IsError);
        Assert.Equal("tool", frames[0].GetProperty("stage").GetString());
        Assert.Equal("work_read_file", frames[0].GetProperty("tool").GetString());
        Assert.Equal("tool_result", frames[1].GetProperty("stage").GetString());
    }

    [Fact]
    public async Task WorkTaskTool_白名单工具_执行并回传结论与done帧()
    {
        var executions = 0;
        var executor = CreateExecutor("work_read_file");
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                executions++;
                return ToolExecutionResult.Success("file-content");
            });

        var provider = new ScriptedProvider([
            [ToolCallsFrame("call-1", "work_read_file", """{"path":"a.ts"}"""), FinishFrame("stop")],
            [ContentFrame("结论：内容正常"), FinishFrame("stop")],
        ]);
        using var services = CreateServices(executor, provider);
        var root = CreateTempProject();
        try
        {
            var context = services.GetRequiredService<WorkToolContext>();
            context.ProjectRoot = root;
            var tool = new WorkTaskTool(context, services);

            var result = await tool.ExecuteAsync("""{"description":"读文件","prompt":"读 a.ts"}""");

            Assert.False(result.IsError, result.Content);
            Assert.Equal(1, executions);
            Assert.Contains("结论：内容正常", result.Content);
            Assert.Contains("调研 1 步", result.Content);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task WorkTaskTool_白名单外工具_拒绝执行()
    {
        var executions = 0;
        var executor = CreateExecutor("work_write_file");
        executor.ExecuteAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                executions++;
                return ToolExecutionResult.Success("should-not-run");
            });

        var provider = new ScriptedProvider([
            [ToolCallsFrame("call-1", "work_write_file", """{"path":"a.ts","content":"x"}"""), FinishFrame("stop")],
            [ContentFrame("无法修改文件，改为说明原因"), FinishFrame("stop")],
        ]);
        using var services = CreateServices(executor, provider);
        var root = CreateTempProject();
        try
        {
            var context = services.GetRequiredService<WorkToolContext>();
            context.ProjectRoot = root;
            var tool = new WorkTaskTool(context, services);

            var result = await tool.ExecuteAsync("""{"description":"写文件","prompt":"写 a.ts"}""");

            Assert.False(result.IsError);
            Assert.Equal(0, executions);
            Assert.Contains("无法修改文件", result.Content);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
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
        services.AddSingleton(Substitute.For<ILogger<ContextCompactionService>>());
        services.AddSingleton(Substitute.For<ILlmUsageRecorder>());
        services.AddSingleton(Substitute.For<ITextGenerationClient>());
        services.AddSingleton(new McpClientProvider(NullLoggerFactory.Instance));
        services.AddSingleton<ToolExecutionService>();
        services.AddSingleton<CompressionPipelineService>();
        services.AddSingleton<ContextCompactionService>();
        services.AddSingleton<IAgentFactory>(new ScriptedAgentFactory(provider));
        services.AddScoped<HetuAgentRunner>();
        services.AddScoped<IAgentRunner>(sp => sp.GetRequiredService<HetuAgentRunner>());
        return services.BuildServiceProvider();
    }

    private static IToolExecutor CreateExecutor(string name)
    {
        var executor = Substitute.For<IToolExecutor>();
        executor.Name.Returns(name);
        executor.Description.Returns("test tool");
        executor.ParametersSchema.Returns(ToolSchema);
        executor.DefaultApproval.Returns(ToolApprovalMode.Auto);
        return executor;
    }

    private static string CreateTempProject()
    {
        var root = Path.Combine(Path.GetTempPath(), "hetu-subagent-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        return root;
    }

    private static string ToolCallsFrame(string id, string name, string arguments) => JsonSerializer.Serialize(new
    {
        type = "tool_calls",
        toolCalls = new[] { new { id, name, arguments } },
    });

    private static string FinishFrame(string reason) => JsonSerializer.Serialize(new { type = "finish", reason });

    private static string ContentFrame(string text) => JsonSerializer.Serialize(new { type = "content", text });

    private sealed class ScriptedProvider(IEnumerable<string[]> turns) : IScriptedModel
    {
        private readonly Queue<string[]> _turns = new(turns);

        public string ProviderType => "test";

        public async IAsyncEnumerable<string> ChatStreamAsync(
            IReadOnlyList<LlmChatMessage> messages,
            ChatOptions options,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            var frames = _turns.Count > 0 ? _turns.Dequeue() : [FinishFrame("stop")];
            await Task.Yield();
            foreach (var frame in frames) yield return frame;
        }
    }
}
