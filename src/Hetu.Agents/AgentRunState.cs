using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Microsoft.Extensions.AI;

namespace Hetu.Agents;

/// <summary>单次 Agent 运行的可变状态；生命周期与一次 <see cref="IAgentRunner.RunAsync"/> 相同。</summary>
internal sealed class AgentRunState
{
    public AgentRunState(AgentLoopRequest request)
    {
        Request = request;
        Sink = request.Sink ?? new NullAgentLoopSink();
        Hooks = request.Hooks;
        Result = new AgentLoopResult();
        SessionTodos = [];
        TurnId = Guid.NewGuid();
        TurnPreview = request.Messages.LastOrDefault(m => m.Role == "user")?.Content;
        MaxToolCallsPerTurn = request.MaxToolCallsPerTurn > 0 ? request.MaxToolCallsPerTurn : 5;
    }

    public AgentLoopRequest Request { get; }
    public IAgentLoopSink Sink { get; }
    public IAgentLoopHooks? Hooks { get; }
    public AgentLoopResult Result { get; }
    public List<LlmChatMessage> ChatMessages { get; set; } = [];
    public List<SessionTodo> SessionTodos { get; set; }
    public Guid TurnId { get; }
    public string? TurnPreview { get; }

    public Dictionary<string, AIFunction> Functions { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, string> ApprovalToolNames { get; } = new(StringComparer.Ordinal);
    public HashSet<string> RecordedToolCallIds { get; } = new(StringComparer.Ordinal);
    public List<string> CoreToolNames { get; set; } = [];
    public List<string> LoadableToolNames { get; set; } = [];
    public List<string> LoadedToolNames { get; } = [];

    public int IterationCount { get; set; }
    public int ToolCallsThisIteration { get; set; }
    public int MaxToolCallsPerTurn { get; } = 5;
    public bool Cancelled { get; set; }

    public IReadOnlyList<AIFunction> GetDeclaredFunctions()
    {
        var names = CoreToolNames.Concat(LoadedToolNames).Distinct(StringComparer.OrdinalIgnoreCase);
        return names.Where(Functions.ContainsKey).Select(name => Functions[name]).ToList();
    }

    public async Task AppendTextAsync(string text)
    {
        if (text.Length == 0) return;
        Result.Content += text;
        AppendSegment("text", text);
        await Sink.OnContentAsync(text);
    }

    public async Task AppendThinkingAsync(string text)
    {
        if (text.Length == 0) return;
        Result.Thinking += text;
        AppendSegment("thought", text);
        await Sink.OnThinkingAsync(text);
    }

    private void AppendSegment(string kind, string content)
    {
        if (Result.Timeline.Count > 0 && Result.Timeline[^1].Kind == kind)
        {
            Result.Timeline[^1].Content += content;
            return;
        }
        Result.Timeline.Add(new AgentTimelineSegment { Kind = kind, Content = content });
    }

    public void AppendToolCall(AgentToolCallRecord record)
    {
        RecordedToolCallIds.Add(record.Id);
        Result.ToolCalls.Add(record);
        Result.Timeline.Add(new AgentTimelineSegment
        {
            Kind = "tool",
            Name = record.Name,
            Arguments = record.Arguments,
            Result = record.Result,
            IsError = record.IsError,
        });
    }

    public void AccumulateUsage(LlmUsage usage)
    {
        Result.Usage.PromptTokens += usage.PromptTokens;
        Result.Usage.CompletionTokens += usage.CompletionTokens;
        Result.Usage.TotalTokens += usage.TotalTokens;
        Result.Usage.CachedTokens += usage.CachedTokens;
        Result.Usage.CacheCreationTokens += usage.CacheCreationTokens;
    }

    public static LlmUsage ToUsage(UsageDetails? details)
    {
        if (details == null) return new LlmUsage();
        var prompt = (int)(details.InputTokenCount ?? 0);
        var completion = (int)(details.OutputTokenCount ?? 0);
        var cached = (int)(details.CachedInputTokenCount ?? 0);
        // Anthropic 的 InputTokenCount 通常不含缓存命中部分，这里补回完整 Prompt 口径。
        if (cached > 0 && prompt < cached) prompt += cached;
        return new LlmUsage
        {
            PromptTokens = prompt,
            CompletionTokens = completion,
            TotalTokens = prompt + completion,
            CachedTokens = cached,
        };
    }

    public void ParseLoadedToolNames(string argumentsJson)
    {
        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(argumentsJson) ? "{}" : argumentsJson);
            if (doc.RootElement.TryGetProperty("names", out var array) && array.ValueKind == JsonValueKind.Array)
            {
                foreach (var element in array.EnumerateArray())
                {
                    var name = element.GetString();
                    AddLoadedTool(name);
                }
            }
            else if (doc.RootElement.TryGetProperty("name", out var single) && single.ValueKind == JsonValueKind.String)
            {
                AddLoadedTool(single.GetString());
            }
        }
        catch (JsonException)
        {
        }
    }

    private void AddLoadedTool(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return;
        if (LoadableToolNames.Contains(name, StringComparer.OrdinalIgnoreCase)
            && !LoadedToolNames.Contains(name, StringComparer.OrdinalIgnoreCase))
            LoadedToolNames.Add(name);
    }

    private sealed class NullAgentLoopSink : IAgentLoopSink
    {
    }
}