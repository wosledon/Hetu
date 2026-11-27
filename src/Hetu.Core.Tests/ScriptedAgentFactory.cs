using System.Runtime.CompilerServices;
using System.Text.Json;
using Hetu.Agents;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Core.Streaming;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using AiChatMessage = Microsoft.Extensions.AI.ChatMessage;
using AiChatOptions = Microsoft.Extensions.AI.ChatOptions;

namespace Hetu.Core.Tests;

/// <summary>测试用 Agent 工厂：把脚本化模型接到 MAF 的 FunctionInvokingChatClient 上。</summary>
internal interface IScriptedModel
{
    string ProviderType { get; }
    IAsyncEnumerable<string> ChatStreamAsync(
        IReadOnlyList<LlmChatMessage> messages,
        Hetu.Core.Interfaces.ChatOptions options,
        CancellationToken cancellationToken = default);
}

internal sealed class ScriptedAgentFactory : IAgentFactory
{
    private readonly IScriptedModel _provider;
    private readonly CompressionPipelineService _compression;
    private readonly ILocalizer _localizer;
    private readonly ILlmUsageRecorder _usageRecorder;

    public ScriptedAgentFactory(IScriptedModel provider)
    {
        _provider = provider;
        _usageRecorder = Substitute.For<ILlmUsageRecorder>();
        _localizer = Substitute.For<ILocalizer>();
        _localizer.T(Arg.Any<string>()).Returns(call => call.Arg<string>());
        _localizer.T(Arg.Any<string>(), Arg.Any<object[]>()).Returns(call => call.Arg<string>());
        _compression = new CompressionPipelineService(
            Substitute.For<IAppSettingService>(),
            NullLogger<CompressionPipelineService>.Instance,
            Substitute.For<ITextGenerationClient>(),
            _usageRecorder);
    }

    public Task<ResolvedAgentModel?> ResolveAsync(Guid? modelId, CancellationToken ct)
    {
        var model = new AiModel { ModelId = "test" };
        var provider = new AiProvider { ProviderType = "test" };
        return Task.FromResult<ResolvedAgentModel?>(new ResolvedAgentModel(model, provider, "", "https://test.invalid"));
    }

    public AIAgent Create(
        ResolvedAgentModel model,
        ChatClientAgentOptions agentOptions,
        AgentRunState state,
        int maxIterations)
    {
        var chatClient = new ScriptedChatClient(_provider);
        var observer = new AgentContextChatClient(
            chatClient,
            state,
            _usageRecorder,
            _compression,
            _localizer,
            NullLogger<AgentContextChatClient>.Instance);
        var functionClient = new FunctionInvokingChatClient(observer, NullLoggerFactory.Instance)
        {
            MaximumIterationsPerRequest = Math.Max(1, maxIterations),
            AllowConcurrentInvocation = false,
        };
        return functionClient.AsAIAgent(agentOptions, loggerFactory: NullLoggerFactory.Instance);
    }

    public Task<AIAgent?> CreateTextAgentAsync(
        Guid? modelId,
        string? instructions,
        AiChatOptions? overrides,
        CancellationToken ct)
    {
        var options = overrides?.Clone() ?? new AiChatOptions();
        options.Instructions = instructions;
        var agent = new ScriptedChatClient(_provider).AsAIAgent(
            new ChatClientAgentOptions { Name = "test-text", ChatOptions = options },
            loggerFactory: NullLoggerFactory.Instance);
        return Task.FromResult<AIAgent?>(agent);
    }

    private sealed class ScriptedChatClient(IScriptedModel provider) : IChatClient
    {
        public async Task<ChatResponse> GetResponseAsync(
            IEnumerable<AiChatMessage> messages,
            AiChatOptions? options = null,
            CancellationToken cancellationToken = default)
        {
            var response = new ChatResponse();
            await foreach (var update in GetStreamingResponseAsync(messages, options, cancellationToken))
                response.Messages.AddMessages(update);
            return response;
        }

        public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
            IEnumerable<AiChatMessage> messages,
            AiChatOptions? options = null,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            var llmMessages = messages.Select(message => message.ToLlmMessage()).ToList();
            var parser = new LlmStreamParser();
            var toolCalls = new List<LlmToolCall>();

            await foreach (var delta in provider.ChatStreamAsync(
                llmMessages,
                new Hetu.Core.Interfaces.ChatOptions { SystemPrompt = options?.Instructions },
                cancellationToken))
            {
                foreach (var chunk in parser.Parse(delta))
                {
                    switch (chunk.Type)
                    {
                        case LlmStreamEventType.Content:
                            if (chunk.Text.Length > 0)
                                yield return new ChatResponseUpdate(ChatRole.Assistant, chunk.Text);
                            break;
                        case LlmStreamEventType.Thinking:
                            if (chunk.Text.Length > 0)
                                yield return new ChatResponseUpdate(ChatRole.Assistant, [new TextReasoningContent(chunk.Text)]);
                            break;
                        case LlmStreamEventType.ToolCalls:
                            if (chunk.ToolCalls != null) toolCalls.AddRange(chunk.ToolCalls);
                            break;
                    }
                }
            }

            if (toolCalls.Count > 0)
            {
                yield return new ChatResponseUpdate(ChatRole.Assistant,
                    toolCalls.Select(call => (AIContent)new FunctionCallContent(
                        call.Id,
                        call.Name,
                        JsonSerializer.Deserialize<Dictionary<string, object?>>(call.Arguments)
                        ?? new Dictionary<string, object?>())).ToList());
            }
        }

        public object? GetService(Type serviceType, object? serviceKey = null) => null;
        public void Dispose() { }
    }
}