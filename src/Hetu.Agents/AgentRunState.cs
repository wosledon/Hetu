using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Core.Services.Tools;
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
        TurnPreview = request.Messages.LastOrDefault(m => m.Role == ChatRole.User)?.Text;
        MaxToolCallsPerTurn = request.MaxToolCallsPerTurn > 0 ? request.MaxToolCallsPerTurn : 5;
    }

    public AgentLoopRequest Request { get; }
    public IAgentLoopSink Sink { get; }
    public IAgentLoopHooks? Hooks { get; }
    public AgentLoopResult Result { get; }
    public List<ChatMessage> ChatMessages { get; set; } = [];
    public List<SessionTodo> SessionTodos { get; set; }
    public Guid TurnId { get; }
    public string? TurnPreview { get; }

    public Dictionary<string, AIFunction> Functions { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, string> ApprovalToolNames { get; } = new(StringComparer.Ordinal);
    public Dictionary<string, string> ToolCallArguments { get; } = new(StringComparer.Ordinal);
    public Dictionary<string, WorkToolDecision> PendingToolDecisions { get; } = new(StringComparer.Ordinal);
    public HashSet<string> RecordedToolCallIds { get; } = new(StringComparer.Ordinal);
    public List<string> CoreToolNames { get; set; } = [];
    public List<string> LoadableToolNames { get; set; } = [];
    public List<string> LoadedToolNames { get; } = [];

    public int IterationCount { get; set; }
    public int SegmentModelRequests { get; set; }
    public int ToolCallsThisIteration { get; set; }
    public int MaxToolCallsPerTurn { get; } = 5;
    public int CurrentIterationToolCalls { get; set; }
    public int CurrentIterationExecutableCalls { get; set; }
    public int SegmentToolCallCount { get; set; }
    public int StalledIterations { get; set; }
    public bool IsStalled { get; set; }
    public bool ContextFull { get; set; }
    public bool SegmentProgress { get; set; }
    public int ContextWindowTokens { get; set; } = 128_000;
    public long HardCapChars { get; set; }
    public long AnchorChars { get; set; }
    public bool ContextFullNoticeEmitted { get; set; }
    public bool StalledNoticeEmitted { get; set; }
    public bool AnchorNoticeEmitted { get; set; }
    public Dictionary<string, string> ReadResultCache { get; } = new(StringComparer.Ordinal);
    public Dictionary<string, int> FailureCounts { get; } = new(StringComparer.Ordinal);

    public void BeginSegment()
    {
        SegmentModelRequests = 0;
        ToolCallsThisIteration = 0;
        CurrentIterationToolCalls = 0;
        CurrentIterationExecutableCalls = 0;
        SegmentToolCallCount = 0;
        StalledIterations = 0;
        IsStalled = false;
        ContextFull = false;
        SegmentProgress = false;
        ContextFullNoticeEmitted = false;
        StalledNoticeEmitted = false;
        AnchorNoticeEmitted = false;
    }

    public void ResolveContextLimits(int? contextWindowTokens)
    {
        if (contextWindowTokens is > 0) ContextWindowTokens = contextWindowTokens.Value;
        var chars = (long)ContextWindowTokens * LlmTokenEstimator.CharsPerToken;
        HardCapChars = chars * 80 / 100;
        AnchorChars = chars * 40 / 100;
    }

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
        SegmentToolCallCount++;
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
        var cacheCreation = 0;
        if (details.AdditionalCounts is { } counts)
        {
            foreach (var key in CacheCreationKeys)
            {
                if (counts.TryGetValue(key, out var value) && value > 0)
                {
                    cacheCreation = (int)value;
                    break;
                }
            }
        }
        return new LlmUsage
        {
            PromptTokens = prompt,
            CompletionTokens = completion,
            TotalTokens = prompt + completion,
            CachedTokens = cached,
            CacheCreationTokens = cacheCreation,
        };
    }

    private static readonly string[] CacheCreationKeys =
    [
        "cache_creation_input_tokens",
        "cache_creation_tokens",
        "CacheCreationInputTokens",
    ];

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