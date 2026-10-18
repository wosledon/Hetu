using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>
/// 网页应用辅助能力：抓取站点图标（浏览器无法跨域读取目标站点的 favicon 声明，需后端代取）。
/// 网页本身由桌面壳交给系统浏览器以应用模式打开，不再经过 iframe，因此不再探测内嵌响应头。
/// </summary>
[ApiController]
[Route("api/apps")]
public class AppsController : ControllerBase
{
    private const string BrowserUA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

    private static readonly System.Net.Http.HttpClient Http = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = true,
        AutomaticDecompression = System.Net.DecompressionMethods.All,
    })
    {
        Timeout = TimeSpan.FromSeconds(15),
    };

    static AppsController()
    {
        // 带真实浏览器 UA：部分站点对非浏览器客户端返回不同的页面（图标声明也会缺）。
        Http.DefaultRequestHeaders.UserAgent.ParseAdd(BrowserUA);
        Http.DefaultRequestHeaders.Add("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");
        Http.DefaultRequestHeaders.Add("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    }

    /* ─────────────── 站点图标 ─────────────── */

    private const int MaxIconBytes = 512 * 1024;
    private static readonly TimeSpan IconCacheDuration = TimeSpan.FromHours(24);

    /// <summary>图标缓存：成功与失败（空数组）都缓存，避免反复抓取</summary>
    private static readonly Dictionary<string, (byte[] Bytes, string ContentType, DateTime ExpiresAt)> IconCache = new();

    /// <summary>
    /// 取站点图标：解析页面 &lt;link rel="icon"&gt;，找不到再退回 /favicon.ico。
    /// 自建抓取不依赖第三方图标服务，失败时返回 404，前端回退字母头像。
    /// </summary>
    [HttpGet("favicon")]
    public async Task<IActionResult> Favicon([FromQuery] string? url, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(url) ||
            !Uri.TryCreate(url, UriKind.Absolute, out var pageUri) ||
            pageUri.Scheme is not ("http" or "https"))
        {
            return BadRequest();
        }

        var cacheKey = pageUri.Host.ToLowerInvariant();
        lock (IconCache)
        {
            if (IconCache.TryGetValue(cacheKey, out var cached))
            {
                if (cached.ExpiresAt > DateTime.UtcNow)
                    return cached.Bytes.Length == 0 ? NotFound() : File(cached.Bytes, cached.ContentType);
                IconCache.Remove(cacheKey);
            }
        }

        var icon = await FetchIconAsync(pageUri, ct);
        lock (IconCache)
        {
            IconCache[cacheKey] = (icon?.Bytes ?? [], icon?.ContentType ?? "image/x-icon", DateTime.UtcNow.Add(IconCacheDuration));
        }
        return icon == null ? NotFound() : File(icon.Value.Bytes, icon.Value.ContentType);
    }

    private static async Task<(byte[] Bytes, string ContentType)?> FetchIconAsync(Uri pageUri, CancellationToken ct)
    {
        // 1. 解析页面里的 <link rel="icon">，按优先级收集候选
        var candidates = new List<Uri>();
        try
        {
            using var pageResponse = await Http.GetAsync(pageUri, ct);
            if (pageResponse.IsSuccessStatusCode && (pageResponse.Content.Headers.ContentType?.MediaType?.Contains("html") ?? false))
            {
                var html = await pageResponse.Content.ReadAsStringAsync(ct);
                foreach (Match m in Regex.Matches(html,
                    @"<link[^>]+rel=""[^""]*(?:icon|apple-touch-icon)[^""]*""[^>]*>", RegexOptions.IgnoreCase))
                {
                    var href = Regex.Match(m.Value, @"href=""([^""]+)""", RegexOptions.IgnoreCase).Groups[1].Value;
                    if (string.IsNullOrWhiteSpace(href)) continue;
                    if (Uri.TryCreate(pageUri, href, out var iconUri)) candidates.Add(iconUri);
                }
            }
        }
        catch { /* 页面抓取失败时直接用 /favicon.ico */ }

        // apple-touch-icon（通常高分辨率）优先，其次页面 link 顺序
        candidates = candidates
            .OrderByDescending(u => u.AbsolutePath.Contains("apple-touch-icon", StringComparison.OrdinalIgnoreCase))
            .ThenBy(u => u.AbsolutePath.EndsWith(".ico", StringComparison.OrdinalIgnoreCase) ? 1 : 0)
            .ToList();

        // 2. 兜底：站点根目录 favicon.ico
        candidates.Add(new UriBuilder(pageUri.Scheme, pageUri.Host, pageUri.Port, "favicon.ico").Uri);

        foreach (var candidate in candidates.Take(6))
        {
            try
            {
                using var response = await Http.GetAsync(candidate, ct);
                if (!response.IsSuccessStatusCode) continue;
                var mediaType = response.Content.Headers.ContentType?.MediaType ?? "image/x-icon";
                if (!mediaType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)) continue;
                var bytes = await response.Content.ReadAsByteArrayAsync(ct);
                if (bytes.Length == 0 || bytes.Length > MaxIconBytes) continue;
                return (bytes, mediaType);
            }
            catch { /* 候选不可用则试下一个 */ }
        }
        return null;
    }
}
