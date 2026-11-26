using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Core.Streaming;
using Hetu.Core.Utilities;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using AiChatOptions = Microsoft.Extensions.AI.ChatOptions;

namespace Hetu.Agents;

/// <summary>
/// MAF 管道里的唯一一层运行时中间件：注入运行中引导、按 load_tools 结果刷新工具声明、按模型请求记录用量。
/// 不实现模型/工具循环——循环由 <see cref="FunctionInvokingChatClient"/> 负责。
/// </summary>
internal sealed class AgentContextChatClient : DelegatingChatClient
{
    private const string SteeringPrefix = "【运行中引导，请立即结合它调整当前工作】\n";

    private readonly AgentRunState _state;
    private readonly ILlmUsageRecorder _usageRecorder;
    private readonly ILogger _logger;

    public AgentContextChatClient(
        IChatClient innerClient,
        AgentRunState state,
        ILlmUsageRecorder usageRecorder,
        ILogger logger)
        : base(innerClient)
    {
        _state = state;
        _usageRecorder = usageRecorder;
        _logger = logger;
    }

    public override async Task<ChatResponse> GetResponseAsync(
        IEnumerable<ChatMessage> messages,
        AiChatOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        var (prepared, preparedOptions) = await PrepareAsync(messages, options);
        var clock = Stopwatch.StartNew();
        var response = await base.GetResponseAsync(prepared, preparedOptions, cancellationToken);
        clock.Stop();
        await RecordUsageAsync(response.Usage, clock.ElapsedMilliseconds, response.Text, string.Empty, [], null, prepared, preparedOptions);
        return response;
    }

    public override async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages,
        AiChatOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var (prepared, preparedOptions) = await PrepareAsync(messages, options);
        var clock = Stopwatch.StartNew();
        var content = new StringBuilder();
        var thinking = new StringBuilder();
        var toolNames = new List<string>();
        UsageDetails? usage = null;
        string? finishReason = null;
        var tagParser = new LlmStreamParser();

        await foreach (var update in base.GetStreamingResponseAsync(prepared, preparedOptions, cancellationToken))
        {
            var normalized = NormalizeContents(update, tagParser, content, thinking, toolNames, ref usage);
            if (update.FinishReason is { } reason) finishReason = reason.ToString();
            if (normalized is { Count: > 0 } || update.FinishReason is not null)
            {
                if (normalized is not null) update.Contents = normalized;
                yield return update;
            }
        }

        foreach (var chunk in tagParser.Flush())
        {
            if (chunk.Type == LlmStreamEventType.Thinking)
            {
                thinking.Append(chunk.Text);
                yield return new ChatResponseUpdate(ChatRole.Assistant, [new TextReasoningContent(chunk.Text)]);
            }
            else if (chunk.Type == LlmStreamEventType.Content)
            {
                content.Append(chunk.Text);
                yield return new ChatResponseUpdate(ChatRole.Assistant, chunk.Text);
            }
        }

        clock.Stop();
        await RecordUsageAsync(usage, clock.ElapsedMilliseconds, content.ToString(), thinking.ToString(), toolNames, finishReason, prepared, preparedOptions);
    }

    private static List<AIContent>? NormalizeContents(
        ChatResponseUpdate update,
        LlmStreamParser parser,
        StringBuilder content,
        StringBuilder thinking,
        List<string> toolNames,
        ref UsageDetails? usage)
    {
        List<AIContent>? normalized = null;
        foreach (var item in update.Contents)
        {
            switch (item)
            {
                case TextContent text:
                    normalized ??= [];
                    foreach (var chunk in parser.Parse(text.Text))
                    {
                        if (chunk.Type == LlmStreamEventType.Thinking)
                        {
                            thinking.Append(chunk.Text);
                            normalized.Add(new TextReasoningContent(chunk.Text));
                        }
                        else if (chunk.Type == LlmStreamEventType.Content)
                        {
                            content.Append(chunk.Text);
                            normalized.Add(new TextContent(chunk.Text));
                        }
                    }
                    break;
                case TextReasoningContent reasoning:
                    normalized ??= [];
                    thinking.Append(reasoning.Text);
                    normalized.Add(reasoning);
                    break;
                case FunctionCallContent call:
                    if (!toolNames.Contains(call.Name, StringComparer.Ordinal))
                        toolNames.Add(call.Name);
                    normalized?.Add(item);
                    break;
                case UsageContent usageContent:
                    usage = MergeUsage(usage, usageContent.Details);
                    normalized?.Add(item);
                    break;
                default:
                    normalized?.Add(item);
                    break;
            }
        }
        return normalized;
    }

    private async Task<(List<ChatMessage> Messages, AiChatOptions Options)> PrepareAsync(
        IEnumerable<ChatMessage> messages,
        AiChatOptions? options)
    {
        var list = messages.ToList();

        if (_state.Request.DrainSteering is { } drain)
        {
            foreach (var guidance in drain())
            {
                if (string.IsNullOrWhiteSpace(guidance)) continue;
                list.Add(new ChatMessage(ChatRole.User, SteeringPrefix + guidance));
                await _state.Sink.OnSteeringAsync(guidance);
            }
        }

        var preparedOptions = (options ?? new AiChatOptions()).Clone();
        _state.ToolCallsThisIteration = 0;
        preparedOptions.Tools = _state.Request.EnableTools
            ? _state.GetDeclaredFunctions().Cast<AITool>().ToList()
            : [];
        return (list, preparedOptions);
    }

    private async Task RecordUsageAsync(
        UsageDetails? usageDetails,
        long elapsedMs,
        string content,
        string thinking,
        IReadOnlyList<string> toolNames,
        string? finishReason,
        IReadOnlyList<ChatMessage> messages,
        AiChatOptions? options)
    {
        var usage = AgentRunState.ToUsage(usageDetails);
        if (usage.TotalTokens == 0 && usage.PromptTokens == 0) usage = new LlmUsage();
        _state.IterationCount++;
        _state.Result.Iterations = _state.IterationCount;
        if (usage.PromptTokens > 0 || usage.CompletionTokens > 0 || usage.TotalTokens > 0)
        {
            _state.AccumulateUsage(usage);
            await _state.Sink.OnUsageAsync(_state.Result.Usage);
        }

        var first = _state.IterationCount == 1;
        var requestChars = messages.Sum(message => (long)message.Text.Length)
            + (options?.Instructions?.Length ?? 0);
        var inputEstimate = LlmTokenEstimator.EstimateChars(requestChars);
        var recordedInput = first && _state.Result.FirstIterationInputChars > 0
            ? LlmTokenEstimator.EstimateChars(_state.Result.FirstIterationInputChars)
            : inputEstimate;
        int? compressed = first
            ? _state.Result.FirstIterationCompressedChars > 0
                ? LlmTokenEstimator.EstimateChars(_state.Result.FirstIterationCompressedChars)
                : inputEstimate
            : null;

        var preview = toolNames.Count > 0 ? string.Join("、", toolNames) : content;
        if (_state.Hooks != null)
        {
            await _state.Hooks.OnIterationAsync(
                Math.Max(0, _state.IterationCount - 1),
                content,
                thinking,
                usage.TotalTokens > 0 || usage.PromptTokens > 0 ? usage : null);
        }
        try
        {
            await _usageRecorder.RecordAsync(
                _state.Request.UsageSource,
                usage.TotalTokens > 0 || usage.PromptTokens > 0 ? usage : null,
                refId: _state.Request.UsageRefId,
                modelId: _state.Request.ModelId,
                inputTokens: recordedInput,
                compressedTokens: compressed,
                latencyMs: (int)elapsedMs,
                contentPreview: first ? _state.TurnPreview : preview,
                turnId: _state.TurnId,
                iteration: _state.IterationCount,
                requestKind: _state.Request.UsageRequestKind,
                finishReason: finishReason,
                toolCallCount: toolNames.Count,
                ct: CancellationToken.None);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[Agent] 用量记录失败");
        }
    }

    private static UsageDetails MergeUsage(UsageDetails? current, UsageDetails? delta)
    {
        if (delta == null) return current ?? new UsageDetails();
        if (current == null) return delta;
        current.InputTokenCount = (current.InputTokenCount ?? 0) + (delta.InputTokenCount ?? 0);
        current.OutputTokenCount = (current.OutputTokenCount ?? 0) + (delta.OutputTokenCount ?? 0);
        current.CachedInputTokenCount = (current.CachedInputTokenCount ?? 0) + (delta.CachedInputTokenCount ?? 0);
        return current;
    }
}