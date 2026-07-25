using System.Text;
using System.Text.RegularExpressions;
using Hetu.Core.Interfaces;
using Hetu.Shared.Settings;
using Microsoft.Extensions.Logging;

namespace Hetu.Core.Services;

/// <summary>
/// 压缩管道服务。按配置顺序执行多个压缩节点，支持算法压缩和 LLM 压缩。
/// </summary>
public class CompressionPipelineService
{
    private readonly IAppSettingService _appSettingService;
    private readonly ILLMProviderFactory? _llmProviderFactory;
    private readonly ILogger<CompressionPipelineService> _logger;

    public CompressionPipelineService(
        IAppSettingService appSettingService,
        ILogger<CompressionPipelineService> logger,
        ILLMProviderFactory? llmProviderFactory = null)
    {
        _appSettingService = appSettingService;
        _logger = logger;
        _llmProviderFactory = llmProviderFactory;
    }

    /// <summary>获取当前压缩配置</summary>
    public async Task<CompressionPipelineDto> GetConfigAsync(CancellationToken ct = default)
    {
        var setting = await _appSettingService.GetAsync("CompressionConfig", ct);
        if (setting?.Data == null || string.IsNullOrWhiteSpace(setting.Data.Value))
            return CompressionDefaults.GetDefault();

        try
        {
            return System.Text.Json.JsonSerializer.Deserialize<CompressionPipelineDto>(setting.Data.Value)
                ?? CompressionDefaults.GetDefault();
        }
        catch
        {
            return CompressionDefaults.GetDefault();
        }
    }

    /// <summary>保存压缩配置</summary>
    public async Task SaveConfigAsync(CompressionPipelineDto config, CancellationToken ct = default)
    {
        var json = System.Text.Json.JsonSerializer.Serialize(config);
        await _appSettingService.SetAsync(new UpdateAppSettingRequest
        {
            Key = "CompressionConfig",
            Value = json
        }, ct);
    }

    /// <summary>执行压缩</summary>
    public async Task<string> CompressAsync(string input, CancellationToken ct = default)
    {
        var config = await GetConfigAsync(ct);
        if (string.IsNullOrWhiteSpace(input)) return input;

        // 总开关关闭或无任何节点启用则跳过
        if (!config.Enabled) return input;
        var enabledNodes = config.Nodes.Where(n => n.Enabled).ToList();
        if (enabledNodes.Count == 0) return input;

        var result = input;

        foreach (var node in config.Nodes.OrderBy(n => n.Order))
        {
            if (!node.Enabled) continue;

            if (node.Key == "llm_summary")
            {
                if (config.Mode is "llm" or "hybrid" && _llmProviderFactory != null)
                {
                    result = await LlmCompressAsync(result, config, ct);
                }
                continue;
            }

            result = node.Key switch
            {
                "dedup" => Deduplicate(result),
                "whitespace" => CompressWhitespace(result),
                "number_normalize" => NormalizeNumbers(result),
                "log_dedup" => DeduplicateLogs(result),
                "stopwords" => RemoveStopWords(result),
                _ => result
            };
        }

        _logger.LogDebug("[Compression] input={InputLen} output={OutputLen} ratio={Ratio:F1}%",
            input.Length, result.Length, input.Length > 0 ? result.Length * 100.0 / input.Length : 0);

        return result;
    }

    private async Task<string> LlmCompressAsync(string input, CompressionPipelineDto config, CancellationToken ct)
    {
        if (_llmProviderFactory == null) return input;

        ILLMProvider? provider;
        if (!string.IsNullOrWhiteSpace(config.LlmModelId) && Guid.TryParse(config.LlmModelId, out var modelId))
        {
            provider = await _llmProviderFactory.CreateProviderAsync(modelId, ct);
        }
        else
        {
            provider = await _llmProviderFactory.CreateChatProviderAsync(ct);
        }

        if (provider == null) return input;

        var prompt = config.LlmSystemPrompt ?? "压缩以下文本，保留所有关键信息：";

        try
        {
            var compressed = await provider.ChatAsync(
                [new LlmChatMessage { Role = "user", Content = input }],
                new ChatOptions { ModelId = string.Empty, SystemPrompt = prompt, MaxTokens = Math.Min(input.Length / 2, 4096) },
                ct);
            return string.IsNullOrWhiteSpace(compressed) ? input : compressed;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "LLM 压缩失败，回退到原文");
            return input;
        }
    }

    // ---- 算法压缩器 ----

    /// <summary>去重：移除重复的行和段落</summary>
    private static string Deduplicate(string text)
    {
        var lines = text.Split('\n');
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<string>();

        foreach (var line in lines)
        {
            var trimmed = line.Trim();
            if (trimmed.Length == 0)
            {
                result.Add(line);
                continue;
            }
            var normalized = NormalizeForDedup(trimmed);
            if (seen.Add(normalized))
            {
                result.Add(line);
            }
            else
            {
                result.Add($"[重复 {seen.Count}] {trimmed[..Math.Min(trimmed.Length, 40)]}");
            }
        }

        return string.Join("\n", result);
    }

    private static string NormalizeForDedup(string line)
    {
        // 移除数字、时间戳、GUID 等变化部分
        var s = Regex.Replace(line, @"\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?\b", "[TS]");
        s = Regex.Replace(s, @"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", "[GUID]");
        s = Regex.Replace(s, @"\b\d+\b", "[N]");
        s = Regex.Replace(s, @"0x[0-9a-fA-F]+", "[HEX]");
        return s;
    }

    /// <summary>格式压缩：去除多余空格和空行</summary>
    private static string CompressWhitespace(string text)
    {
        var lines = text.Split('\n');
        var result = new List<string>();
        bool prevEmpty = false;

        foreach (var line in lines)
        {
            var trimmed = line.TrimEnd();
            if (string.IsNullOrWhiteSpace(trimmed))
            {
                if (!prevEmpty) result.Add("");
                prevEmpty = true;
            }
            else
            {
                result.Add(Regex.Replace(trimmed, @" {2,}", " "));
                prevEmpty = false;
            }
        }

        return string.Join("\n", result).Trim();
    }

    /// <summary>数字归一化：用占位符替换数字</summary>
    private static string NormalizeNumbers(string text)
    {
        // 保留数字上下文，用 [N] 替换
        return Regex.Replace(text, @"\b\d+\b", match =>
        {
            var val = match.Value;
            return val.Length <= 2 ? val : "[N]"; // 保留小数字
        });
    }

    /// <summary>日志去重：识别日志行模式并折叠</summary>
    private static string DeduplicateLogs(string text)
    {
        var lines = text.Split('\n');
        var patterns = new Dictionary<string, (int Count, string FirstLine)>();

        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                patterns.TryAdd("[EMPTY]", (1, line));
                var (c, f) = patterns["[EMPTY]"];
                patterns["[EMPTY]"] = (c + 1, f);
                continue;
            }

            var pattern = ExtractLogPattern(line);
            if (!patterns.ContainsKey(pattern))
            {
                patterns[pattern] = (1, line);
            }
            else
            {
                var (count, _) = patterns[pattern];
                patterns[pattern] = (count + 1, line);
            }
        }

        var result = new List<string>();
        foreach (var (pattern, (count, firstLine)) in patterns)
        {
            if (pattern == "[EMPTY]") continue;
            if (count == 1)
                result.Add(firstLine);
            else
                result.Add($"{firstLine}    ← 重复 {count} 次");
        }

        return string.Join("\n", result);
    }

    private static string ExtractLogPattern(string line)
    {
        // 移除时间戳、数字、GUID、十六进制、IP 地址
        var s = Regex.Replace(line, @"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?", "{TS}");
        s = Regex.Replace(s, @"\d{2}:\d{2}:\d{2}(\.\d+)?", "{TIME}");
        s = Regex.Replace(s, @"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", "{GUID}");
        s = Regex.Replace(s, @"\b\d+\b", "{N}");
        s = Regex.Replace(s, @"0x[0-9a-fA-F]+", "{HEX}");
        s = Regex.Replace(s, @"\b(?:\d{1,3}\.){3}\d{1,3}\b", "{IP}");
        return s;
    }

    /// <summary>停用词过滤：移除常见无意义词</summary>
    private static string RemoveStopWords(string text)
    {
        var cnStopWords = new HashSet<string> { "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这" };
        var enStopWords = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "shall", "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into", "through", "during", "before", "after", "above", "below", "between", "and", "but", "or", "nor", "not", "so", "yet", "both", "either", "neither", "each", "every", "all", "any", "few", "more", "most", "other", "some", "such", "no", "only", "own", "same", "than", "too", "very", "just", "about", "also", "if", "then", "now", "here", "there", "when", "where", "why", "how", "it", "its", "this", "that", "these", "those" };

        var words = Regex.Split(text, @"(\s+|[，。！？；：""（）\r\n])");
        var sb = new StringBuilder();
        foreach (var w in words)
        {
            if (string.IsNullOrWhiteSpace(w) || w.Length <= 1)
            {
                sb.Append(w);
            }
            else if (cnStopWords.Contains(w) || enStopWords.Contains(w))
            {
                sb.Append(' ');
            }
            else
            {
                sb.Append(w);
            }
        }
        return Regex.Replace(sb.ToString(), @" {2,}", " ");
    }
}
