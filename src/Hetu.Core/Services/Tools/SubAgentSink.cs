using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Core.Utilities;

namespace Hetu.Core.Services.Tools;

/// <summary>子 Agent 内层时间线条目。属性名即对外帧 / 落库格式（kind/text/name/args/result/isError）。</summary>
public sealed class SubAgentTimelineEntry
{
    [System.Text.Json.Serialization.JsonPropertyName("kind")]
    public string Kind { get; set; } = "text";

    [System.Text.Json.Serialization.JsonPropertyName("text")]
    public string Text { get; set; } = string.Empty;

    [System.Text.Json.Serialization.JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [System.Text.Json.Serialization.JsonPropertyName("args")]
    public string Arguments { get; set; } = string.Empty;

    [System.Text.Json.Serialization.JsonPropertyName("result")]
    public string? Result { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("isError")]
    public bool IsError { get; set; }
}

/// <summary>
/// 把共享 Agent 循环的事件翻译成 <c>subagent</c> 帧（start / delta / tool / tool_result / done / error），
/// 同时维护内层时间线与步数，供界面实时展示与终态落库回放。
/// </summary>
public sealed class SubAgentSink : IAgentLoopSink
{
    /// <summary>内层时间线的字符预算：超出后不再追加，但仍继续推送增量帧</summary>
    private const int EntriesBudget = 24_000;

    private const int ToolArgumentChars = 600;
    private const int ToolResultChars = 6_000;

    private readonly Func<object, Task> _emit;
    private readonly string _id;
    private readonly string _description;
    private readonly List<SubAgentTimelineEntry> _entries = [];
    private readonly Dictionary<string, SubAgentTimelineEntry> _pendingTools = new(StringComparer.Ordinal);
    private int _budget = EntriesBudget;

    public SubAgentSink(Func<object, Task> emit, string id, string description)
    {
        _emit = emit;
        _id = id;
        _description = description;
    }

    /// <summary>已执行的工具调用次数</summary>
    public int Steps { get; private set; }

    public IReadOnlyList<SubAgentTimelineEntry> Entries => _entries;

    public Task OnContentAsync(string text) => AppendTextAsync("text", text);

    public Task OnThinkingAsync(string text) => AppendTextAsync("thinking", text);

    public async Task OnEventAsync(object payload)
    {
        var json = JsonSerializer.SerializeToElement(payload, JsonDefaults.CamelCase);
        if (json.ValueKind != JsonValueKind.Object
            || !json.TryGetProperty("type", out var typeEl)
            || typeEl.ValueKind != JsonValueKind.String)
            return;

        // 交互型工具在子 Agent 白名单外，且 hidden 帧本就不该出现在内层时间线里
        if (json.TryGetProperty("hidden", out var hiddenEl) && hiddenEl.ValueKind == JsonValueKind.True) return;

        switch (typeEl.GetString())
        {
            case "tool_call":
                await EmitToolCallAsync(json);
                break;
            case "tool_result":
                await EmitToolResultAsync(json);
                break;
        }
    }

    /// <summary>终态：done 帧携带完整内层时间线与步数</summary>
    public Task EmitDoneAsync() => _emit(new
    {
        type = "subagent",
        stage = "done",
        id = _id,
        description = _description,
        steps = Steps,
        entries = _entries,
    });

    public Task EmitErrorAsync(string message) => _emit(new
    {
        type = "subagent",
        stage = "error",
        id = _id,
        description = _description,
        message,
    });

    private async Task EmitToolCallAsync(JsonElement json)
    {
        var id = GetString(json, "id") ?? string.Empty;
        var name = GetString(json, "name") ?? string.Empty;
        var arguments = Truncate(GetString(json, "arguments") ?? "{}", ToolArgumentChars);

        Steps++;
        var entry = new SubAgentTimelineEntry { Kind = "tool", Name = name, Arguments = arguments };
        _entries.Add(entry);
        if (id.Length > 0) _pendingTools[id] = entry;

        await _emit(new
        {
            type = "subagent",
            stage = "tool",
            id = _id,
            description = _description,
            tool = name,
            arguments,
            state = "running",
        });
    }

    private async Task EmitToolResultAsync(JsonElement json)
    {
        var id = GetString(json, "id") ?? string.Empty;
        var name = GetString(json, "name") ?? string.Empty;
        var content = Truncate(GetString(json, "content") ?? string.Empty, ToolResultChars);
        var isError = json.TryGetProperty("isError", out var errorEl) && errorEl.ValueKind == JsonValueKind.True;

        if (id.Length > 0 && _pendingTools.Remove(id, out var entry))
        {
            entry.Result = content;
            entry.IsError = isError;
        }
        else
        {
            // 没有 id（或已被清理）时按名称回填最近的未完成调用：子 Agent 内层是串行执行
            for (var i = _entries.Count - 1; i >= 0; i--)
            {
                var candidate = _entries[i];
                if (candidate.Kind != "tool" || candidate.Result != null) continue;
                if (!string.Equals(candidate.Name, name, StringComparison.Ordinal)) continue;
                candidate.Result = content;
                candidate.IsError = isError;
                break;
            }
        }

        await _emit(new
        {
            type = "subagent",
            stage = "tool_result",
            id = _id,
            tool = name,
            result = content,
            isError,
        });
    }

    private async Task AppendTextAsync(string kind, string text)
    {
        if (string.IsNullOrEmpty(text)) return;

        if (_budget > 0)
        {
            var slice = text.Length <= _budget ? text : text[.._budget];
            _budget -= slice.Length;
            var last = _entries.Count > 0 ? _entries[^1] : null;
            if (last != null && last.Kind == kind && last.Name.Length == 0) last.Text += slice;
            else _entries.Add(new SubAgentTimelineEntry { Kind = kind, Text = slice });
        }

        await _emit(new { type = "subagent", stage = "delta", id = _id, kind, text });
    }

    private static string? GetString(JsonElement json, string name)
        => json.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static string Truncate(string text, int max)
        => text.Length <= max ? text : text[..max] + "…";
}
