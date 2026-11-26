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

    public ScriptedAgentFactory(IScriptedModel provider) => _provider = provider;

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
        var functionClient = new FunctionInvokingChatClient(chatClient, NullLoggerFactory.Instance)
        {
            MaximumIterationsPerRequest = Math.Max(1, maxIterations),
            AllowConcurrentInvocation = false,
        };
        return functionClient.AsAIAgent(agentOptions, loggerFactory: NullLoggerFactory.Instance);
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
            var llmMessages = messages.Select(AgentMessageMapper.ToLlmMessage).ToList();
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
                        case LlmStreamEventType.Usage:
                            if (chunk.Usage != null)
                                yield return new ChatResponseUpdate(ChatRole.Assistant,
                                [
                                    new UsageContent(new UsageDetails
                                    {
                                        InputTokenCount = chunk.Usage.PromptTokens,
                                        OutputTokenCount = chunk.Usage.CompletionTokens,
                                    })
                                ]);
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