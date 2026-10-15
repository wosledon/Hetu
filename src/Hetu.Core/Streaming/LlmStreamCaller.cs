using System.Diagnostics;
using System.Text;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Streaming;

/// <summary>一次流式 LLM 调用的结果：正文、思考（推理模型单独上报时原样带回，供批量调用方自行取舍）、
/// 流结束原因、Provider 上报的用量与耗时。</summary>
public sealed record LlmCallResult(string Content, string? Finish, LlmUsage? Usage, long ElapsedMs, string Thinking = "")
{
    /// <summary>
    /// 取正文：优先 content 通道；模型把整篇答复写进 reasoning_content（content 为空）时，
    /// 用思考通道兜底（调用方需自行清洗思考里的过程性文本）。聊天场景不适用——那里有流内切换。
    /// </summary>
    public string ContentOrThinking()
    {
        if (!string.IsNullOrWhiteSpace(Content)) return Content;
        return Thinking;
    }
}

/// <summary>
/// 统一的单次 SSE 调用：经共享解析器累积正文，取出结束原因（length/max_tokens = 被输出上限截断）、
/// Provider 上报的用量（输出/总计）与延迟，供请求日志与多次续写判断使用。
/// </summary>
public static class LlmStreamCaller
{
    public static async Task<LlmCallResult> CallAsync(
        ILLMProvider provider,
        string prompt,
        string? systemPrompt,
        int? maxTokens,
        CancellationToken cancellationToken)
    {
        var parser = new LlmStreamParser();
        var content = new StringBuilder();
        var thinking = new StringBuilder();
        string? finish = null;
        LlmUsage? usage = null;
        var sw = Stopwatch.StartNew();

        await foreach (var delta in provider.ChatStreamAsync(
            [new LlmChatMessage { Role = "user", Content = prompt }],
            new ChatOptions
            {
                ModelId = string.Empty,
                SystemPrompt = systemPrompt,
                MaxTokens = maxTokens,
                Stream = true,
            },
            cancellationToken))
        {
            foreach (var chunk in parser.Parse(delta))
            {
                if (chunk.Type == LlmStreamEventType.Content) content.Append(chunk.Text);
                else if (chunk.Type == LlmStreamEventType.Thinking) thinking.Append(chunk.Text);
                else if (chunk.Type == LlmStreamEventType.Finish) finish = chunk.Reason;
                else if (chunk.Type == LlmStreamEventType.Usage && chunk.Usage != null) usage = chunk.Usage;
            }
        }
        foreach (var chunk in parser.Flush())
        {
            if (chunk.Type == LlmStreamEventType.Content) content.Append(chunk.Text);
            else if (chunk.Type == LlmStreamEventType.Thinking) thinking.Append(chunk.Text);
        }

        sw.Stop();
        return new LlmCallResult(content.ToString(), finish, usage, sw.ElapsedMilliseconds, thinking.ToString());
    }
}
