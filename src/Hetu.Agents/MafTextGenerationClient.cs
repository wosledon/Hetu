using System.Runtime.CompilerServices;
using Hetu.Core.Interfaces;
using Microsoft.Extensions.AI;
using AiChatOptions = Microsoft.Extensions.AI.ChatOptions;

namespace Hetu.Agents;

/// <summary>非 Agent 文本任务统一走 MAF Agent；不再维护 OpenAI/Anthropic 私有 HTTP 客户端。</summary>
internal sealed class MafTextGenerationClient : ITextGenerationClient
{
    private readonly HetuAgentFactory _factory;
    private readonly AgentModelResolver _resolver;

    public MafTextGenerationClient(HetuAgentFactory factory, AgentModelResolver resolver)
    {
        _factory = factory;
        _resolver = resolver;
    }

    public Task<Guid?> ResolveScenarioModelAsync(string scenario, CancellationToken cancellationToken = default)
        => _resolver.ResolveScenarioAsync(scenario, cancellationToken);

    public Task<Guid?> ResolveCompletionModelAsync(CancellationToken cancellationToken = default)
        => _resolver.ResolveCompletionAsync(cancellationToken);

    public async Task<bool> IsAvailableAsync(Guid? modelId, CancellationToken cancellationToken = default)
        => await _resolver.ResolveAsync(modelId, cancellationToken) != null;

    public async Task<LlmChatResult> ChatWithUsageAsync(
        Guid? modelId,
        IReadOnlyList<LlmChatMessage> messages,
        Hetu.Core.Interfaces.ChatOptions options,
        CancellationToken cancellationToken = default)
    {
        var agent = await _factory.CreateTextAgentAsync(
            modelId,
            options.SystemPrompt,
            MapOptions(options),
            cancellationToken);
        if (agent == null && modelId.HasValue)
            agent = await _factory.CreateTextAgentAsync(null, options.SystemPrompt, MapOptions(options), cancellationToken);
        if (agent == null) return new LlmChatResult();

        var clock = System.Diagnostics.Stopwatch.StartNew();
        var response = await agent.RunAsync(
            AgentMessageMapper.ToChatMessages(messages),
            cancellationToken: cancellationToken);
        clock.Stop();
        return new LlmChatResult
        {
            Content = response.Text,
            Thinking = string.Concat(response.Messages
                .SelectMany(message => message.Contents)
                .OfType<TextReasoningContent>()
                .Select(content => content.Text)),
            FinishReason = response.FinishReason?.ToString(),
            ElapsedMs = clock.ElapsedMilliseconds,
            Usage = AgentRunState.ToUsage(response.Usage),
        };
    }

    public async IAsyncEnumerable<string> ChatStreamAsync(
        Guid? modelId,
        IReadOnlyList<LlmChatMessage> messages,
        Hetu.Core.Interfaces.ChatOptions options,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var agent = await _factory.CreateTextAgentAsync(
            modelId,
            options.SystemPrompt,
            MapOptions(options),
            cancellationToken);
        if (agent == null && modelId.HasValue)
            agent = await _factory.CreateTextAgentAsync(null, options.SystemPrompt, MapOptions(options), cancellationToken);
        if (agent == null) yield break;

        await foreach (var update in agent.RunStreamingAsync(
            AgentMessageMapper.ToChatMessages(messages),
            cancellationToken: cancellationToken))
        {
            if (!string.IsNullOrEmpty(update.Text))
                yield return update.Text;
        }
    }

    private static AiChatOptions MapOptions(Hetu.Core.Interfaces.ChatOptions options)
    {
        var mapped = new AiChatOptions
        {
            Temperature = options.Temperature is { } temperature ? (float?)temperature : null,
            MaxOutputTokens = options.MaxTokens,
            Reasoning = string.IsNullOrWhiteSpace(options.ReasoningEffort)
                ? null
                : new ReasoningOptions { Effort = ParseReasoningEffort(options.ReasoningEffort) },
            AdditionalProperties = new AdditionalPropertiesDictionary
            {
                ["ReasoningBudgetTokens"] = options.ReasoningBudgetTokens,
            },
        };
        return mapped;
    }

    private static ReasoningEffort ParseReasoningEffort(string value) => value.Trim().ToLowerInvariant() switch
    {
        "none" => ReasoningEffort.None,
        "minimal" => ReasoningEffort.Low,
        "low" => ReasoningEffort.Low,
        "medium" => ReasoningEffort.Medium,
        "high" => ReasoningEffort.High,
        "xhigh" or "max" => ReasoningEffort.ExtraHigh,
        _ => ReasoningEffort.Medium,
    };
}