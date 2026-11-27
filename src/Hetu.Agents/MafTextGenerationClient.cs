using System.Runtime.CompilerServices;
using System.Text.Json;
using Hetu.Core.Interfaces;
using Microsoft.Extensions.AI;
using AiChatOptions = Microsoft.Extensions.AI.ChatOptions;

namespace Hetu.Agents;

/// <summary>非 Agent 文本任务统一走 MAF Agent；不再维护 OpenAI/Anthropic 私有 HTTP 客户端。</summary>
internal sealed class MafTextGenerationClient : ITextGenerationClient
{
    private readonly IAgentFactory _factory;
    private readonly AgentModelResolver _resolver;

    public MafTextGenerationClient(IAgentFactory factory, AgentModelResolver resolver)
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
            messages.ToChatMessages(),
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

    public async Task<LlmChatResult> ChatJsonWithUsageAsync<T>(
        Guid? modelId,
        IReadOnlyList<LlmChatMessage> messages,
        Hetu.Core.Interfaces.ChatOptions options,
        JsonSerializerOptions? jsonSerializerOptions = null,
        CancellationToken cancellationToken = default) where T : class
    {
        var overrides = MapOptions(options);
        var formatApplied = false;
        try
        {
            var schema = AIJsonUtilities.CreateJsonSchema(
                typeof(T), serializerOptions: jsonSerializerOptions);
            overrides.ResponseFormat = new ChatResponseFormatJson(schema, typeof(T).Name);
            formatApplied = true;
        }
        catch (Exception)
        {
            // 复杂/不可见类型可能无法生成 schema，保留字符串输出并由调用方宽松解析。
        }

        var clock = System.Diagnostics.Stopwatch.StartNew();
        var agent = await CreateTextAgentAsync(modelId, options.SystemPrompt, overrides, cancellationToken);
        if (agent == null) return new LlmChatResult();

        try
        {
            return await RunTextAsync(agent, messages, clock, cancellationToken);
        }
        catch (Exception ex) when (formatApplied && ex is not OperationCanceledException)
        {
            // 并非所有 OpenAI 兼容端点都接受 response_format，失败时退回纯文本 JSON。
            overrides.ResponseFormat = null;
            agent = await CreateTextAgentAsync(modelId, options.SystemPrompt, overrides, cancellationToken);
            if (agent == null) return new LlmChatResult();
            return await RunTextAsync(agent, messages, clock, cancellationToken);
        }
    }

    private async Task<Microsoft.Agents.AI.AIAgent?> CreateTextAgentAsync(
        Guid? modelId,
        string? instructions,
        AiChatOptions options,
        CancellationToken cancellationToken)
    {
        var agent = await _factory.CreateTextAgentAsync(modelId, instructions, options, cancellationToken);
        if (agent == null && modelId.HasValue)
            agent = await _factory.CreateTextAgentAsync(null, instructions, options, cancellationToken);
        return agent;
    }

    private static async Task<LlmChatResult> RunTextAsync(
        Microsoft.Agents.AI.AIAgent agent,
        IReadOnlyList<LlmChatMessage> messages,
        System.Diagnostics.Stopwatch clock,
        CancellationToken cancellationToken)
    {
        var response = await agent.RunAsync(
            messages.ToChatMessages(),
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
            messages.ToChatMessages(),
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
            Reasoning = ReasoningOptionsMapper.Create(options.ReasoningEffort, options.ReasoningBudgetTokens),
        };
        return mapped;
    }
}