using System.Runtime.CompilerServices;
using System.Text;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;
using Hetu.Shared.Notes;

namespace Hetu.Core.Services;

public class ChatOrganizeService : IChatOrganizeService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILLMProviderFactory _llmProviderFactory;
    private readonly INoteService _noteService;

    public ChatOrganizeService(IUnitOfWork unitOfWork, ILLMProviderFactory llmProviderFactory, INoteService noteService)
    {
        _unitOfWork = unitOfWork;
        _llmProviderFactory = llmProviderFactory;
        _noteService = noteService;
    }

    public async IAsyncEnumerable<string> OrganizeTopicAsync(
        Guid topicId,
        OrganizeTopicRequest request,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var topic = await _unitOfWork.ChatTopics.GetByIdAsync(topicId, cancellationToken);
        if (topic == null)
        {
            yield return "[ERROR] 话题不存在";
            yield break;
        }

        var messages = (await _unitOfWork.ChatMessages.FindAsync(m => m.TopicId == topicId, cancellationToken))
            .OrderBy(m => m.CreatedAt)
            .ToList();

        if (messages.Count == 0)
        {
            yield return "[ERROR] 话题中没有消息，无法整理";
            yield break;
        }

        var provider = await _llmProviderFactory.CreateChatProviderAsync(cancellationToken);
        if (provider == null)
        {
            yield return "[ERROR] 未找到可用的对话模型，请先在设置中配置 AI Provider 和 Model";
            yield break;
        }

        var prompt = BuildOrganizePrompt(messages, request.Style, request.CustomPrompt);
        var options = new ChatOptions
        {
            ModelId = string.Empty,
            SystemPrompt = "你是知识整理助手，擅长将对话内容整理为结构清晰、要点突出的 Markdown 笔记。",
            Stream = true
        };

        var sb = new StringBuilder();
        await foreach (var delta in provider.ChatStreamAsync(
            [new LlmChatMessage { Role = "user", Content = prompt }],
            options,
            cancellationToken))
        {
            yield return delta;

            // 解析结构化事件，只提取 content 文本存入笔记
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(delta);
                if (doc.RootElement.TryGetProperty("type", out var typeEl) &&
                    doc.RootElement.TryGetProperty("text", out var textEl))
                {
                    if (typeEl.GetString() == "content")
                        sb.Append(textEl.GetString());
                }
                else
                {
                    sb.Append(delta);
                }
            }
            catch
            {
                // 非 JSON，直接追加
                sb.Append(delta);
            }
        }

        var organizedContent = sb.ToString().Trim();
        var title = ExtractTitle(organizedContent) ?? $"{topic.Title} 整理";

        var createResult = await _noteService.CreateAsync(new CreateNoteRequest
        {
            Title = title,
            Content = organizedContent,
            NotebookId = request.NotebookId
        }, cancellationToken);

        if (!createResult.Success)
        {
            yield return $"\n[ERROR] 保存笔记失败：{createResult.Error}";
            yield break;
        }

        // 更新话题笔记同步状态为已整理
        topic.NoteSyncStatus = NoteSyncStatus.Synced;
        await _unitOfWork.ChatTopics.UpdateAsync(topic);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        yield return $"\n[DONE]{createResult.Data!.Id}";
    }

    private static string BuildOrganizePrompt(List<ChatMessage> messages, string style, string? customPrompt)
    {
        var conversation = string.Join("\n\n", messages.Select(m => $"## {m.Role}\n\n{m.Content}"));

        var styleInstruction = style.ToLowerInvariant() switch
        {
            "detailed" => "请整理为详细式笔记：保留完整信息，分章节组织，结构清晰。",
            "qna" => "请整理为 Q&A 问答式笔记：将对话改写为问答形式。",
            "custom" when !string.IsNullOrWhiteSpace(customPrompt) => customPrompt,
            _ => "请整理为摘要式笔记：提炼要点，精简到 500 字以内。"
        };

        return $"{styleInstruction}\n\n请直接输出 Markdown 格式的笔记内容，第一行使用 # 标题。\n\n对话内容：\n\n{conversation}";
    }

    private static string? ExtractTitle(string content)
    {
        var lines = content.Split('\n');
        var firstLine = lines.FirstOrDefault(l => !string.IsNullOrWhiteSpace(l));
        if (firstLine == null) return null;

        firstLine = firstLine.Trim();
        if (firstLine.StartsWith("# "))
            return firstLine[2..].Trim();
        if (firstLine.StartsWith("#"))
            return firstLine.TrimStart('#').Trim();

        return null;
    }
}
