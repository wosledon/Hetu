using System.Xml;
using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.Services;

public class BingWebSearchService : IWebSearchService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<BingWebSearchService> _logger;
    private const string BingRssUrl = "https://www.bing.com/search?q={0}&format=rss";

    public BingWebSearchService(HttpClient httpClient, ILogger<BingWebSearchService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
    }

    public async Task<List<WebSearchResultDto>> SearchAsync(string query, int maxResults = 5, CancellationToken cancellationToken = default)
    {
        try
        {
            var url = string.Format(BingRssUrl, Uri.EscapeDataString(query));
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            // Mimic a browser to avoid being blocked
            request.Headers.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

            var response = await _httpClient.SendAsync(request, cancellationToken);
            response.EnsureSuccessStatusCode();

            var xml = await response.Content.ReadAsStringAsync(cancellationToken);
            return ParseRss(xml, maxResults);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Bing RSS 搜索失败");
            return [];
        }
    }

    private static List<WebSearchResultDto> ParseRss(string xml, int maxResults)
    {
        var results = new List<WebSearchResultDto>();

        try
        {
            var doc = new XmlDocument();
            doc.LoadXml(xml);

            var items = doc.SelectNodes("//item");
            if (items == null) return results;

            foreach (XmlNode item in items)
            {
                if (results.Count >= maxResults) break;

                var title = item.SelectSingleNode("title")?.InnerText ?? "";
                var link = item.SelectSingleNode("link")?.InnerText ?? "";
                var description = item.SelectSingleNode("description")?.InnerText ?? "";

                // Clean HTML tags from description
                description = System.Text.RegularExpressions.Regex.Replace(description, "<[^>]+>", "").Trim();

                if (!string.IsNullOrWhiteSpace(title) && !string.IsNullOrWhiteSpace(link))
                {
                    results.Add(new WebSearchResultDto
                    {
                        Title = title,
                        Url = link,
                        Snippet = description
                    });
                }
            }
        }
        catch (Exception)
        {
            // XML parse failed
        }

        return results;
    }
}
