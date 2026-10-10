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
        ILLMProviderFactory llmProviderFactory)
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

    /// <summary>
    /// 当前生效的压缩节点摘要（日志用）：列出真正会执行的节点；
    /// LLM 摘要节点在 algorithmic 模式下不参与，明确写出来避免误以为它在跑。
    /// </summary>
    public async Task<string> DescribeAsync(CancellationToken ct = default)
    {
        var config = await GetConfigAsync(ct);
        if (!config.Enabled) return "压缩管道已关闭（设置 → 压缩）";

        var enabled = config.Nodes.Where(n => n.Enabled).OrderBy(n => n.Order).Select(n => n.Key).ToList();
        if (enabled.Count == 0) return "压缩管道无启用节点";

        var llmActive = config.Mode is "llm" or "hybrid" && enabled.Contains("llm_summary");
        var nodes = enabled.Where(k => k != "llm_summary" || llmActive).ToList();
        var suffix = llmActive
            ? $"模式={config.Mode}（LLM 摘要仅在 ≥{config.LlmThreshold} 字符时触发）"
            : enabled.Contains("llm_summary")
                ? $"模式={config.Mode}（llm_summary 已跳过，需切换为 llm/hybrid）"
                : $"模式={config.Mode}";
        return $"节点={string.Join(",", nodes)} {suffix}";
    }

    /// <summary>
    /// 执行压缩：算法节点对任意长度文本都生效；LLM 摘要节点仅当文本达到
    /// <see cref="CompressionPipelineDto.LlmThreshold"/> 时触发（短文本不值得多花一次模型调用）。
    /// </summary>
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
                if (config.Mode is not ("llm" or "hybrid"))
                {
                    _logger.LogDebug("[Compression] 跳过 LLM 摘要：模式={Mode}（需 llm/hybrid）", config.Mode);
                    continue;
                }
                if (result.Length < Math.Max(0, config.LlmThreshold))
                {
                    _logger.LogDebug("[Compression] 跳过 LLM 摘要：{Len} 字符低于阈值 {Threshold}",
                        result.Length, config.LlmThreshold);
                    continue;
                }
                var before = result.Length;
                result = await LlmCompressAsync(result, config, ct);
                _logger.LogInformation("[Compression] LLM 摘要：{Before} → {After} 字符", before, result.Length);
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

        // 压缩后没变短就保留原文：部分节点（数字归一化、重复标注）在特定文本上反而会变长
        if (result.Length >= input.Length)
        {
            _logger.LogDebug("[Compression] 压缩后未变短（{Before} → {After} 字符），保留原文", input.Length, result.Length);
            return input;
        }

        _logger.LogDebug("[Compression] input={InputLen} output={OutputLen} ratio={Ratio:F1}%",
            input.Length, result.Length, input.Length > 0 ? result.Length * 100.0 / input.Length : 0);

        return result;
    }

    private async Task<string> LlmCompressAsync(string input, CompressionPipelineDto config, CancellationToken ct)
    {
        ILLMProvider? provider;
        if (!string.IsNullOrWhiteSpace(config.LlmModelId) && Guid.TryParse(config.LlmModelId, out var modelId))
        {
            provider = await _llmProviderFactory.CreateProviderAsync(modelId, ct);
            // 配置里记的模型可能已被删除/重建：回落到默认对话模型，避免压缩静默失效
            if (provider == null)
                _logger.LogWarning("[Compression] LLM 摘要模型 {ModelId} 不可用（可能已删除），回落到默认对话模型", modelId);
        }
        else
        {
            provider = null;
        }

        provider ??= await _llmProviderFactory.CreateChatProviderAsync(ct);
        if (provider == null)
        {
            _logger.LogWarning("[Compression] LLM 摘要跳过：没有可用的对话模型");
            return input;
        }

        var prompt = config.LlmSystemPrompt ?? "压缩以下文本，保留所有关键信息：";

        try
        {
            // 预算下限 1024：推理类模型会先消耗思考 token，给太少会导致正文为空（压缩静默失效）
            var maxTokens = Math.Clamp(input.Length / 2, 1024, 4096);
            var compressed = await provider.ChatAsync(
                [new LlmChatMessage { Role = "user", Content = input }],
                new ChatOptions { ModelId = string.Empty, SystemPrompt = prompt, MaxTokens = maxTokens },
                ct);
            if (string.IsNullOrWhiteSpace(compressed))
            {
                _logger.LogWarning("[Compression] LLM 摘要返回空内容（maxTokens={MaxTokens}），保留原文", maxTokens);
                return input;
            }
            // 安全网：明显过度压缩（不足原文 20%）时保留原文，避免信息被摘要掉
            if (compressed.Length < Math.Max(40, input.Length / 5))
            {
                _logger.LogWarning("[Compression] LLM 摘要过度压缩（{Before} → {After} 字符），保留原文", input.Length, compressed.Length);
                return input;
            }
            return compressed;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "LLM 压缩失败，回退到原文");
            return input;
        }
    }

    // ---- 算法压缩器 ----

    /// <summary>
    /// 去重：段 → 句 → 行 三级去重。
    /// 只做行级去重会漏掉「同一行里重复的句子」（例如重复粘贴的同一句话）；
    /// 只做句级又会把整块重复的代码/日志切碎。段级放在最前，整块重复直接拿掉，
    /// 剩下的再由句级、行级兜底，重复内容只保留首次出现。
    /// </summary>
    private static string Deduplicate(string text)
    {
        var paragraphs = DeduplicateParagraphs(text);
        var sentences = DeduplicateSentences(paragraphs);
        return DeduplicateLines(sentences);
    }

    /// <summary>句级去重：同一行内重复出现的句子只保留首次（代码块/结构化行不动）</summary>
    private static string DeduplicateSentences(string text)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<string>();

        foreach (var line in text.Split('\n'))
        {
            if (line.Trim().Length < 40 || LooksLikeCode(line))
            {
                result.Add(line);
                continue;
            }

            var parts = Regex.Split(line, @"(?<=[。！？!?；;])");
            var rebuilt = new StringBuilder();
            foreach (var part in parts)
            {
                var trimmed = part.Trim();
                if (trimmed.Length == 0) continue;
                // 句级用原文比较：句内常常只差一个数字/时间，归一化会误删有效信息
                if (!seen.Add(trimmed)) continue; // 重复句直接丢弃
                rebuilt.Append(part);
            }
            result.Add(rebuilt.ToString().TrimEnd());
        }

        return string.Join("\n", result);
    }

    /// <summary>行级去重：重复行只保留首次，并在保留行后标注重复次数</summary>
    private static string DeduplicateLines(string text)
    {
        var lines = text.Split('\n');
        var totals = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var line in lines)
        {
            var trimmed = line.Trim();
            if (trimmed.Length == 0) continue;
            var key = NormalizeForDedup(trimmed);
            totals[key] = totals.TryGetValue(key, out var count) ? count + 1 : 1;
        }

        var emitted = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<string>();
        foreach (var line in lines)
        {
            var trimmed = line.Trim();
            if (trimmed.Length == 0)
            {
                result.Add(line);
                continue;
            }

            var key = NormalizeForDedup(trimmed);
            if (!emitted.Add(key)) continue;
            if (totals[key] > 1)
            {
                var note = $"    ← 重复 {totals[key]} 次";
                // 标注只在确实缩短时才加：短行（如单独的 } ）重复时加标注反而更长
                if (trimmed.Length * (totals[key] - 1) > note.Length)
                {
                    result.Add(line.TrimEnd() + note);
                    continue;
                }
            }
            result.Add(line);
        }

        return string.Join("\n", result);
    }

    /// <summary>段级去重：整段（空行分隔的多行块，如重复粘贴的日志/堆栈/说明）只保留首次</summary>
    private static string DeduplicateParagraphs(string text)
    {
        var blocks = Regex.Split(text, @"\n[ \t]*\n");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var kept = new List<string>();

        foreach (var block in blocks)
        {
            // 段级用原文（仅去首尾空白）比较：段内只差一个数字就整体合并风险太大
            var key = block.Trim();
            if (key.Length == 0 || seen.Add(key)) kept.Add(block);
        }

        return string.Join("\n\n", kept);
    }

    /// <summary>代码/结构化行判定：命中则不做句级切分（避免破坏代码、JSON、表格）</summary>
    private static bool LooksLikeCode(string line)
    {
        var trimmed = line.TrimStart();
        if (line.StartsWith("    ") || line.StartsWith('\t')) return true;
        if (trimmed.StartsWith("```") || trimmed.StartsWith('|')) return true;
        if (trimmed.Contains("=>") || trimmed.Contains("::") || trimmed.Contains("</") || trimmed.Contains("{\"") || trimmed.Contains("};")) return true;
        return Regex.IsMatch(trimmed, @"^(public|private|protected|internal|class|interface|struct|def |func |function |import |export |from |const |let |var |SELECT|INSERT|UPDATE|DELETE|CREATE|#include|#define)\b", RegexOptions.IgnoreCase);
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
