using System.Text.Json;
using Microsoft.Extensions.AI;

namespace Hetu.Core.Interfaces;

/// <summary>数据库/接口层 LlmChatMessage 与 MEAI ChatMessage 的唯一边界转换。</summary>
public static class ChatMessageConversion
{
    public static List<ChatMessage> ToChatMessages(this IEnumerable<LlmChatMessage> messages)
    {
        var result = new List<ChatMessage>();
        foreach (var message in messages)
        {
            var contents = new List<AIContent>();
            if (!string.IsNullOrWhiteSpace(message.Content))
                contents.Add(new TextContent(message.Content));

            if (message.ContentParts != null)
            {
                foreach (var part in message.ContentParts)
                {
                    if (part.Type is not ("image" or "image_url")) continue;
                    var raw = !string.IsNullOrWhiteSpace(part.Text) ? part.Text : part.ImageUrl;
                    if (string.IsNullOrWhiteSpace(raw)) continue;

                    var mediaType = string.IsNullOrWhiteSpace(part.MediaType) ? "image/png" : part.MediaType;
                    string payload;
                    if (raw.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                    {
                        var comma = raw.IndexOf(',');
                        if (comma < 0) continue;
                        payload = raw[(comma + 1)..];
                        var header = raw[5..comma];
                        var semicolon = header.IndexOf(';');
                        if (semicolon > 0) mediaType = header[..semicolon];
                    }
                    else if (Uri.TryCreate(raw, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https")
                    {
                        contents.Add(new UriContent(uri, mediaType));
                        continue;
                    }
                    else
                    {
                        payload = raw;
                    }

                    try
                    {
                        contents.Add(new DataContent(Convert.FromBase64String(payload), mediaType));
                    }
                    catch (FormatException)
                    {
                        if (Uri.TryCreate(raw, UriKind.Absolute, out var fallback))
                            contents.Add(new UriContent(fallback, mediaType));
                    }
                }
            }

            if (message.ThinkingBlocks != null)
            {
                contents.AddRange(message.ThinkingBlocks.Select(block => new TextReasoningContent(block.Text)
                {
                    ProtectedData = block.Signature,
                }));
            }

            if (message.ToolCalls != null)
            {
                contents.AddRange(message.ToolCalls.Select(call => new FunctionCallContent(
                    call.Id,
                    call.Name,
                    JsonSerializer.Deserialize<Dictionary<string, object?>>(call.Arguments)
                    ?? new Dictionary<string, object?>())));
            }

            if (message.Role == "tool" && !string.IsNullOrWhiteSpace(message.ToolCallId))
                contents.Add(new FunctionResultContent(message.ToolCallId, message.Content));

            var role = message.Role.ToLowerInvariant() switch
            {
                "system" => ChatRole.System,
                "assistant" => ChatRole.Assistant,
                "tool" => ChatRole.Tool,
                _ => ChatRole.User,
            };
            result.Add(new ChatMessage(role, contents));
        }
        return result;
    }

    public static LlmChatMessage ToLlmMessage(this ChatMessage message)
    {
        var toolResult = message.Contents.OfType<FunctionResultContent>().FirstOrDefault();
        var contentParts = message.Contents.OfType<DataContent>()
            .Select(content => new LlmContentPart
            {
                Type = "image",
                Text = Convert.ToBase64String(content.Data.Span),
                MediaType = string.IsNullOrWhiteSpace(content.MediaType) ? "image/png" : content.MediaType,
            })
            .ToList();
        var toolCalls = message.Contents.OfType<FunctionCallContent>()
            .Select(call => new LlmToolCall
            {
                Id = call.CallId,
                Name = call.Name,
                Arguments = JsonSerializer.Serialize(call.Arguments),
            })
            .ToList();
        var thinkingBlocks = message.Contents.OfType<TextReasoningContent>()
            .Select(content => new LlmThinkingBlock
            {
                Text = content.Text,
                Signature = content.ProtectedData,
            })
            .ToList();

        return new LlmChatMessage
        {
            Role = message.Role.Value,
            Content = toolResult != null ? ConvertToolResult(toolResult.Result) : message.Text,
            ContentParts = contentParts.Count > 0 ? contentParts : null,
            ToolCalls = toolCalls.Count > 0 ? toolCalls : null,
            ThinkingBlocks = thinkingBlocks.Count > 0 ? thinkingBlocks : null,
            ToolCallId = toolResult?.CallId,
        };
    }

    public static string ConvertToolResult(object? result) => result switch
    {
        null => string.Empty,
        string text => text,
        _ => JsonSerializer.Serialize(result),
    };
}