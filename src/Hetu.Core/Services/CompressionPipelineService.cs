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

    /// <summary>获取当前压缩配置（与内置默认合并，保证新增节点能出现在已有配置里）</summary>
    public async Task<CompressionPipelineDto> GetConfigAsync(CancellationToken ct = default)
    {
        var defaults = CompressionDefaults.GetDefault();
        var setting = await _appSettingService.GetAsync("CompressionConfig", ct);
        if (setting?.Data == null || string.IsNullOrWhiteSpace(setting.Data.Value))
            return defaults;

        CompressionPipelineDto? stored;
        try
        {
            stored = System.Text.Json.JsonSerializer.Deserialize<CompressionPipelineDto>(setting.Data.Value);
        }
        catch
        {
            return defaults;
        }

        return stored == null ? defaults : MergeWithDefaults(stored, defaults);
    }

    /// <summary>
    /// 用内置默认补齐存量配置：节点集合、顺序、标签都以代码为准，只保留用户对「是否启用」的选择，
    /// 避免升级后新算法节点对老配置不可见。
    /// </summary>
    private static CompressionPipelineDto MergeWithDefaults(CompressionPipelineDto stored, CompressionPipelineDto defaults)
    {
        var storedByKey = new Dictionary<string, CompressionNodeDto>(StringComparer.Ordinal);
        foreach (var node in stored.Nodes) storedByKey[node.Key] = node;

        var nodes = new List<CompressionNodeDto>();
        foreach (var def in defaults.Nodes)
        {
            nodes.Add(new CompressionNodeDto
            {
                Key = def.Key,
                Label = def.Label,
                Description = def.Description,
                Enabled = storedByKey.TryGetValue(def.Key, out var saved) ? saved.Enabled : def.Enabled,
                Order = def.Order
            });
        }

        // 配置里存在的未知节点（历史遗留/自定义）原样保留，排在末尾
        foreach (var node in stored.Nodes.Where(n => defaults.Nodes.All(d => d.Key != n.Key)))
        {
            node.Order = 100 + node.Order;
            nodes.Add(node);
        }

        return new CompressionPipelineDto
        {
            Enabled = stored.Enabled,
            Mode = stored.Mode,
            LlmModelId = stored.LlmModelId,
            LlmSystemPrompt = string.IsNullOrWhiteSpace(stored.LlmSystemPrompt) ? defaults.LlmSystemPrompt : stored.LlmSystemPrompt,
            LlmThreshold = stored.LlmThreshold,
            Nodes = nodes
        };
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
        => await CompressCoreAsync(input, await GetConfigAsync(ct), allowLlm: true, ct);

    /// <summary>
    /// 单轮任务压缩（wiki 生成、知识图谱提取等）：只执行算法节点，
    /// 即使配置为 llm/hybrid 也不触发 LLM 摘要——单轮输入不值得额外再花一次模型调用。
    /// </summary>
    public async Task<string> CompressAlgorithmicAsync(string input, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(input)) return input;

        var config = await GetConfigAsync(ct);
        var hasAlgorithm = config.Enabled && config.Nodes.Any(n => n.Enabled && n.Key != "llm_summary");
        if (!hasAlgorithm)
        {
            _logger.LogInformation("[Compression] 单轮任务：管道关闭或无启用算法节点，跳过压缩");
            return input;
        }

        var result = await CompressCoreAsync(input, config, allowLlm: false, ct);
        _logger.LogInformation("[Compression] 单轮任务算法压缩：{Before} → {After} 字符", input.Length, result.Length);
        return result;
    }

    private async Task<string> CompressCoreAsync(string input, CompressionPipelineDto config, bool allowLlm, CancellationToken ct)
    {
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
                if (!allowLlm)
                {
                    _logger.LogInformation("[Compression] 单轮任务：跳过 LLM 摘要（仅算法压缩）");
                    continue;
                }
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
                "structured" => FoldStructuredPayloads(result),
                "whitespace" => CompressWhitespace(result),
                "log_dedup" => DeduplicateLogs(result),
                "near_dup" => DeduplicateNear(result),
                "number_normalize" => NormalizeNumbers(result),
                "keywords" => ExtractKeyLines(result),
                "headtail" => KeepHeadTail(result),
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
        var factory = _llmProviderFactory;
        if (factory == null)
        {
            _logger.LogWarning("[Compression] LLM 摘要跳过：没有可用的 LLM Provider 工厂");
            return input;
        }

        ILLMProvider? provider;
        if (!string.IsNullOrWhiteSpace(config.LlmModelId) && Guid.TryParse(config.LlmModelId, out var modelId))
        {
            provider = await factory.CreateProviderAsync(modelId, ct);
            // 配置里记的模型可能已被删除/重建：回落到默认对话模型，避免压缩静默失效
            if (provider == null)
                _logger.LogWarning("[Compression] LLM 摘要模型 {ModelId} 不可用（可能已删除），回落到默认对话模型", modelId);
        }
        else
        {
            provider = null;
        }

        provider ??= await factory.CreateChatProviderAsync(ct);
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

    /// <summary>
    /// 数字归一化：用占位符替换数字。
    /// 跳过压缩管道自己写的标注行（"← 重复 N 次"），否则 `重复 12 次` 会被改成 `重复 [N] 次`，
    /// 前一个节点辛苦统计出来的次数当场失去意义。
    /// </summary>
    private static string NormalizeNumbers(string text)
    {
        if (!text.Contains('←')) return NormalizeNumbersCore(text);

        var lines = text.Split('\n');
        for (var i = 0; i < lines.Length; i++)
            if (!lines[i].Contains("← 重复") && !lines[i].Contains("← 近似重复"))
                lines[i] = NormalizeNumbersCore(lines[i]);
        return string.Join("\n", lines);
    }

    private static string NormalizeNumbersCore(string text)
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

    /// <summary>
    /// 停用词过滤：只删「不承载命题」的虚词。
    /// 注意不能删否定词与情态词（不/没/未/要/会/not/no/nor/only 等）——删了会把语义反过来，
    /// 这类"压缩"对下游模型是投毒。
    /// </summary>
    private static string RemoveStopWords(string text)
    {
        var cnStopWords = new HashSet<string> { "的", "了", "着", "地", "得", "之", "而已", "的话", "一个", "我们", "你们", "他们", "以及", "然后", "因此", "其实", "就是" };
        var enStopWords = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "shall", "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into", "through", "during", "before", "after", "above", "below", "between", "and", "but", "or", "so", "yet", "both", "either", "each", "every", "all", "any", "few", "more", "most", "other", "some", "such", "same", "than", "too", "very", "just", "about", "also", "if", "then", "now", "here", "there", "when", "where", "why", "how", "it", "its", "this", "that", "these", "those" };

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

    // ---- 结构化载荷折叠 ----

    /// <summary>
    /// 结构化折叠：工具结果里最占体积的往往不是重复文本，而是 base64、JSON、HTML、表格这类
    /// 「体积大、密度低」的载荷——逐行去重/格式压缩对它们基本无效。
    /// 这里按类型折叠：base64 只留体积、JSON 只留结构骨架与样本、HTML 去标签、重复表格/CSV 只留表头与前几行。
    /// </summary>
    private static string FoldStructuredPayloads(string text)
    {
        if (text.Length < 200) return text;

        var lines = text.Split('\n');
        var output = new List<string>();
        var i = 0;

        while (i < lines.Length)
        {
            var line = lines[i];
            var trimmed = line.TrimStart();

            if ((trimmed.StartsWith('{') || trimmed.StartsWith('[')) && IsBalancedStart(trimmed))
            {
                var end = FindBlockEnd(lines, i);
                var block = string.Join("\n", lines[i..(end + 1)]);
                if (block.Length >= 200 && TrySummarizeJson(block) is { } json && json.Length < block.Length)
                {
                    output.Add(json);
                    i = end + 1;
                    continue;
                }
            }

            if (LooksLikeHtml(trimmed))
            {
                var end = i;
                while (end + 1 < lines.Length && LooksLikeHtml(lines[end + 1].TrimStart())) end++;
                var block = string.Join("\n", lines[i..(end + 1)]);
                if (block.Length >= 200 && StripHtml(block) is { } plain && plain.Length < block.Length / 2)
                {
                    output.Add(plain);
                    i = end + 1;
                    continue;
                }
            }

            if (IsTabularRow(line))
            {
                var end = i;
                while (end + 1 < lines.Length && IsTabularRow(lines[end + 1])) end++;
                var rows = lines[i..(end + 1)];
                if (rows.Length >= 8)
                {
                    output.Add(string.Join("\n", rows.Take(3)));
                    output.Add($"… 省略 {rows.Length - 3} 行（表格/CSV 同类行）");
                    i = end + 1;
                    continue;
                }
            }

            output.Add(FoldBase64(line));
            i++;
        }

        return string.Join("\n", output);
    }

    private static readonly Regex Base64RunRegex = new(
        @"(?<![\w+/=])(?:data:[\w/.+-]+;base64,)?[A-Za-z0-9+/]{160,}={0,2}(?![\w+/=])",
        RegexOptions.Compiled);

    /// <summary>base64 / data URI 折叠成体积占位符</summary>
    private static string FoldBase64(string line)
    {
        if (line.Length < 160) return line;

        return Base64RunRegex.Replace(line, m =>
        {
            // 长串若既无 +/ 又无明显长度，可能只是普通长标识符/路径，不动它
            if (m.Value.Length < 256 && !m.Value.Contains('+') && !m.Value.Contains('/') && !m.Value.Contains('='))
                return m.Value;

            var bytes = m.Value.Length / 4 * 3;
            var size = bytes >= 1024 ? $"{bytes / 1024.0:F1}KB" : $"{bytes}B";
            return $"[base64 已折叠 ~{size}]";
        });
    }

    private static bool IsBalancedStart(string trimmed) => trimmed[0] is '{' or '[';

    /// <summary>从 start 行开始找到括号配对的结束行（用于多行 JSON）</summary>
    private static int FindBlockEnd(string[] lines, int start)
    {
        var depth = 0;
        var inString = false;
        var escaped = false;

        for (var i = start; i < lines.Length && i < start + 2000; i++)
        {
            foreach (var ch in i == start ? lines[i].AsSpan(IndexOfJsonStart(lines[i])) : lines[i].AsSpan())
            {
                if (escaped) { escaped = false; continue; }
                if (ch == '\\' && inString) { escaped = true; continue; }
                if (ch == '"') { inString = !inString; continue; }
                if (inString) continue;
                if (ch is '{' or '[') depth++;
                else if (ch is '}' or ']')
                {
                    depth--;
                    if (depth == 0) return i;
                }
            }
        }
        return start;
    }

    private static int IndexOfJsonStart(string line)
    {
        var idx = line.IndexOfAny(['{', '[']);
        return idx < 0 ? 0 : idx;
    }

    private static string? TrySummarizeJson(string block)
    {
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(block);
            var sb = new StringBuilder();
            SummarizeJson(doc.RootElement, sb, 0);
            return sb.ToString();
        }
        catch
        {
            return null;
        }
    }

    /// <summary>把 JSON 折成「结构 + 样本」：对象保留键名，数组保留首元素与长度，标量截断</summary>
    private static void SummarizeJson(System.Text.Json.JsonElement element, StringBuilder sb, int depth)
    {
        if (depth > 4)
        {
            sb.Append('…');
            return;
        }

        switch (element.ValueKind)
        {
            case System.Text.Json.JsonValueKind.Object:
            {
                sb.Append('{');
                var index = 0;
                var total = 0;
                foreach (var prop in element.EnumerateObject()) total++;
                foreach (var prop in element.EnumerateObject())
                {
                    if (index >= 12)
                    {
                        sb.Append($"… 共 {total} 个键");
                        break;
                    }
                    if (index++ > 0) sb.Append(", ");
                    sb.Append(prop.Name).Append(": ");
                    SummarizeJson(prop.Value, sb, depth + 1);
                }
                sb.Append('}');
                break;
            }
            case System.Text.Json.JsonValueKind.Array:
            {
                var total = element.GetArrayLength();
                sb.Append('[');
                if (total > 0) SummarizeJson(element[0], sb, depth + 1);
                if (total > 1) sb.Append($", … 共 {total} 项");
                sb.Append(']');
                break;
            }
            case System.Text.Json.JsonValueKind.String:
            {
                var value = element.GetString() ?? string.Empty;
                sb.Append('"').Append(value.Length > 60 ? value[..60] + "…" : value).Append('"');
                break;
            }
            default:
                sb.Append(element.GetRawText());
                break;
        }
    }

    private static readonly Regex HtmlTagRegex = new(
        @"</?(?:div|span|p|a|table|thead|tbody|tr|td|th|ul|ol|li|html|body|head|script|style|meta|link|h[1-6]|br|hr|img|form|input|button|select|option|section|article|nav|header|footer|main|pre|code|strong|em|label)\b",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static bool LooksLikeHtml(string trimmed)
        => trimmed.Length > 0 && trimmed[0] == '<' && HtmlTagRegex.IsMatch(trimmed);

    private static string? StripHtml(string block)
    {
        var s = Regex.Replace(block, @"<script\b[^>]*>.*?</script>", " ", RegexOptions.Singleline | RegexOptions.IgnoreCase);
        s = Regex.Replace(s, @"<style\b[^>]*>.*?</style>", " ", RegexOptions.Singleline | RegexOptions.IgnoreCase);
        s = Regex.Replace(s, @"<!--.*?-->", " ", RegexOptions.Singleline);
        s = Regex.Replace(s, @"<(?:br|hr|/p|/div|/tr|/li|/h[1-6]|/table|/section)\s*/?>", "\n", RegexOptions.IgnoreCase);
        s = Regex.Replace(s, @"<[^>]{0,400}>", " ");
        s = s.Replace("&nbsp;", " ").Replace("&lt;", "<").Replace("&gt;", ">").Replace("&quot;", "\"").Replace("&#39;", "'").Replace("&amp;", "&");
        s = Regex.Replace(s, @"[ \t]{2,}", " ");
        s = Regex.Replace(s, @"\n{3,}", "\n\n");
        s = string.Join("\n", s.Split('\n').Select(l => l.Trim())).Trim();
        return s.Length == 0 ? null : s;
    }

    /// <summary>表格行判定：Markdown 表格行，或逗号/制表符分隔的 CSV 行</summary>
    private static bool IsTabularRow(string line)
    {
        var trimmed = line.Trim();
        if (trimmed.Length < 12) return false;
        if (trimmed.StartsWith('|') && trimmed.EndsWith('|')) return true;
        if (trimmed.Contains('。')) return false;
        var commas = trimmed.Count(c => c == ',');
        if (commas >= 4) return true;
        return line.Count(c => c == '\t') >= 4;
    }

    // ---- 近似重复去重（SimHash + LSH 取候选，Jaccard 判相似） ----

    /// <summary>近似重复的相似度下限：分片集合 Jaccard ≥ 0.85 才算重复（比 64 位汉明距离更精确）</summary>
    private const double NearDuplicateSimilarity = 0.85;

    /// <summary>
    /// 近似重复：精确去重抓不到「只有时间戳/ID/序号不同」的重复内容（分页结果、重试日志、相同报错）。
    /// 每行归一化后算 SimHash，用 4×16bit 分段索引取候选（同段才可能相近），再用分片 Jaccard 精确判定，
    /// 避免只看 64 位汉明距离带来的误判。
    /// </summary>
    private static string DeduplicateNear(string text)
    {
        var lines = text.Split('\n');
        if (lines.Length < 6) return text;

        var keptShingles = new List<HashSet<uint>>();
        var keptTokens = new List<int>();
        var keptOutIndex = new List<int>();
        var keptDupCount = new List<int>();
        var keptDupChars = new List<int>();
        var bands = new Dictionary<(int Band, ulong Key), List<int>>();

        var result = new List<string>();

        foreach (var line in lines)
        {
            var trimmed = line.Trim();
            if (trimmed.Length < 40 || trimmed.Length > 4000 || LooksLikeCode(trimmed))
            {
                result.Add(line);
                continue;
            }

            var tokens = TokenizeNear(trimmed);
            if (tokens.Count < 10)
            {
                result.Add(line);
                continue;
            }

            var shingles = Shingles(tokens);
            var match = -1;

            for (var band = 0; band < 4 && match < 0; band++)
            {
                var signature = SimHash(shingles);
                if (!bands.TryGetValue((band, (signature >> (16 * band)) & 0xFFFFUL), out var candidates)) continue;
                foreach (var c in candidates)
                {
                    if (Math.Abs(keptTokens[c] - tokens.Count) > Math.Max(3, keptTokens[c] / 5)) continue;
                    if (Jaccard(keptShingles[c], shingles) >= NearDuplicateSimilarity)
                    {
                        match = c;
                        break;
                    }
                }
            }

            if (match >= 0)
            {
                keptDupCount[match]++;
                keptDupChars[match] += trimmed.Length + 1;
                continue;
            }

            var index = keptShingles.Count;
            var sig = SimHash(shingles);
            keptShingles.Add(shingles);
            keptTokens.Add(tokens.Count);
            keptOutIndex.Add(result.Count);
            keptDupCount.Add(0);
            keptDupChars.Add(0);
            result.Add(line);

            for (var band = 0; band < 4; band++)
            {
                var key = (band, (sig >> (16 * band)) & 0xFFFFUL);
                if (!bands.TryGetValue(key, out var list)) bands[key] = list = new List<int>();
                if (list.Count < 64) list.Add(index);
            }
        }

        for (var i = 0; i < keptShingles.Count; i++)
        {
            if (keptDupCount[i] == 0) continue;
            var note = $"    ← 近似重复 {keptDupCount[i]} 次";
            if (keptDupChars[i] > note.Length)
                result[keptOutIndex[i]] = result[keptOutIndex[i]].TrimEnd() + note;
        }

        return string.Join("\n", result);
    }

    /// <summary>分片集合：3-gram 的 32 位哈希（用集合而非多重集，避免重复 token 影响相似度）</summary>
    private static HashSet<uint> Shingles(List<string> tokens)
    {
        var shingles = new HashSet<uint>();
        var shingle = new StringBuilder();
        for (var i = 0; i < tokens.Count; i++)
        {
            shingle.Clear();
            for (var j = i; j < Math.Min(i + 3, tokens.Count); j++) shingle.Append(tokens[j]).Append('\u0001');
            shingles.Add((uint)Fnv1a64(shingle));
        }
        return shingles;
    }

    private static double Jaccard(HashSet<uint> a, HashSet<uint> b)
    {
        var intersection = 0;
        foreach (var item in a) if (b.Contains(item)) intersection++;
        var union = a.Count + b.Count - intersection;
        return union == 0 ? 0 : (double)intersection / union;
    }

    private static readonly Regex NearTokenRegex = new(@"[A-Za-z0-9_]+", RegexOptions.Compiled);

    /// <summary>
    /// 切词：先归一化数字再切词。
    /// 不归一化的话，「耗时 100ms」和「耗时 129ms」这种同一句日志的变体会被当成不同内容，
    /// 而这正是工具日志里最常见的重复形态。中文不做分词，二元组对相似度足够。
    /// </summary>
    private static List<string> TokenizeNear(string line)
    {
        var normalized = Regex.Replace(NormalizeForDedup(line), @"\d+", "#");

        var tokens = new List<string>();
        foreach (Match m in NearTokenRegex.Matches(normalized)) tokens.Add(m.Value.ToLowerInvariant());

        var cjk = new List<char>();
        foreach (var ch in normalized)
            if (ch >= 0x4E00 && ch <= 0x9FFF) cjk.Add(ch);
        for (var i = 0; i + 1 < cjk.Count; i++) tokens.Add(new string([cjk[i], cjk[i + 1]]));

        return tokens;
    }

    /// <summary>SimHash：分片哈希按位投票</summary>
    private static ulong SimHash(HashSet<uint> shingles)
    {
        var vector = new int[64];
        foreach (var shingle in shingles)
            for (var bit = 0; bit < 64; bit++)
                vector[bit] += ((shingle >> (bit % 32)) & 1U) == 1 ? 1 : -1;

        var signature = 0UL;
        for (var bit = 0; bit < 64; bit++)
            if (vector[bit] > 0) signature |= 1UL << bit;
        return signature;
    }

    private static ulong Fnv1a64(StringBuilder sb)
    {
        var hash = 14695981039346656037UL;
        for (var i = 0; i < sb.Length; i++)
        {
            hash ^= sb[i];
            hash *= 1099511628211UL;
        }
        return hash;
    }

    // ---- 关键行抽取 ----

    private static readonly Regex ErrorSignals = new(
        @"错误|失败|异常|报错|超时|拒绝|无法|不能|不存在|冲突|回滚|error|exception|fail(?:ed|ure)?|panic|fatal|traceback|❌|⛔",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex WarnSignals = new(
        @"警告|注意|小心|退而求其次|降级|warn(?:ing)?|deprecat|⚠|😅",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex DecisionSignals = new(
        @"结论|决定|方案|必须|不要|禁止|建议|原因|根因|待办|下一步|TODO|FIXME|NOTE:|说明[：:]|修复|新增|删除|改动",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex PathSignals = new(
        @"(?:[A-Za-z]:\\|/|\\)[\w.-]+(?:[/\\][\w.-]+)*|\b[\w-]+\.(?:cs|ts|tsx|js|jsx|json|md|py|sql|yml|yaml|xml|css|html|sh|ps1|png|jpg|log|txt|db)\b",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex CommandSignals = new(
        @"^\s*(?:\$|>|PS\s?[A-Z]:\\|dotnet|npm|pnpm|yarn|git|gh|curl|python|node|docker|kubectl|systemctl)\b",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex HeadingSignals = new(@"^\s*(?:#{1,6}\s|\d+[.)]\s|[一二三四五六七八九十]+[、.]|[-*+]\s+\S)", RegexOptions.Compiled);

    private static readonly Regex NoiseSignals = new(
        @"^\s*(?:\d+%|\.{3,}|={3,}|-{3,}|等待中|加载中|处理中|loading|waiting|retry|heartbeat|ping)\s*$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>行信息量打分：正分=值得保留，负分=流水行</summary>
    private static int ScoreKeyLine(string line)
    {
        var trimmed = line.Trim();
        if (trimmed.Length == 0) return 0;

        var score = 0;
        if (ErrorSignals.IsMatch(trimmed)) score += 6;
        if (WarnSignals.IsMatch(trimmed)) score += 3;
        if (DecisionSignals.IsMatch(trimmed)) score += 3;
        if (PathSignals.IsMatch(trimmed)) score += 2;
        if (CommandSignals.IsMatch(trimmed)) score += 2;
        if (HeadingSignals.IsMatch(trimmed)) score += 2;
        if (trimmed.Contains('→') || trimmed.Contains("=>") || trimmed.Contains('%')) score += 1;
        if (trimmed.Length < 15) score -= 3;
        if (NoiseSignals.IsMatch(trimmed)) score -= 5;

        return score;
    }

    /// <summary>
    /// 关键行抽取：长文本里大部分是流水行（进度、分隔线、重复状态），
    /// 按信息量打分保留错误/结论/路径/命令等关键行，其余按预算裁掉并折叠成一行提示。
    /// 关键行不足以压到预算内时返回原文，交给后续头尾保留节点处理。
    /// </summary>
    private static string ExtractKeyLines(string text)
    {
        const int MinChars = 2500;
        if (text.Length < MinChars) return text;

        var lines = text.Split('\n');
        if (lines.Length < 25) return text;

        var scores = new int[lines.Length];
        for (var i = 0; i < lines.Length; i++) scores[i] = ScoreKeyLine(lines[i]);

        var keep = new bool[lines.Length];
        var used = 0;
        for (var i = 0; i < lines.Length; i++)
        {
            // 首尾各 3 行通常是背景与结论，固定保留
            keep[i] = i < 3 || i >= lines.Length - 3 || scores[i] > 0;
            if (keep[i]) used += lines[i].Length + 1;
        }

        var budget = Math.Max(1500, text.Length / 3);
        if (used > budget)
        {
            // 优先丢分数最低、最长的流水行
            var droppable = Enumerable.Range(3, Math.Max(0, lines.Length - 6))
                .Where(i => keep[i] && scores[i] < 4)
                .OrderBy(i => scores[i])
                .ThenByDescending(i => lines[i].Length)
                .ToList();

            foreach (var i in droppable)
            {
                if (used <= budget) break;
                keep[i] = false;
                used -= lines[i].Length + 1;
            }
        }

        if (used > budget) return text;

        var output = new List<string>();
        var omitted = 0;
        void FlushOmitted()
        {
            if (omitted == 0) return;
            if (omitted >= 2) output.Add($"… 省略 {omitted} 行");
            omitted = 0;
        }

        for (var i = 0; i < lines.Length; i++)
        {
            if (keep[i])
            {
                FlushOmitted();
                output.Add(lines[i]);
            }
            else
            {
                omitted++;
            }
        }
        FlushOmitted();

        return string.Join("\n", output);
    }

    // ---- 超长头尾保留 ----

    /// <summary>
    /// 超长头尾保留：build 日志、大文件内容、命令输出这类文本，逐行算法压不动，
    /// LLM 摘要又太贵。保留首尾（通常是命令回显与最终结论），中间整段折叠。
    /// </summary>
    private static string KeepHeadTail(string text)
    {
        const int Threshold = 6000;
        const int HeadChars = 3600;
        const int TailChars = 1600;

        if (text.Length <= Threshold) return text;

        var headEnd = text.LastIndexOf('\n', Math.Min(HeadChars, text.Length - 1));
        if (headEnd < HeadChars / 2) headEnd = HeadChars;

        var tailStart = text.IndexOf('\n', Math.Max(0, text.Length - TailChars));
        if (tailStart < 0) tailStart = text.Length - TailChars;

        var omitted = text[headEnd..tailStart];
        var omittedLines = omitted.Count(c => c == '\n') + 1;

        return text[..headEnd].TrimEnd() +
            $"\n…（中间省略 {omittedLines} 行 / {omitted.Length} 字符）…\n" +
            text[tailStart..].TrimStart();
    }
}
