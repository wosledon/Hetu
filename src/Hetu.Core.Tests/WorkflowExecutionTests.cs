using System.Runtime.CompilerServices;
using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Core.Services.Tools;
using Hetu.Core.Services.Workflows;
using Hetu.Core.Services.Workflows.NodeExecutors;
using Hetu.Shared.Workflow;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NSubstitute;
using ExecutionContext = Hetu.Core.Services.Workflows.ExecutionContext;

namespace Hetu.Core.Tests;

public class WorkflowExecutionTests
{
    [Fact]
    public async Task AgentNodeExecutor_绑定Code工作区_读取项目文件()
    {
        var root = CreateTempProject();
        try
        {
            File.WriteAllText(Path.Combine(root, "a.ts"), "file-content");
            var presetId = Guid.NewGuid();
            var provider = new ScriptedProvider([
                [ToolCallsFrame("call-1", "work_read_file", """{"path":"a.ts"}"""), FinishFrame("stop")],
                [ContentFrame("读取完成"), FinishFrame("stop")],
            ]);
            using var services = CreateServices(provider, CreateUnitOfWork(presetId));
            var executor = services.GetRequiredService<AgentNodeExecutor>();
            var node = new NodeDto
            {
                Id = "agent",
                Type = WorkflowNodeTypes.Agent,
                AgentId = presetId,
                Config = JsonSerializer.Serialize(new { toolNames = new[] { "work_read_file" }, maxIterations = 2 })
            };
            var ctx = new ExecutionContext
            {
                RunId = Guid.NewGuid(),
                Input = "读取 a.ts",
                WorkScope = new WorkToolScope { ProjectRoot = root, ProjectId = Guid.NewGuid() }
            };

            var result = await executor.ExecuteAsync(node, ctx, CancellationToken.None);

            Assert.Null(result.Error);
            var calls = JsonSerializer.Deserialize<List<AgentToolCallRecord>>(result.ExtraVariables["toolCalls"])!;
            Assert.Contains(calls, call => call.Result?.Contains("file-content") == true);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task ToolNodeExecutor_绑定Code工作区_读取项目文件()
    {
        var root = CreateTempProject();
        try
        {
            File.WriteAllText(Path.Combine(root, "a.ts"), "tool-node-content");
            using var services = CreateServices(new ScriptedProvider([]), Substitute.For<IUnitOfWork>());
            var executor = services.GetRequiredService<ToolNodeExecutor>();
            var node = new NodeDto
            {
                Id = "tool",
                Type = WorkflowNodeTypes.Tool,
                Config = JsonSerializer.Serialize(new
                {
                    toolName = "work_read_file",
                    argumentsTemplate = """{"path":"a.ts"}"""
                })
            };
            var ctx = new ExecutionContext
            {
                RunId = Guid.NewGuid(),
                WorkScope = new WorkToolScope { ProjectRoot = root, ProjectId = Guid.NewGuid() }
            };

            var result = await executor.ExecuteAsync(node, ctx, CancellationToken.None);

            Assert.Null(result.Error);
            Assert.Contains("tool-node-content", result.Output);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task AgentNodeExecutor_权限决策拒绝_不执行写入工具()
    {
        var root = CreateTempProject();
        try
        {
            var presetId = Guid.NewGuid();
            var provider = new ScriptedProvider([
                [ToolCallsFrame("call-1", "work_write_file", """{"path":"blocked.txt","content":"no"}"""), FinishFrame("stop")],
                [ContentFrame("已停止"), FinishFrame("stop")],
            ]);
            using var services = CreateServices(provider, CreateUnitOfWork(presetId));
            var executor = services.GetRequiredService<AgentNodeExecutor>();
            var node = new NodeDto
            {
                Id = "agent",
                Type = WorkflowNodeTypes.Agent,
                AgentId = presetId,
                Config = JsonSerializer.Serialize(new { toolNames = new[] { "work_write_file" }, maxIterations = 2 })
            };
            var ctx = new ExecutionContext
            {
                RunId = Guid.NewGuid(),
                Input = "写文件",
                WorkScope = new WorkToolScope { ProjectRoot = root, ProjectId = Guid.NewGuid() },
                DecideToolCall = (_, _) => Task.FromResult(new WorkToolDecision(false, ToolApprovalMode.Bypass, "denied-by-policy"))
            };

            var result = await executor.ExecuteAsync(node, ctx, CancellationToken.None);

            Assert.False(File.Exists(Path.Combine(root, "blocked.txt")));
            var calls = JsonSerializer.Deserialize<List<AgentToolCallRecord>>(result.ExtraVariables["toolCalls"])!;
            Assert.Contains(calls, call => call.IsError && call.Result?.Contains("denied-by-policy") == true);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task ExecuteAsync_传入Code工作区_传播到节点执行上下文()
    {
        var unitOfWork = Substitute.For<IUnitOfWork>();
        unitOfWork.WorkflowRuns.Returns(Substitute.For<IRepository<WorkflowRun>>());
        unitOfWork.WorkflowRunNodes.Returns(Substitute.For<IRepository<WorkflowRunNode>>());
        var localizer = CreateLocalizer();
        var capturing = new CapturingExecutor();
        var engine = new WorkflowExecutionEngine(
            unitOfWork,
            [new StartNodeExecutor(), capturing, new EndNodeExecutor()],
            Substitute.For<ILogger<WorkflowExecutionEngine>>(),
            localizer);
        var workflow = new WorkflowDto
        {
            Id = Guid.NewGuid(),
            Name = "test",
            IsEnabled = true,
            Nodes =
            [
                new NodeDto { Id = "start", Type = WorkflowNodeTypes.Start, Label = "Start" },
                new NodeDto { Id = "agent", Type = WorkflowNodeTypes.Agent, Label = "Agent", AgentId = Guid.NewGuid() },
                new NodeDto { Id = "end", Type = WorkflowNodeTypes.End, Label = "End" }
            ],
            Edges =
            [
                new EdgeDto { Id = "e1", Source = "start", Target = "agent" },
                new EdgeDto { Id = "e2", Source = "agent", Target = "end" }
            ]
        };
        var scope = new WorkToolScope { ProjectRoot = "project-root", ProjectId = Guid.NewGuid() };

        var result = await engine.ExecuteAsync(workflow, "input", CancellationToken.None, workScope: scope);

        Assert.Equal("Succeeded", result.Status);
        Assert.Same(scope, capturing.Scope);
    }

    private static IUnitOfWork CreateUnitOfWork(Guid presetId)
    {
        var unitOfWork = Substitute.For<IUnitOfWork>();
        var preset = new PromptPreset { Id = presetId, Name = "test", Content = "test prompt" };
        unitOfWork.PromptPresets.GetByIdAsync(presetId, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<PromptPreset?>(preset));
        return unitOfWork;
    }

    private static ServiceProvider CreateServices(ILLMProvider provider, IUnitOfWork unitOfWork)
    {
        var localizer = CreateLocalizer();
        var factory = Substitute.For<ILLMProviderFactory>();
        factory.CreateChatProviderAsync(Arg.Any<CancellationToken>()).Returns(provider);
        factory.CreateProviderAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(provider);

        var services = new ServiceCollection();
        services.AddScoped(_ => new WorkToolContext());
        services.AddScoped<IToolExecutor, WorkReadFileTool>();
        services.AddScoped<IToolExecutor, WorkWriteFileTool>();
        services.AddScoped<ToolRegistry>();
        services.AddSingleton(localizer);
        services.AddSingleton(unitOfWork);
        services.AddSingleton(factory);
        services.AddSingleton(Substitute.For<IAppSettingService>());
        services.AddSingleton(Substitute.For<ILogger<ToolExecutionService>>());
        services.AddSingleton(Substitute.For<ILogger<AgentLoopService>>());
        services.AddSingleton(Substitute.For<ILogger<AgentNodeExecutor>>());
        services.AddSingleton(Substitute.For<ILogger<CompressionPipelineService>>());
        services.AddSingleton(Substitute.For<ILogger<ContextCompactionService>>());
        services.AddSingleton(Substitute.For<ILlmUsageRecorder>());
        services.AddSingleton<ToolExecutionService>();
        services.AddSingleton<CompressionPipelineService>();
        services.AddSingleton<ContextCompactionService>();
        services.AddScoped<AgentLoopService>();
        services.AddScoped<AgentNodeExecutor>();
        services.AddScoped<ToolNodeExecutor>();
        return services.BuildServiceProvider();
    }

    private static ILocalizer CreateLocalizer()
    {
        var localizer = Substitute.For<ILocalizer>();
        localizer.T(Arg.Any<string>(), Arg.Any<object[]>()).Returns(call => call.Arg<string>());
        localizer.T(Arg.Any<string>()).Returns(call => call.Arg<string>());
        return localizer;
    }

    private static string CreateTempProject()
    {
        var root = Path.Combine(Path.GetTempPath(), "hetu-workflow-" + Guid.NewGuid().ToString("N"));
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

    private sealed class CapturingExecutor : INodeExecutor
    {
        public string NodeType => WorkflowNodeTypes.Agent;
        public WorkToolScope? Scope { get; private set; }

        public Task<NodeResult> ExecuteAsync(NodeDto node, ExecutionContext ctx, CancellationToken ct, IWorkflowEventSink? sink = null)
        {
            Scope = ctx.WorkScope;
            return Task.FromResult(new NodeResult { Output = "done" });
        }
    }

    private sealed class ScriptedProvider(IEnumerable<string[]> turns) : ILLMProvider
    {
        private readonly Queue<string[]> _turns = new(turns);

        public string ProviderType => "test";
        public bool SupportsStreaming => true;

        public Task<string> ChatAsync(IReadOnlyList<LlmChatMessage> messages, ChatOptions options, CancellationToken cancellationToken = default)
            => Task.FromResult(string.Empty);

        public async IAsyncEnumerable<string> ChatStreamAsync(
            IReadOnlyList<LlmChatMessage> messages,
            ChatOptions options,
            [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            var frames = _turns.Count > 0 ? _turns.Dequeue() : [FinishFrame("stop")];
            await Task.Yield();
            foreach (var frame in frames) yield return frame;
        }

        public Task<string> CompleteAsync(string prompt, CompletionOptions options, CancellationToken cancellationToken = default)
            => Task.FromResult(string.Empty);
    }
}
