using Microsoft.AspNetCore.Http;

namespace Hetu.Core.Utilities;

/// <summary>SSE 流式响应的公共头设置。</summary>
public static class SseResponseExtensions
{
    /// <summary>把响应标记为 SSE 流：设置 Content-Type 并关闭缓存与连接复用。</summary>
    public static void StartSseStream(this HttpResponse response)
    {
        response.ContentType = "text/event-stream";
        response.Headers.CacheControl = "no-cache";
        response.Headers.Connection = "keep-alive";
    }
}
