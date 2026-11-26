using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Core.Streaming;
using Hetu.Core.Utilities;
using Microsoft.Extensions.AI;
using HetuChatOptions = Hetu.Core.Interfaces.ChatOptions;
using MafChatOptions = Microsoft.Extensions.AI.ChatOptions;

namespace Hetu.Core.Services.AgentFramework;

internal sealed class LlmProviderChatClient : IChatClient
{
    private readonly ILLMProvider _provider;
    private readonly int _maxRetries;
    private readonly int _retryDelayMs;
    private readonly Func<LlmUsage?, long, string?, string, int, int, Task>? _onRequestCompleted;

    public LlmProviderChatClient(
        ILLMProvider provider,
        int maxRetries,
        int retryDelayMs,
        Func<LlmUsage?, long, string?, string, int, int, Task>? onRequestCompleted)
    {
        _provider = provider;
        _maxRetries = Math.Max(0, maxRetries);
        _retryDelayMs = Math.Max(0, retryDelayMs);
        _onRequestCompleted = onRequestCompleted;
    }

    public async Task<ChatResponse> GetResponseAsync(
        IEnumerable<ChatMessage> messages,
        MafChatOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        var (llmMessages, llmOptions) = ConvertRequest(messages, options);
        var clock = Stopwatch.StartNew();
        var response = await _provider.ChatWithUsageAsync(llmMessages, llmOptions, cancellationToken);
        clock.Stop();
        if (_onRequestCompleted != null)
        {
            await _onRequestCompleted(
                response.Usage,
                clock.ElapsedMilliseconds,
                null,
                response.Content,
                0,
                LlmTokenEstimator.EstimateRequestTokens(llmMessages, llmOptions.SystemPrompt, llmOptions.Tools));
        }
        return new ChatResponse(new ChatMessage(ChatRole.Assistant, response.Content));
    }

    public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages,
        MafChatOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var (llmMessages, llmOptions) = ConvertRequest(messages, options);
        var inputEstimate = LlmTokenEstimator.EstimateRequestTokens(llmMessages, llmOptions.SystemPrompt, llmOptions.Tools);
        var emptyRetryUsed = false;

        for (var attempt = 0; ; attempt++)
        {
            var attemptState = new RequestAttemptState();
            var retry = false;
            await using var enumerator = StreamOnceAsync(llmMessages, llmOptions, attemptState, cancellationToken)
                .GetAsyncEnumerator(cancellationToken);
            while (true)
            {
                bool moved;
                try
                {
                    moved = await enumerator.MoveNextAsync();
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    await CompleteRequestAsync(attemptState, inputEstimate);
                    throw;
                }
                catch (Exception ex) when (attempt < _maxRetries && IsTransient(ex) && !attemptState.Emitted)
                {
                    await DelayBeforeRetryAsync(attempt, ex, cancellationToken);
                    retry = true;
                    break;
                }
                if (!moved) break;
                yield return enumerator.Current;
            }
            if (retry) continue;

            await CompleteRequestAsync(attemptState, inputEstimate);
            var emptyTurn = !attemptState.Emitted && attemptState.FinishReason is not ("length" or "max_tokens" or "invalid_tool_call");
            if (!emptyRetryUsed && emptyTurn && attempt < _maxRetries)
            {
                emptyRetryUsed = true;
                await DelayBeforeRetryAsync(attempt, null, cancellationToken);
                continue;
            }

            yield break;
        }
    }

    private async IAsyncEnumerable<ChatResponseUpdate> StreamOnceAsync(
        List<LlmChatMessage> messages,
        HetuChatOptions options,
        RequestAttemptState state,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var parser = new LlmStreamParser();
        var messageId = Guid.NewGuid().ToString("N");
        await foreach (var delta in _provider.ChatStreamAsync(messages, options, cancellationToken))
        {
            foreach (var chunk in parser.Parse(delta))
            {
                switch (chunk.Type)
                {
                    case LlmStreamEventType.Content:
                        state.Content.Append(chunk.Text);
                        state.Emitted = true;
                        yield return new ChatResponseUpdate(ChatRole.Assistant, chunk.Text) { MessageId = messageId };
                        break;
                    case LlmStreamEventType.Thinking:
                        state.Thinking.Append(chunk.Text);
                        state.Emitted = true;
                        yield return new ChatResponseUpdate(ChatRole.Assistant, [new TextReasoningContent(chunk.Text)]) { MessageId = messageId };
                        break;
                    case LlmStreamEventType.ThinkingBlock:
                        if (chunk.ThinkingBlock is { Signature: not null } block)
                        {
                            yield return new ChatResponseUpdate(ChatRole.Assistant,
                                [new TextReasoningContent(string.Empty) { ProtectedData = block.Signature }]) { MessageId = messageId };
                        }
                        break;
                    case LlmStreamEventType.ToolCalls:
                        if (chunk.ToolCalls is not { Count: > 0 }) continue;
                        state.ToolCalls.AddRange(chunk.ToolCalls);
                        state.Emitted = true;
                        break;
                    case LlmStreamEventType.Usage:
                        state.Usage = chunk.Usage;
                        break;
                    case LlmStreamEventType.Finish:
                        if (state.FinishReason is not ("invalid_tool_call" or "length" or "max_tokens"))
                            state.FinishReason = chunk.Reason;
                        break;
                }
            }
        }

        foreach (var chunk in parser.Flush())
        {
            if (chunk.Type == LlmStreamEventType.Thinking)
            {
                state.Thinking.Append(chunk.Text);
                state.Emitted = true;
                yield return new ChatResponseUpdate(ChatRole.Assistant, [new TextReasoningContent(chunk.Text)]) { MessageId = messageId };
            }
            else
            {
                state.Content.Append(chunk.Text);
                state.Emitted = true;
                yield return new ChatResponseUpdate(ChatRole.Assistant, chunk.Text) { MessageId = messageId };
            }
        }

        if (state.ToolCalls.Count > 0 && state.FinishReason is not ("length" or "max_tokens" or "invalid_tool_call"))
        {
            var calls = state.ToolCalls.Select(call => new FunctionCallContent(
                call.Id,
                call.Name,
                JsonSerializer.Deserialize<Dictionary<string, object?>>(call.Arguments)
                ?? new Dictionary<string, object?>())).Cast<AIContent>().ToList();
            yield return new ChatResponseUpdate(ChatRole.Assistant, calls);
        }
    }

    private async Task CompleteRequestAsync(RequestAttemptState state, int inputEstimate)
    {
        if (_onRequestCompleted == null) return;
        var preview = state.ToolCalls.Count > 0
            ? string.Join("、", state.ToolCalls.Select(tool => tool.Name).Distinct())
            : state.Content.ToString();
        await _onRequestCompleted(state.Usage, state.Elapsed.ElapsedMilliseconds, state.FinishReason, preview, state.ToolCalls.Count, inputEstimate);
    }

    private sealed class RequestAttemptState
    {
        public Stopwatch Elapsed { get; } = Stopwatch.StartNew();
        public StringBuilder Content { get; } = new();
        public StringBuilder Thinking { get; } = new();
        public List<LlmToolCall> ToolCalls { get; } = [];
        public LlmUsage? Usage { get; set; }
        public string? FinishReason { get; set; }
        public bool Emitted { get; set; }
    }

    public object? GetService(Type serviceType, object? serviceKey = null) => null;

    public void Dispose() { }

    private static (List<LlmChatMessage> Messages, HetuChatOptions Options) ConvertRequest(
        IEnumerable<ChatMessage> messages,
        MafChatOptions? options)
    {
        var systemPrompt = options?.Instructions ?? string.Empty;
        var llmMessages = new List<LlmChatMessage>();
        foreach (var message in messages)
        {
            if (message.Role == ChatRole.System)
            {
                systemPrompt = string.Join("\n\n", new[] { systemPrompt, message.Text }
                    .Where(text => !string.IsNullOrWhiteSpace(text)));
                continue;
            }

            var contentParts = message.Contents.OfType<DataContent>()
                .Select(content => new LlmContentPart
                {
                    Type = "image",
                    Text = Convert.ToBase64String(content.Data.Span),
                    MediaType = string.IsNullOrWhiteSpace(content.MediaType) ? "image/png" : content.MediaType,
                })
                .ToList();
            var toolCalls = message.Contents.OfType<FunctionCallContent>()
                .Select(call => new LlmToolCall
                {
                    Id = call.CallId,
                    Name = call.Name,
                    Arguments = JsonSerializer.Serialize(call.Arguments),
                })
                .ToList();
            var thinkingBlocks = message.Contents.OfType<TextReasoningContent>()
                .Select(content => new LlmThinkingBlock
                {
                    Text = content.Text,
                    Signature = content.ProtectedData,
                })
                .ToList();
            var toolResults = message.Contents.OfType<FunctionResultContent>().ToList();
            if (toolResults.Count > 1)
            {
                llmMessages.AddRange(toolResults.Select(result => new LlmChatMessage
                {
                    Role = "tool",
                    Content = ConvertResult(result.Result),
                    ToolCallId = result.CallId,
                }));
                continue;
            }
            var toolResult = toolResults.FirstOrDefault();
            var llmMessage = new LlmChatMessage
            {
                Role = message.Role.Value,
                Content = toolResult != null ? ConvertResult(toolResult.Result) : message.Text,
                ContentParts = contentParts.Count > 0 ? contentParts : null,
                ToolCalls = toolCalls.Count > 0 ? toolCalls : null,
                ThinkingBlocks = thinkingBlocks.Count > 0 ? thinkingBlocks : null,
                ToolCallId = toolResult?.CallId,
            };
            llmMessages.Add(llmMessage);
        }

        var llmOptions = new HetuChatOptions
        {
            ModelId = options?.ModelId ?? string.Empty,
            SystemPrompt = systemPrompt,
            Temperature = options?.AdditionalProperties is { } additional
                          && additional.TryGetValue("Temperature", out var temperature)
                ? temperature as double?
                : options?.Temperature is { } value ? (double?)value : null,
            MaxTokens = options?.MaxOutputTokens,
            ReasoningEffort = options?.Reasoning?.Effort?.ToString().ToLowerInvariant(),
            ReasoningBudgetTokens = options?.AdditionalProperties is { } properties
                                    && properties.TryGetValue("ReasoningBudgetTokens", out var budget)
                                        ? budget as int?
                                        : null,
            Stream = true,
            ToolChoice = options?.Tools is { Count: > 0 } ? "auto" : "none",
            Tools = options?.Tools?.OfType<AIFunction>().Select(tool => new LlmToolDefinition
            {
                Name = tool.Name,
                Description = tool.Description,
                ParametersSchema = tool.JsonSchema,
            }).ToList(),
        };
        return (llmMessages, llmOptions);
    }

    internal static List<ChatMessage> ToChatMessages(IEnumerable<LlmChatMessage> messages)
    {
        var result = new List<ChatMessage>();
        foreach (var message in messages)
        {
            var contents = new List<AIContent>();
            if (!string.IsNullOrWhiteSpace(message.Content))
                contents.Add(new TextContent(message.Content));
            if (message.ContentParts != null)
            {
                foreach (var part in message.ContentParts)
                {
                    if (part.Type != "image" || string.IsNullOrWhiteSpace(part.Text)) continue;
                    contents.Add(new DataContent(Convert.FromBase64String(part.Text),
                        string.IsNullOrWhiteSpace(part.MediaType) ? "image/png" : part.MediaType));
                }
            }
            if (message.ThinkingBlocks != null)
            {
                contents.AddRange(message.ThinkingBlocks.Select(block => new TextReasoningContent(block.Text)
                {
                    ProtectedData = block.Signature,
                }));
            }
            if (message.ToolCalls != null)
            {
                contents.AddRange(message.ToolCalls.Select(call => new FunctionCallContent(
                    call.Id,
                    call.Name,
                    JsonSerializer.Deserialize<Dictionary<string, object?>>(call.Arguments)
                    ?? new Dictionary<string, object?>())));
            }
            if (message.Role == "tool" && !string.IsNullOrWhiteSpace(message.ToolCallId))
                contents.Add(new FunctionResultContent(message.ToolCallId, message.Content));

            var role = message.Role.ToLowerInvariant() switch
            {
                "system" => ChatRole.System,
                "assistant" => ChatRole.Assistant,
                "tool" => ChatRole.Tool,
                _ => ChatRole.User,
            };
            result.Add(new ChatMessage(role, contents));
        }
        return result;
    }

    internal static LlmChatMessage ToLlmMessage(ChatMessage message)
    {
        var toolResult = message.Contents.OfType<FunctionResultContent>().FirstOrDefault();
        var contentParts = message.Contents.OfType<DataContent>()
            .Select(content => new LlmContentPart
            {
                Type = "image",
                Text = Convert.ToBase64String(content.Data.Span),
                MediaType = string.IsNullOrWhiteSpace(content.MediaType) ? "image/png" : content.MediaType,
            })
            .ToList();
        var toolCalls = message.Contents.OfType<FunctionCallContent>()
            .Select(call => new LlmToolCall
            {
                Id = call.CallId,
                Name = call.Name,
                Arguments = JsonSerializer.Serialize(call.Arguments),
            })
            .ToList();
        var thinkingBlocks = message.Contents.OfType<TextReasoningContent>()
            .Select(content => new LlmThinkingBlock
            {
                Text = content.Text,
                Signature = content.ProtectedData,
            })
            .ToList();
        return new LlmChatMessage
        {
            Role = message.Role.Value,
            Content = toolResult != null ? ConvertResult(toolResult.Result) : message.Text,
            ContentParts = contentParts.Count > 0 ? contentParts : null,
            ToolCalls = toolCalls.Count > 0 ? toolCalls : null,
            ThinkingBlocks = thinkingBlocks.Count > 0 ? thinkingBlocks : null,
            ToolCallId = toolResult?.CallId,
        };
    }

    private static string ConvertResult(object? result) => result switch
    {
        null => string.Empty,
        string text => text,
        _ => JsonSerializer.Serialize(result),
    };

    private static bool IsTransient(Exception ex)
        => ex is HttpRequestException or IOException or System.Net.Sockets.SocketException or TimeoutException;

    private async Task DelayBeforeRetryAsync(int attempt, Exception? error, CancellationToken cancellationToken)
    {
        var delay = _retryDelayMs * (attempt + 1);
        if (delay > 0) await Task.Delay(TimeSpan.FromMilliseconds(delay), cancellationToken);
    }
}
