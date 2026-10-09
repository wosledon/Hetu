using System.Text;
using System.Text.Json;
using Hetu.Api.Streaming;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Core.Utilities;
using Hetu.Shared.Chat;
using Hetu.Shared.Notes;
using Serilog;

namespace Hetu.Api.Services;

/// <summary>
/// 对话会话与 Code 会话共用的上下文注入：网络搜索 / 知识库 / 记忆（RAG）、@ 引用之外的多模态图片、深度思考。
/// 注入位置统一为「最后一条用户消息之前」，模型可直接引用。
/// </summary>
public class ChatContextInjector
{
    private readonly IWebSearchService _webSearchService;
    private readonly SearchQueryRewriter _queryRewriter;
    private readonly ISemanticSearchService _semanticSearchService;
    private readonly IMemoryService _memoryService;

    public ChatContextInjector(
        IWebSearchService webSearchService,
        SearchQueryRewriter queryRewriter,
        ISemanticSearchService semanticSearchService,
        IMemoryService memoryService)
    {
        _webSearchService = webSearchService;
        _queryRewriter = queryRewriter;
        _semanticSearchService = semanticSearchService;
        _memoryService = memoryService;
    }

    public sealed record RagResult(string? SearchJson, string? KnowledgeJson, string? MemoryJson);

    /// <summary>按开关注入网络搜索 / 知识库 / 记忆上下文，并通过 SSE 推送检索结果。</summary>
    public async Task<RagResult> InjectRagAsync(
        bool webSearch, bool knowledgeBase, bool memory, string content,
        List<LlmChatMessage> messages, SseStreamWriter writer, ILLMProvider provider, CancellationToken ct)
    {
        string? searchJson = null, kbJson = null, memJson = null;

        if (webSearch)
        {
            // 查询改写：口语化原文直接搜很难命中，先提炼关键词再搜（复用当前会话模型，失败则用原文）
            var queries = await _queryRewriter.RewriteAsync(content ?? string.Empty, provider, ct);

            var merged = new List<WebSearchResultDto>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var q in queries)
            {
                foreach (var r in await _webSearchService.SearchAsync(q, 5, ct))
                {
                    if (seen.Add(r.Url)) merged.Add(r);
                }
                // 免费搜索源有配额限制：首个关键词够用就不再发起更多请求
                if (merged.Count >= 5) break;
            }
            var results = merged.Take(5).ToList();

            if (results.Count > 0)
            {
                await writer.WriteJsonAsync(new { type = "search_results", results });
                searchJson = JsonSerializer.Serialize(results, JsonDefaults.CamelCase);
                messages.Insert(messages.Count - 1, new LlmChatMessage { Role = "user", Content = BuildSearchContext(results) });
            }
        }

        if (knowledgeBase)
        {
            try
            {
                var kbResult = await _semanticSearchService.SearchAsync(content, 5, ct);
                if (kbResult.Success && kbResult.Data?.Items?.Count > 0)
                {
                    var items = kbResult.Data.Items;
                    await writer.WriteJsonAsync(new { type = "knowledge_results", results = items.Select(r => new { r.Title, r.ContentSnippet, r.Id }) });
                    kbJson = JsonSerializer.Serialize(items.Select(r => new { r.Title, r.ContentSnippet, r.Id }), JsonDefaults.CamelCase);
                    messages.Insert(messages.Count - 1, new LlmChatMessage { Role = "user", Content = BuildKnowledgeContext(items) });
                }
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "[Context] 知识库检索失败");
            }
        }

        if (memory)
        {
            try
            {
                var memories = await _memoryService.RetrieveForContextAsync(content, 5, ct);
                if (memories.Count > 0)
                {
                    await writer.WriteJsonAsync(new { type = "memory_results", results = memories.Select(m => new { m.Id, m.Content, m.Category, m.Score }) });
                    memJson = JsonSerializer.Serialize(memories.Select(m => new { m.Id, m.Content, m.Category, m.Score }), JsonDefaults.CamelCase);
                    messages.Insert(messages.Count - 1, new LlmChatMessage { Role = "user", Content = BuildMemoryContext(memories) });
                }
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "[Context] 记忆检索失败");
            }
        }

        return new RagResult(searchJson, kbJson, memJson);
    }

    /// <summary>把图片附件挂到最后一条用户消息上（视觉模型多模态输入）。</summary>
    public static void AttachImages(List<ImageAttachment>? images, ILLMProvider provider, List<LlmChatMessage> messages)
    {
        if (images is not { Count: > 0 }) return;

        var lastUserIdx = messages.FindLastIndex(m => m.Role == "user");
        if (lastUserIdx < 0) return;

        var parts = new List<LlmContentPart>();
        var existing = messages[lastUserIdx].Content;
        if (!string.IsNullOrWhiteSpace(existing))
            parts.Add(new LlmContentPart { Type = "text", Text = existing });
        foreach (var img in images)
        {
            if (provider.ProviderType == "anthropic")
            {
                var b64 = img.Data.Contains(',') ? img.Data[(img.Data.IndexOf(',') + 1)..] : img.Data;
                parts.Add(new LlmContentPart { Type = "image_url", ImageUrl = b64, MediaType = img.MimeType });
            }
            else
            {
                var uri = img.Data.StartsWith("data:") ? img.Data : $"data:{img.MimeType};base64,{img.Data}";
                parts.Add(new LlmContentPart { Type = "image_url", ImageUrl = uri });
            }
        }
        messages[lastUserIdx] = new LlmChatMessage { Role = "user", Content = existing, ContentParts = parts };
    }

    /// <summary>
    /// 深度思考：tag 模式的模型靠系统提示强制先思考；native 模式由推理强度控制，这里不额外干预。
    /// </summary>
    public static void ApplyDeepThinking(bool deepThinking, string? reasoningMode, ChatOptions options)
    {
        if (!deepThinking) return;
        if (!string.Equals(reasoningMode, "tag", StringComparison.OrdinalIgnoreCase)) return;
        options.SystemPrompt = (options.SystemPrompt ?? string.Empty)
            + "\n\n请在回答前先进行深度思考，展示你的推理过程。使用 <thinking> 标签包裹你的思考过程，然后给出最终回答。";
    }

    private static string BuildSearchContext(List<WebSearchResultDto> results)
    {
        var sb = new StringBuilder("以下是网络搜索的结果，请基于这些信息回答用户的问题：\n\n");
        for (int i = 0; i < results.Count; i++)
            sb.AppendLine($"[{i + 1}] {results[i].Title}\n来源: {results[i].Url}\n摘要: {results[i].Snippet}\n");
        return sb.ToString();
    }

    private static string BuildKnowledgeContext(IReadOnlyList<NoteSearchResultDto> items)
    {
        var sb = new StringBuilder("以下是从知识库中检索到的相关内容：\n\n");
        for (int i = 0; i < items.Count; i++)
            sb.AppendLine($"[{i + 1}] {items[i].Title}\n内容: {items[i].ContentSnippet ?? ""}\n");
        return sb.ToString();
    }

    private static string BuildMemoryContext(List<MemoryDto> memories)
    {
        var sb = new StringBuilder("以下是从你的长期记忆中检索到的相关信息：\n\n");
        foreach (var m in memories)
            sb.AppendLine($"- [{m.Category}] {m.Content}");
        return sb.ToString();
    }
}
