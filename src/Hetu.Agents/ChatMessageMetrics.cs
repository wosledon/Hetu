using Microsoft.Extensions.AI;

namespace Hetu.Agents;

/// <summary>
/// 估算上下文规模时使用的消息字符数：除正文外，把工具参数与工具结果也计入，
/// 避免长工具输出在预算里被当成 0。
/// </summary>
internal static class ChatMessageMetrics
{
    public static long CountChars(IEnumerable<ChatMessage> messages)
    {
        long total = 0;
        foreach (var message in messages) total += CountChars(message);
        return total;
    }

    public static long CountChars(ChatMessage message)
    {
        long total = message.Text.Length;
        foreach (var content in message.Contents)
        {
            total += content switch
            {
                TextReasoningContent reasoning => reasoning.Text.Length,
                FunctionCallContent call => (call.Name?.Length ?? 0)
                                           + (call.Arguments?.Values.Sum(value => value?.ToString()?.Length ?? 0) ?? 0),
                FunctionResultContent result => result.Result?.ToString()?.Length ?? 0,
                _ => 0,
            };
        }
        return total;
    }
}