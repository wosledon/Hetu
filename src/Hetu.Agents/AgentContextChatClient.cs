using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using Anthropic.Exceptions;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Core.Streaming;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using AiChatOptions = Microsoft.Extensions.AI.ChatOptions;

namespace Hetu.Agents;

/// <summary>
/// MAF 管道里的运行时中间件：刷新工具声明、记录用量、执行上下文闸门与重试。
/// 运行中引导由 <see cref="SteeringContextProvider"/> 注入；这里不实现模型/工具循环。
/// </summary>
internal sealed class AgentContextChatClient : DelegatingChatClient
{
    private const long MinCompressChars = 1500;

    private readonly AgentRunState _state;
    private readonly ILlmUsageRecorder _usageRecorder;
    private readonly CompressionPipelineService _compression;
    private readonly ILocalizer _localizer;
    private readonly ILogger _logger;

    public AgentContextChatClient(
        IChatClient innerClient,
        AgentRunState state,
        ILlmUsageRecorder usageRecorder,
        CompressionPipelineService compression,
        ILocalizer localizer,
        ILogger logger)
        : base(innerClient)
    {
        _state = state;
        _usageRecorder = usageRecorder;
        _compression = compression;
        _localizer = localizer;
        _logger = logger;
    }

    public override async Task<ChatResponse> GetResponseAsync(
        IEnumerable<ChatMessage> messages,
        AiChatOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        var (prepared, preparedOptions) = await PrepareAsync(messages, options, cancellationToken);
        var clock = Stopwatch.StartNew();
        var emptyRetryUsed = false;
        var maxRetries = Math.Max(0, _state.Request.ProviderMaxRetries);

        for (var attempt = 0; ; attempt++)
        {
            try
            {
                var response = await base.GetResponseAsync(prepared, preparedOptions, cancellationToken);
                clock.Stop();
                var contents = response.Messages.SelectMany(message => message.Contents).ToList();
                var toolNames = contents.OfType<FunctionCallContent>()
                    .Select(call => call.Name)
                    .Distinct(StringComparer.Ordinal)
                    .ToList();
                var hasOutput = !string.IsNullOrWhiteSpace(response.Text)
                                || toolNames.Count > 0
                                || contents.OfType<TextReasoningContent>().Any();
                if (!hasOutput
                    && response.FinishReason != ChatFinishReason.Length
                    && response.FinishReason != ChatFinishReason.ContentFilter
                    && !emptyRetryUsed
                    && attempt < maxRetries)
                {
                    emptyRetryUsed = true;
                    await DelayBeforeRetryAsync(attempt, null, cancellationToken);
                    continue;
                }

                foreach (var content in contents)
                {
                    if (content is TextContent text)
                        await _state.AppendTextAsync(text.Text);
                    else if (content is TextReasoningContent reasoning)
                        await _state.AppendThinkingAsync(reasoning.Text);
                }

                var thinking = string.Concat(contents.OfType<TextReasoningContent>().Select(content => content.Text));
                var inputChars = (int)ChatMessageMetrics.CountChars(prepared) + (preparedOptions.Instructions?.Length ?? 0);
                await RecordUsageAsync(
                    response.Usage, clock.ElapsedMilliseconds, response.Text, thinking,
                    toolNames, response.FinishReason?.ToString(), inputChars);
                return response;
            }
            catch (Exception ex) when (!cancellationToken.IsCancellationRequested
                                       && attempt < maxRetries
                                       && (ex is OperationCanceledException || IsTransient(ex)))
            {
                await DelayBeforeRetryAsync(attempt, ex, cancellationToken);
            }
        }
    }

    public override async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages,
        AiChatOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var (prepared, preparedOptions) = await PrepareAsync(messages, options, cancellationToken);
        var clock = Stopwatch.StartNew();
        var maxRetries = Math.Max(0, _state.Request.ProviderMaxRetries);
        var emptyRetryUsed = false;

        var finalContent = new StringBuilder();
        var finalThinking = new StringBuilder();
        var finalToolNames = new List<string>();
        UsageDetails? finalUsage = null;
        string? finalFinishReason = null;

        for (var attempt = 0; ; attempt++)
        {
            var retry = false;
            var emitted = false;
            var content = new StringBuilder();
            var thinking = new StringBuilder();
            var toolNames = new List<string>();
            UsageDetails? usage = null;
            string? finishReason = null;
            var parser = new LlmStreamParser();

            await using (var enumerator = base.GetStreamingResponseAsync(prepared, preparedOptions, cancellationToken)
                             .GetAsyncEnumerator(cancellationToken))
            {
                while (true)
                {
                    bool moved;
                    try
                    {
                        moved = await enumerator.MoveNextAsync();
                    }
                    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                    {
                        throw;
                    }
                    catch (Exception ex) when (!emitted && attempt < maxRetries
                                       && (ex is OperationCanceledException || IsTransient(ex)))
                    {
                        await DelayBeforeRetryAsync(attempt, ex, cancellationToken);
                        retry = true;
                        break;
                    }

                    if (!moved) break;
                    var update = enumerator.Current;
                    var normalized = NormalizeContents(update, parser, content, thinking, toolNames, ref usage);
                    if (update.FinishReason is { } reason) finishReason = reason.ToString();
                    if (normalized is { Count: > 0 })
                    {
                        update.Contents = normalized;
                        if (normalized.Any(item => item is TextContent or TextReasoningContent or FunctionCallContent))
                            emitted = true;
                    }
                    if (normalized is { Count: > 0 } || update.FinishReason is not null)
                        yield return update;
                }
            }

            if (retry) continue;

            foreach (var chunk in parser.Flush())
            {
                if (chunk.Type == LlmStreamEventType.Thinking)
                {
                    if (chunk.Text.Length == 0) continue;
                    thinking.Append(chunk.Text);
                    emitted = true;
                    yield return new ChatResponseUpdate(ChatRole.Assistant, [new TextReasoningContent(chunk.Text)]);
                }
                else if (chunk.Type == LlmStreamEventType.Content)
                {
                    if (chunk.Text.Length == 0) continue;
                    content.Append(chunk.Text);
                    emitted = true;
                    yield return new ChatResponseUpdate(ChatRole.Assistant, chunk.Text);
                }
            }

            if (!emitted && !emptyRetryUsed && attempt < maxRetries
                && finishReason is not ("length" or "max_tokens"))
            {
                emptyRetryUsed = true;
                await DelayBeforeRetryAsync(attempt, null, cancellationToken);
                continue;
            }

            finalContent.Append(content);
            finalThinking.Append(thinking);
            finalToolNames.AddRange(toolNames);
            finalUsage = usage;
            finalFinishReason = finishReason;
            break;
        }

        clock.Stop();
        var inputChars = (int)ChatMessageMetrics.CountChars(prepared) + (preparedOptions.Instructions?.Length ?? 0);
        await RecordUsageAsync(
            finalUsage, clock.ElapsedMilliseconds, finalContent.ToString(), finalThinking.ToString(),
            finalToolNames, finalFinishReason, inputChars);
    }

    /// <summary>
    /// 每次模型请求前：结算上一轮停滞、执行上下文闸门/锚点压缩，并按 load_tools 进度刷新工具声明。
    /// MAF 在最后一轮会主动移除 tools（options.Tools == null），这里必须尊重，否则无工具收尾会失效。
    /// </summary>
    private async Task<(List<ChatMessage> Messages, AiChatOptions Options)> PrepareAsync(
        IEnumerable<ChatMessage> messages,
        AiChatOptions? options,
        CancellationToken cancellationToken)
    {
        var list = messages.ToList();
        var preparedOptions = (options ?? new AiChatOptions()).Clone();
        var mafRemovedTools = options is not null && options.Tools is null;

        if (_state.CurrentIterationToolCalls > 0)
        {
            _state.StalledIterations = _state.CurrentIterationExecutableCalls == 0
                ? _state.StalledIterations + 1
                : 0;
        }
        _state.CurrentIterationToolCalls = 0;
        _state.CurrentIterationExecutableCalls = 0;
        _state.ToolCallsThisIteration = 0;
        _state.SegmentModelRequests++;

        if (_state.StalledIterations >= 2 && !_state.IsStalled)
        {
            _state.IsStalled = true;
            _state.Result.Stalled = true;
            if (!_state.StalledNoticeEmitted)
            {
                _state.StalledNoticeEmitted = true;
                await _state.Sink.OnEventAsync(new
                {
                    type = "notice",
                    kind = "agent_stalled",
                    text = _localizer.T("agent.stalledNotice"),
                });
            }
        }

        var totalChars = ChatMessageMetrics.CountChars(list);
        if (!_state.ContextFull && _state.AnchorChars > 0 && totalChars > _state.AnchorChars)
        {
            if (await CompressMessagesAsync(list, cancellationToken))
            {
                totalChars = ChatMessageMetrics.CountChars(list);
                if (!_state.AnchorNoticeEmitted)
                {
                    _state.AnchorNoticeEmitted = true;
                    await _state.Sink.OnEventAsync(new
                    {
                        type = "notice",
                        kind = "context_anchor",
                        text = _localizer.T("agent.contextAnchorNotice"),
                    });
                }
            }
        }

        if (!_state.ContextFull && _state.HardCapChars > 0 && totalChars > _state.HardCapChars)
        {
            _state.ContextFull = true;
            _state.Result.ContextFull = true;
            if (!_state.ContextFullNoticeEmitted)
            {
                _state.ContextFullNoticeEmitted = true;
                await _state.Sink.OnEventAsync(new
                {
                    type = "notice",
                    kind = "context_full",
                    text = _localizer.T("agent.contextFullNotice"),
                });
            }
        }

        var forceNoTools = _state.ContextFull || _state.IsStalled || mafRemovedTools;
        if (!forceNoTools)
        {
            if (_state.Request.EnableTools)
            {
                var declared = _state.GetDeclaredFunctions().Cast<AITool>().ToList();
                var extra = (options?.Tools ?? [])
                    .Where(tool => !_state.Functions.ContainsKey(tool.Name))
                    .ToList();
                preparedOptions.Tools = declared.Concat(extra).ToList();
            }
            else
            {
                preparedOptions.Tools = [];
            }
        }
        else
        {
            preparedOptions.Tools = null;
            preparedOptions.ToolMode = null;
        }

        return (list, preparedOptions);
    }

    private async Task<bool> CompressMessagesAsync(List<ChatMessage> messages, CancellationToken cancellationToken)
    {
        var changed = false;
        for (var i = 0; i < messages.Count; i++)
        {
            var message = messages[i];
            List<AIContent>? replaced = null;
            foreach (var content in message.Contents)
            {
                if (content is not TextContent text || text.Text.Length < MinCompressChars) continue;
                var compressed = await _compression.PrepareForContextAsync(text.Text, cancellationToken);
                if (compressed == text.Text) continue;

                replaced ??= new List<AIContent>(message.Contents);
                var index = replaced.IndexOf(content);
                if (index >= 0) replaced[index] = new TextContent(compressed);
                changed = true;
            }

            if (replaced is not null)
            {
                messages[i] = new ChatMessage(message.Role, replaced)
                {
                    AuthorName = message.AuthorName,
                    MessageId = message.MessageId,
                    AdditionalProperties = message.AdditionalProperties,
                };
            }
        }
        return changed;
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
                    AppendChunks(parser.Parse(text.Text), normalized, content, thinking, toolNames);
                    break;
                case TextReasoningContent reasoning:
                    normalized ??= [];
                    thinking.Append(reasoning.Text);
                    normalized.Add(reasoning);
                    break;
                case FunctionCallContent call:
                    normalized ??= [];
                    if (!toolNames.Contains(call.Name, StringComparer.Ordinal))
                        toolNames.Add(call.Name);
                    normalized.Add(item);
                    break;
                case UsageContent usageContent:
                    normalized ??= [];
                    usage = MergeUsage(usage, usageContent.Details);
                    normalized.Add(item);
                    break;
                default:
                    normalized ??= [];
                    normalized.Add(item);
                    break;
            }
        }
        return normalized;
    }

    private static void AppendChunks(
        IReadOnlyList<LlmStreamChunk> chunks,
        List<AIContent> normalized,
        StringBuilder content,
        StringBuilder thinking,
        List<string> toolNames)
    {
        foreach (var chunk in chunks)
        {
            switch (chunk.Type)
            {
                case LlmStreamEventType.Thinking:
                    if (chunk.Text.Length == 0) continue;
                    thinking.Append(chunk.Text);
                    normalized.Add(new TextReasoningContent(chunk.Text));
                    break;
                case LlmStreamEventType.Content:
                    if (chunk.Text.Length == 0) continue;
                    content.Append(chunk.Text);
                    normalized.Add(new TextContent(chunk.Text));
                    break;
                case LlmStreamEventType.ToolCalls:
                    foreach (var call in chunk.ToolCalls ?? [])
                    {
                        normalized.Add(new FunctionCallContent(call.Id, call.Name, ParseArguments(call.Arguments)));
                        if (!toolNames.Contains(call.Name, StringComparer.Ordinal))
                            toolNames.Add(call.Name);
                    }
                    break;
            }
        }
    }

    private static Dictionary<string, object?> ParseArguments(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, object?>>(json)
                   ?? new Dictionary<string, object?>();
        }
        catch (JsonException)
        {
            return new Dictionary<string, object?>();
        }
    }

    private async Task RecordUsageAsync(
        UsageDetails? usageDetails,
        long elapsedMs,
        string content,
        string thinking,
        IReadOnlyList<string> toolNames,
        string? finishReason,
        int inputChars)
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
        var inputEstimate = LlmTokenEstimator.EstimateChars(inputChars);
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
                Math.Max(0, _state.SegmentModelRequests - 1),
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

    private async Task DelayBeforeRetryAsync(int attempt, Exception? error, CancellationToken cancellationToken)
    {
        var delay = Math.Max(0, _state.Request.ProviderRetryDelayMs) * (attempt + 1);
        if (delay > 0) await Task.Delay(delay, cancellationToken);
        if (error != null)
            _logger.LogWarning(error, "[Agent] Provider 请求失败，第 {Attempt} 次重试", attempt + 1);
    }

    private static bool IsTransient(Exception ex)
        => ex is HttpRequestException or IOException or TimeoutException
           or AnthropicRateLimitException
           or Anthropic5xxException
           or AnthropicIOException
           or AnthropicServiceException
           or AnthropicUnexpectedStatusCodeException
           || ex.GetType().FullName == "System.ClientModel.ClientResultException"
           && IsTransientClientResult(ex);

    private static bool IsTransientClientResult(Exception ex)
    {
        var status = ex.GetType().GetProperty("Status")?.GetValue(ex);
        return status is int code && (code == 408 || code == 429 || code >= 500);
    }
}