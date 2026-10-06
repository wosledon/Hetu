using System.Text;
using System.Text.RegularExpressions;
using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.Services;

/// <summary>
/// 多源网页搜索：DuckDuckGo HTML 为主、Bing HTML 兜底。
/// 取代原先的 Bing RSS 方案——该非官方端点已退化为返回趋势性无关内容，搜不到也搜不准。
/// 结果经过去重、实体解码与内容农场过滤后才返回。
/// </summary>
public class MultiSourceWebSearchService : IWebSearchService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<MultiSourceWebSearchService> _logger;

    private const string DdgUrl = "https://html.duckduckgo.com/html/?q={0}";
    private const string BingUrl = "https://www.bing.com/search?q={0}&setlang=zh-CN&mkt=zh-CN";
    private const string BrowserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    // 免费源都会被限流/降质：某源连续无结果后进入冷却，期间直接用下一个源，避免把配额打光
    private static readonly Dictionary<string, DateTime> SourceCooldown = new(StringComparer.OrdinalIgnoreCase);
    private static readonly TimeSpan CooldownDuration = TimeSpan.FromMinutes(10);

    public MultiSourceWebSearchService(HttpClient httpClient, ILogger<MultiSourceWebSearchService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
    }

    public async Task<List<WebSearchResultDto>> SearchAsync(string query, int maxResults = 5, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(query)) return [];

        var sources = new (string Name, Func<string, int, CancellationToken, Task<List<WebSearchResultDto>>> Search)[]
        {
            ("ddg", TryDuckDuckGoAsync),
            ("bing", TryBingAsync),
        };

        foreach (var (name, search) in sources)
        {
            if (InCooldown(name))
            {
                _logger.LogDebug("搜索源 {Source} 冷却中，跳过", name);
                continue;
            }

            var raw = await search(query, maxResults, cancellationToken);
            var results = DedupeAndFilter(raw, maxResults, query);
            if (results.Count > 0) return results;

            // 无结果或全部不相关（限流验证页/降质缓存页）：冷却该源，换下一个
            MarkCooldown(name);
            _logger.LogDebug("搜索源 {Source} 无有效结果（原始 {Raw} 条），进入冷却：{Query}", name, raw.Count, query);
        }
        return [];
    }

    private static bool InCooldown(string source)
        => SourceCooldown.TryGetValue(source, out var until) && until > DateTime.UtcNow;

    private static void MarkCooldown(string source)
        => SourceCooldown[source] = DateTime.UtcNow.Add(CooldownDuration);

    /* ─────────────── DuckDuckGo HTML ─────────────── */

    private async Task<List<WebSearchResultDto>> TryDuckDuckGoAsync(string query, int maxResults, CancellationToken ct)
    {
        try
        {
            var html = await FetchAsync(string.Format(DdgUrl, Uri.EscapeDataString(query)), ct);
            if (string.IsNullOrEmpty(html)) return [];

            var results = new List<WebSearchResultDto>();

            // 结果链接：class="result__a" href="//duckduckgo.com/l/?uddg=<编码后的真实URL>&rut=..."
            foreach (Match m in Regex.Matches(html,
                @"<a[^>]*class=""[^""]*result__a[^""]*""[^>]*href=""(?<href>[^""]+)""[^>]*>(?<title>.*?)</a>",
                RegexOptions.IgnoreCase | RegexOptions.Singleline))
            {
                if (results.Count >= maxResults) break;
                var url = DecodeDdgRedirect(m.Groups["href"].Value);
                if (string.IsNullOrEmpty(url)) continue;
                results.Add(new WebSearchResultDto
                {
                    Title = DecodeAndStrip(m.Groups["title"].Value),
                    Url = url,
                    Snippet = string.Empty,
                });
            }

            // 摘要：result__snippet，与上面的链接按顺序一一对应
            var snippets = Regex.Matches(html,
                @"<(?:a|div|span)[^>]*class=""[^""]*result__snippet[^""]*""[^>]*>(?<text>.*?)</(?:a|div|span)>",
                RegexOptions.IgnoreCase | RegexOptions.Singleline)
                .Select(x => DecodeAndStrip(x.Groups["text"].Value))
                .ToList();
            for (var i = 0; i < results.Count && i < snippets.Count; i++)
                results[i] = new WebSearchResultDto { Title = results[i].Title, Url = results[i].Url, Snippet = snippets[i] };

            _logger.LogDebug("DuckDuckGo 返回 {Count} 条：{Query}", results.Count, query);
            return results;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "DuckDuckGo 搜索失败：{Query}", query);
            return [];
        }
    }

    private static string? DecodeDdgRedirect(string href)
    {
        var m = Regex.Match(href, @"[?&]uddg=([^&]+)");
        var raw = m.Success ? Uri.UnescapeDataString(m.Groups[1].Value) : href;
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri)) return null;
        return uri.Scheme is "http" or "https" ? uri.ToString() : null;
    }

    /* ─────────────── Bing HTML ─────────────── */

    private async Task<List<WebSearchResultDto>> TryBingAsync(string query, int maxResults, CancellationToken ct)
    {
        try
        {
            var html = await FetchAsync(string.Format(BingUrl, Uri.EscapeDataString(query)), ct);
            if (string.IsNullOrEmpty(html)) return [];

            var results = new List<WebSearchResultDto>();
            foreach (Match m in Regex.Matches(html,
                @"<li[^>]*class=""[^""]*b_algo[^""]*""[^>]*>(?<block>.*?)</li>",
                RegexOptions.IgnoreCase | RegexOptions.Singleline))
            {
                if (results.Count >= maxResults) break;
                var block = m.Groups["block"].Value;

                var link = Regex.Match(block, @"<h2[^>]*>\s*<a[^>]*href=""(?<href>[^""]+)""[^>]*>(?<title>.*?)</a>", RegexOptions.IgnoreCase | RegexOptions.Singleline);
                if (!link.Success) continue;

                var snippet = Regex.Match(block, @"<p[^>]*class=""[^""]*b_lineclamp[^""]*""[^>]*>(?<text>.*?)</p>", RegexOptions.IgnoreCase | RegexOptions.Singleline);
                if (!snippet.Success)
                    snippet = Regex.Match(block, @"<p[^>]*>(?<text>.*?)</p>", RegexOptions.IgnoreCase | RegexOptions.Singleline);

                var url = link.Groups["href"].Value;
                if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")) continue;

                results.Add(new WebSearchResultDto
                {
                    Title = DecodeAndStrip(link.Groups["title"].Value),
                    Url = uri.ToString(),
                    Snippet = snippet.Success ? DecodeAndStrip(snippet.Groups["text"].Value) : string.Empty,
                });
            }

            _logger.LogDebug("Bing 返回 {Count} 条：{Query}", results.Count, query);
            return results;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Bing 搜索失败：{Query}", query);
            return [];
        }
    }

    /* ─────────────── 公共 ─────────────── */

    private async Task<string?> FetchAsync(string url, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Add("User-Agent", BrowserUA);
        request.Headers.Add("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");

        using var response = await _httpClient.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogDebug("搜索源返回 {Status}：{Url}", (int)response.StatusCode, url);
            return null;
        }
        return await response.Content.ReadAsStringAsync(ct);
    }

    /// <summary>去重 + 过滤低质量结果（内容农场/空摘要/与查询不相关）</summary>
    private static List<WebSearchResultDto> DedupeAndFilter(List<WebSearchResultDto> results, int maxResults, string query)
    {
        var seenUrls = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var seenTitles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var queryTokens = Tokenize(query);
        var output = new List<WebSearchResultDto>();

        foreach (var r in results)
        {
            if (output.Count >= maxResults) break;
            if (string.IsNullOrWhiteSpace(r.Title) || string.IsNullOrWhiteSpace(r.Url)) continue;

            var title = r.Title.Trim();
            var snippet = (r.Snippet ?? string.Empty).Trim();
            if (snippet.Length > 300) snippet = snippet[..300];

            // 过滤：标题关键词堆砌 / 摘要过短无信息量
            if (title.Length > 90) continue;
            if (snippet.Length is > 0 and < 15) continue;

            // 相关性过滤：免费源被限流时会返回与查询无关的趋势/缓存页（如查 .NET 返回 Google Drive），
            // 用查询与标题+摘要的词项重叠做 cheap 校验，至少命中一个实词才保留（不含 URL：.net 这类短词会误命中域名）
            if (queryTokens.Count > 0 && !HasTokenOverlap(queryTokens, $"{title} {snippet}")) continue;

            var urlKey = NormalizeUrl(r.Url);
            if (!seenUrls.Add(urlKey)) continue;
            if (!seenTitles.Add(title.ToLowerInvariant())) continue;

            output.Add(new WebSearchResultDto { Title = title, Url = r.Url, Snippet = snippet });
        }
        return output;
    }

    /// <summary>中文虚词字：二元组两字均为虚词时无区分度（如"有哪/现在/了吗"会撞上任意中文句子）</summary>
    private static readonly HashSet<char> ZhFunctionChars =
        "的了是有哪这那什吗呢吧啊嗯呀哦嘛么些于以外我你他她它们咱都也就还很非常个上下之与和或及被把让给对从到去来说想问请再见再又还没不很太过得着啦为以可会能将曾".ToHashSet();

    /// <summary>
    /// 查询词项：拉丁词按非字母数字切分（长度≥2且含字母），中文取二元组并过滤虚词二元组。
    /// 中文单字信号太弱（任意中文句子都会撞字），必须用二元组。
    /// </summary>
    private static List<string> Tokenize(string text)
    {
        var tokens = new List<string>();
        var parts = text.ToLowerInvariant().Split(
            new[] { ' ', ',', '，', '。', '?', '？', '!', '！', ';', '；', '/', '\\', '\t', '\n', '\r', '、', '|' },
            StringSplitOptions.RemoveEmptyEntries);

        foreach (var part in parts)
        {
            var cleaned = new string(part.Where(char.IsLetterOrDigit).ToArray());
            if (cleaned.Length == 0) continue;

            if (cleaned.Any(c => c >= 0x4E00 && c <= 0x9FFF))
            {
                // 中文二元组（不足两字或两字均为虚词则舍弃）
                for (var i = 0; i + 1 < cleaned.Length; i++)
                {
                    var a = cleaned[i];
                    var b = cleaned[i + 1];
                    if (a < 0x4E00 || a > 0x9FFF || b < 0x4E00 || b > 0x9FFF) continue;
                    if (ZhFunctionChars.Contains(a) && ZhFunctionChars.Contains(b)) continue;
                    tokens.Add($"{a}{b}");
                }
            }
            else if (cleaned.Length >= 3 && cleaned.Any(char.IsLetter))
            {
                // 短拉丁词（ga/ai 之类）易误命中，要求至少 3 字符
                tokens.Add(cleaned);
            }
        }
        return tokens.Distinct(StringComparer.Ordinal).ToList();
    }

    private static bool HasTokenOverlap(List<string> queryTokens, string text)
    {
        var lower = text.ToLowerInvariant();
        foreach (var t in queryTokens)
        {
            if (t.Any(c => c >= 0x4E00 && c <= 0x9FFF))
            {
                // 中文二元组：直接包含即可
                if (lower.Contains(t, StringComparison.Ordinal)) return true;
            }
            else
            {
                // 拉丁词：按词边界匹配，避免 net 命中 internet、ga 命中 gang
                var escaped = System.Text.RegularExpressions.Regex.Escape(t);
                if (System.Text.RegularExpressions.Regex.IsMatch(lower, $@"(?<![a-z0-9]){escaped}(?![a-z0-9])")) return true;
            }
        }
        return false;
    }

    private static string NormalizeUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return url;
        var host = uri.Host.StartsWith("www.", StringComparison.OrdinalIgnoreCase) ? uri.Host[4..] : uri.Host;
        var path = uri.AbsolutePath.TrimEnd('/');
        return $"{host}{path}{uri.Query}";
    }

    private static string DecodeAndStrip(string html)
    {
        var text = Regex.Replace(html, "<[^>]+>", " ");
        text = System.Net.WebUtility.HtmlDecode(text);
        return Regex.Replace(text, @"\s+", " ").Trim();
    }
}
