using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;

namespace Hetu.Core.Services;

/// <summary>
/// 工具注册表，管理所有可用的工具执行器。
/// 内置工具通过 DI 注入；作用域结束后随实例一起释放。
/// </summary>
public class ToolRegistry
{
    private static readonly JsonSerializerOptions UnescapedJson = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private readonly Dictionary<string, IToolExecutor> _executors = new(StringComparer.OrdinalIgnoreCase);
    private readonly ILocalizer _localizer;

    public ToolRegistry(IEnumerable<IToolExecutor> executors, ILocalizer localizer)
    {
        _localizer = localizer;
        foreach (var executor in executors)
        {
            _executors[executor.Name] = executor;
        }
    }

    /// <summary>按当前界面语言取工具描述（缺失回退工具类里的中文原文）</summary>
    public string Describe(IToolExecutor executor)
        => ToolText.Describe(_localizer, executor.Name, executor.Description);

    /// <summary>按当前界面语言取工具使用指引（缺失回退中文原文）</summary>
    public string? Guideline(IToolExecutor executor)
        => ToolText.Guideline(_localizer, executor.Name, executor.UsageGuideline);

    /// <summary>
    /// 参数 schema 里的参数说明（"description"）按 toolParam.&lt;工具名&gt;.&lt;参数路径&gt; 查表替换，
    /// 嵌套项用点路径（如 questions.options.label）；查不到就保留代码里写的中文，解析失败时原样返回。
    /// </summary>
    public string? LocalizeParameters(string toolName, string? schemaJson)
    {
        if (string.IsNullOrWhiteSpace(schemaJson)) return schemaJson;
        try
        {
            var node = JsonNode.Parse(schemaJson);
            if (node == null) return schemaJson;
            var changed = LocalizeNode(node, toolName, null);
            return changed ? node.ToJsonString(UnescapedJson) : schemaJson;
        }
        catch (JsonException)
        {
            return schemaJson;
        }
    }

    /// <summary>递归替换 properties 下的 description；返回是否有改动</summary>
    private bool LocalizeNode(JsonNode node, string toolName, string? path)
    {
        if (node is not JsonObject obj) return false;
        var changed = false;
        if (obj["properties"] is JsonObject properties)
        {
            foreach (var (parameter, value) in properties)
            {
                var childPath = path == null ? $"toolParam.{toolName}.{parameter}" : $"{path}.{parameter}";
                if (value is JsonObject parameterObject)
                {
                    var text = _localizer.Get(childPath);
                    if (text != null)
                    {
                        parameterObject["description"] = text;
                        changed = true;
                    }
                }
                if (value != null && LocalizeNode(value, toolName, childPath)) changed = true;
            }
        }
        // 数组项（如 plan.steps / ask_question.questions 的 items）沿用同一层路径
        if (obj["items"] is JsonObject items && LocalizeNode(items, toolName, path)) changed = true;
        return changed;
    }

    /// <summary>获取所有已注册的工具</summary>
    public IReadOnlyList<IToolExecutor> GetAll()
        => _executors.Values.ToList();

    /// <summary>按名称获取工具执行器</summary>
    public IToolExecutor? GetExecutor(string name)
        => _executors.TryGetValue(name, out var executor) ? executor : null;

    /// <summary>
    /// 按工具名列表过滤（用于 Agent 绑定）。
    /// 显式传 null 才表示“绑定全部工具”；传空列表表示“不绑定任何工具”，避免调用方漏传时意外放开全部工具。
    /// </summary>
    public IReadOnlyList<IToolExecutor> GetByNames(IReadOnlyList<string>? names)
    {
        if (names is null) return GetAll();
        if (names.Count == 0) return [];

        var result = new List<IToolExecutor>(names.Count);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var name in names)
        {
            if (string.IsNullOrWhiteSpace(name) || !seen.Add(name)) continue;
            var executor = GetExecutor(name);
            if (executor != null) result.Add(executor);
        }
        return result;
    }

    /// <summary>
    /// 估算给定工具 schema 下发给模型时的字符数（名称 + 描述 + 本地化参数 schema）。
    /// 只用于没有真实 usage 时的请求规模兜底，不再为了估算构造第二份工具定义对象。
    /// </summary>
    public int EstimateSchemaChars(IReadOnlyList<string>? toolNames)
    {
        var chars = 0;
        foreach (var executor in GetByNames(toolNames))
        {
            chars += executor.Name.Length + ComposeDescription(executor).Length;
            chars += CompactJsonChars(LocalizeParameters(executor.Name, executor.ParametersSchema.GetRawText()));
        }
        return chars;
    }

    private static int CompactJsonChars(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return 0;
        try
        {
            using var document = JsonDocument.Parse(json);
            return JsonSerializer.Serialize(document.RootElement, UnescapedJson).Length;
        }
        catch (JsonException)
        {
            return json.Length;
        }
    }

    private string ComposeDescription(IToolExecutor executor)
    {
        var description = Describe(executor);
        var guideline = Guideline(executor);
        if (string.IsNullOrWhiteSpace(guideline)) return description;
        return $"{description}｜{guideline}";
    }
}

