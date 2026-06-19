using System.Runtime.CompilerServices;
using Hetu.Core.Interfaces;
using Hetu.Shared.Notes;

namespace Hetu.Core.Services;

public class NoteAiService : INoteAiService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILLMProviderFactory _llmProviderFactory;

    public NoteAiService(IUnitOfWork unitOfWork, ILLMProviderFactory llmProviderFactory)
    {
        _unitOfWork = unitOfWork;
        _llmProviderFactory = llmProviderFactory;
    }

    public async IAsyncEnumerable<string> SummarizeAsync(Guid noteId, NoteAiRequest request, [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var note = await _unitOfWork.Notes.GetByIdAsync(noteId, cancellationToken);
        if (note == null)
        {
            yield return "[ERROR] 笔记不存在";
            yield break;
        }

        var provider = await GetProviderAsync(request.ModelId, cancellationToken);
        if (provider == null)
        {
            yield return "[ERROR] 未找到可用的补全模型";
            yield break;
        }

        var prompt = $"请为以下笔记生成一段简洁的摘要（200字以内）：\n\n标题：{note.Title}\n\n内容：\n{note.Content}";
        var options = new CompletionOptions
        {
            ModelId = string.Empty,
            SystemPrompt = request.SystemPrompt ?? "你是知识整理助手，擅长提炼要点。"
        };

        await foreach (var chunk in provider.ChatStreamAsync(
            [new LlmChatMessage { Role = "user", Content = prompt }],
            new ChatOptions { ModelId = string.Empty, SystemPrompt = options.SystemPrompt },
            cancellationToken))
        {
            yield return chunk;
        }
    }

    public async IAsyncEnumerable<string> ContinueAsync(Guid noteId, ContinueNoteRequest request, [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var note = await _unitOfWork.Notes.GetByIdAsync(noteId, cancellationToken);
        if (note == null)
        {
            yield return "[ERROR] 笔记不存在";
            yield break;
        }

        var provider = await GetProviderAsync(request.ModelId, cancellationToken);
        if (provider == null)
        {
            yield return "[ERROR] 未找到可用的补全模型";
            yield break;
        }

        var prompt = string.IsNullOrWhiteSpace(request.SelectedText)
            ? $"请根据以下笔记的上下文进行续写，保持原有风格和主题：\n\n标题：{note.Title}\n\n内容：\n{note.Content}\n\n续写："
            : $"请根据以下笔记内容进行续写或扩展。选中的文本是：\n\n{request.SelectedText}\n\n完整笔记上下文：\n\n标题：{note.Title}\n\n内容：\n{note.Content}\n\n续写：";

        var options = new CompletionOptions
        {
            ModelId = string.Empty,
            SystemPrompt = request.SystemPrompt ?? "你是写作助手，擅长根据上下文续写内容。"
        };

        await foreach (var chunk in provider.ChatStreamAsync(
            [new LlmChatMessage { Role = "user", Content = prompt }],
            new ChatOptions { ModelId = string.Empty, SystemPrompt = options.SystemPrompt },
            cancellationToken))
        {
            yield return chunk;
        }
    }

    private async Task<ILLMProvider?> GetProviderAsync(Guid? modelId, CancellationToken cancellationToken)
    {
        if (modelId.HasValue)
            return await _llmProviderFactory.CreateProviderAsync(modelId.Value, cancellationToken);
        return await _llmProviderFactory.CreateCompletionProviderAsync(cancellationToken)
               ?? await _llmProviderFactory.CreateChatProviderAsync(cancellationToken);
    }
}
