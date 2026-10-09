using Hetu.Core.Interfaces;
using Microsoft.Extensions.Logging;

namespace Hetu.Core.Services;

/// <summary>
/// 搜索查询改写：把口语化的用户问题提炼成搜索引擎友好的关键词。
/// 直接用原文检索是"搜不到/不相关"的主要原因之一；改写失败时原样返回，不影响搜索。
/// 复用当前会话的 LLM（调用方传入），避免依赖默认模型配置。
/// </summary>
public class SearchQueryRewriter
{
    private readonly ILogger<SearchQueryRewriter> _logger;
    private readonly ILlmUsageRecorder _usageRecorder;

    // 部分模型（native 推理模式）对 completion 请求只回推理内容、正文为空：
    // 一旦发现就直接降级为原文检索，避免每条消息都白跑一次 LLM 调用
    private static DateTime _unavailableUntil = DateTime.MinValue;
    private static readonly TimeSpan UnavailableCooldown = TimeSpan.FromMinutes(30);

    private const string SystemPrompt = """
你是搜索关键词提炼器。把用户的提问改写成适合搜索引擎的关键词。

规则：
- 只输出关键词，每行一个，最多 3 个
- 去掉礼貌用语、上下文修饰和标点，保留实体、术语、版本号、时间限定
- 中英文任选最可能搜到的形式，不要解释、不要编号、不要引号
- 提取不出有效信息时，输出用户原文
""";

    public SearchQueryRewriter(ILogger<SearchQueryRewriter> logger, ILlmUsageRecorder usageRecorder)
    {
        _logger = logger;
        _usageRecorder = usageRecorder;
    }

    /// <summary>返回改写后的关键词列表（至少一个：失败时退化为原文）</summary>
    public async Task<List<string>> RewriteAsync(string question, ILLMProvider? provider, CancellationToken cancellationToken = default)
    {
        var fallback = new List<string> { question.Trim() };
        if (string.IsNullOrWhiteSpace(question) || provider == null) return fallback;
        if (DateTime.UtcNow < _unavailableUntil) return fallback;

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(TimeSpan.FromSeconds(15));

            var raw = await provider.CompleteAsync(question, new CompletionOptions
            {
                ModelId = string.Empty,
                SystemPrompt = SystemPrompt,
                Temperature = 0.2,
                MaxTokens = 120,
            }, cts.Token);

            await _usageRecorder.RecordAsync(
                LlmUsageSources.Search, null,
                inputTokens: LlmTokenEstimator.Estimate(SystemPrompt) + LlmTokenEstimator.Estimate(question),
                contentPreview: question,
                ct: cancellationToken);

            _logger.LogDebug("查询改写原始输出：{Raw}", (raw ?? string.Empty).Replace("\n", " / ")[..Math.Min(200, (raw ?? string.Empty).Length)]);

            if (string.IsNullOrWhiteSpace(raw))
            {
                // 模型只回推理内容（native 推理模式常见）：降级并在冷却期内跳过改写
                _unavailableUntil = DateTime.UtcNow.Add(UnavailableCooldown);
                _logger.LogDebug("查询改写返回空内容，降级为原文检索（冷却 {Minutes} 分钟）", UnavailableCooldown.TotalMinutes);
                return fallback;
            }

            var keywords = (raw ?? string.Empty)
                .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(k => k.Trim().TrimStart('-', '*', '•', '>', ' ').Trim('"', '“', '”', '‘', '’'))
                .Select(CleanKey)
                .Where(k => k.Length is > 1 and <= 60)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Take(3)
                .ToList();

            if (keywords.Count == 0)
            {
                _logger.LogDebug("查询改写无有效关键词，使用原文");
                return fallback;
            }
            _logger.LogDebug("查询改写：{Original} → {Rewritten}", question, string.Join(" | ", keywords));
            return keywords;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "查询改写失败，使用原文");
            return fallback;
        }
    }

    /// <summary>去掉改写器偶尔带上的解释性前缀（如"关键词：xxx"）</summary>
    private static string CleanKey(string k)
    {
        var idx = k.IndexOfAny(['：', ':']);
        if (idx > 0 && idx < 8) k = k[(idx + 1)..].Trim();
        return k;
    }
}
