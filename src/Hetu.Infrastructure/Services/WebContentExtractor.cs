using System.Text;
using System.Text.RegularExpressions;
using HtmlAgilityPack;

namespace Hetu.Infrastructure.Services;

/// <summary>
/// 网页内容提取服务
/// </summary>
public class WebContentExtractor
{
    private readonly HttpClient _httpClient;

    public WebContentExtractor(HttpClient httpClient)
    {
        _httpClient = httpClient;
        _httpClient.DefaultRequestHeaders.UserAgent.ParseAdd(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        _httpClient.Timeout = TimeSpan.FromSeconds(30);
    }

    /// <summary>
    /// 抓取并提取网页正文
    /// </summary>
    public async Task<WebContentResult> ExtractAsync(string url, CancellationToken cancellationToken = default)
    {
        var result = new WebContentResult { Url = url };

        try
        {
            using var response = await _httpClient.GetAsync(url, cancellationToken);
            response.EnsureSuccessStatusCode();

            var html = await response.Content.ReadAsStringAsync(cancellationToken);
            var doc = new HtmlDocument();
            doc.LoadHtml(html);

            // 提取标题
            result.Title = ExtractTitle(doc, url);

            // 提取正文
            result.Content = ExtractMainContent(doc);

            // 提取元描述
            result.Description = ExtractMetaDescription(doc);
        }
        catch (Exception ex)
        {
            result.Error = ex.Message;
        }

        return result;
    }

    private static string ExtractTitle(HtmlDocument doc, string url)
    {
        // 优先 og:title
        var ogTitle = doc.DocumentNode.SelectSingleNode("//meta[@property='og:title']");
        if (ogTitle != null)
        {
            var content = ogTitle.GetAttributeValue("content", "");
            if (!string.IsNullOrWhiteSpace(content)) return content.Trim();
        }

        // 其次 <title>
        var titleNode = doc.DocumentNode.SelectSingleNode("//title");
        if (titleNode != null)
        {
            var text = titleNode.InnerText.Trim();
            if (!string.IsNullOrWhiteSpace(text)) return text;
        }

        // 最后 h1
        var h1 = doc.DocumentNode.SelectSingleNode("//h1");
        if (h1 != null)
        {
            var text = h1.InnerText.Trim();
            if (!string.IsNullOrWhiteSpace(text)) return text;
        }

        return url;
    }

    private static string ExtractMainContent(HtmlDocument doc)
    {
        // 移除无用标签
        RemoveNodes(doc, "//script");
        RemoveNodes(doc, "//style");
        RemoveNodes(doc, "//nav");
        RemoveNodes(doc, "//header");
        RemoveNodes(doc, "//footer");
        RemoveNodes(doc, "//aside");
        RemoveNodes(doc, "//iframe");
        RemoveNodes(doc, "//noscript");
        RemoveNodes(doc, "//svg");
        RemoveNodes(doc, "//form");
        RemoveNodes(doc, "//button");
        RemoveNodes(doc, "//input");
        RemoveNodes(doc, "//select");

        // 尝试常见正文容器
        var contentNode = FindContentNode(doc);
        if (contentNode == null)
            contentNode = doc.DocumentNode.SelectSingleNode("//body");

        if (contentNode == null) return string.Empty;

        // 提取文本，保留段落结构
        var sb = new StringBuilder();
        ExtractTextWithStructure(contentNode, sb);

        var text = sb.ToString();
        // 清理多余空行
        text = Regex.Replace(text, @"\n{3,}", "\n\n");
        return text.Trim();
    }

    private static HtmlNode? FindContentNode(HtmlDocument doc)
    {
        // 按优先级尝试常见正文容器
        string[] selectors = [
            "//article",
            "//*[contains(@class,'article-content')]",
            "//*[contains(@class,'post-content')]",
            "//*[contains(@class,'entry-content')]",
            "//*[contains(@class,'content')]",
            "//*[contains(@class,'article')]",
            "//*[contains(@class,'post-body')]",
            "//*[contains(@class,'markdown-body')]",
            "//*[contains(@id,'content')]",
            "//*[contains(@id,'article')]",
            "//main",
        ];

        foreach (var selector in selectors)
        {
            var node = doc.DocumentNode.SelectSingleNode(selector);
            if (node != null && node.InnerText.Trim().Length > 200)
                return node;
        }

        // 找文本最长的 div
        var divs = doc.DocumentNode.SelectNodes("//div");
        if (divs != null)
        {
            var best = divs
                .Where(d => !HasBlockParent(d, new[] { "nav", "header", "footer", "aside" }))
                .OrderByDescending(d => d.InnerText.Length)
                .FirstOrDefault();

            if (best != null && best.InnerText.Trim().Length > 200)
                return best;
        }

        return null;
    }

    private static bool HasBlockParent(HtmlNode node, string[] tags)
    {
        var parent = node.ParentNode;
        while (parent != null)
        {
            if (tags.Contains(parent.Name)) return true;
            parent = parent.ParentNode;
        }
        return false;
    }

    private static void ExtractTextWithStructure(HtmlNode node, StringBuilder sb)
    {
        if (node.NodeType == HtmlNodeType.Text)
        {
            var text = node.InnerText;
            if (!string.IsNullOrWhiteSpace(text))
                sb.Append(text);
            return;
        }

        if (node.NodeType != HtmlNodeType.Element) return;

        switch (node.Name.ToLower())
        {
            case "h1":
            case "h2":
            case "h3":
            case "h4":
            case "h5":
            case "h6":
                sb.AppendLine();
                sb.AppendLine();
                var level = int.Parse(node.Name[1..]);
                sb.Append(new string('#', level)).Append(' ');
                foreach (var child in node.ChildNodes)
                    ExtractTextWithStructure(child, sb);
                sb.AppendLine();
                break;

            case "p":
            case "div":
            case "section":
            case "blockquote":
                sb.AppendLine();
                sb.AppendLine();
                foreach (var child in node.ChildNodes)
                    ExtractTextWithStructure(child, sb);
                break;

            case "br":
                sb.AppendLine();
                break;

            case "li":
                sb.AppendLine();
                sb.Append("- ");
                foreach (var child in node.ChildNodes)
                    ExtractTextWithStructure(child, sb);
                break;

            case "pre":
            case "code":
                sb.AppendLine();
                sb.AppendLine("```");
                sb.Append(node.InnerText.Trim());
                sb.AppendLine();
                sb.AppendLine("```");
                break;

            default:
                foreach (var child in node.ChildNodes)
                    ExtractTextWithStructure(child, sb);
                break;
        }
    }

    private static void RemoveNodes(HtmlDocument doc, string xpath)
    {
        var nodes = doc.DocumentNode.SelectNodes(xpath);
        if (nodes == null) return;
        foreach (var node in nodes)
            node.Remove();
    }

    private static string? ExtractMetaDescription(HtmlDocument doc)
    {
        var meta = doc.DocumentNode.SelectSingleNode("//meta[@name='description']")
                ?? doc.DocumentNode.SelectSingleNode("//meta[@property='og:description']");
        return meta?.GetAttributeValue("content", string.Empty);
    }
}

public class WebContentResult
{
    public string Url { get; set; } = string.Empty;
    public string? Title { get; set; }
    public string Content { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Error { get; set; }
    public bool Success => string.IsNullOrEmpty(Error) && !string.IsNullOrWhiteSpace(Content);
}
