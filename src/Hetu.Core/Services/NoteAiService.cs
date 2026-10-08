using System.Runtime.CompilerServices;
using System.Text.Json;
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

        // 模型解析失败（如 API Key 解密失败）也以 [ERROR] 帧返回，避免序列化阶段 500
        ILLMProvider? provider = null;
        string? resolveError = null;
        try
        {
            provider = await GetProviderAsync(request.ModelId, cancellationToken);
        }
        catch (Exception ex)
        {
            resolveError = ex.Message.Split('\n')[0];
        }
        if (resolveError != null)
        {
            yield return $"[ERROR] {resolveError}";
            yield break;
        }
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

        // 逐字输出，异常（如 API Key 解密失败）以 [ERROR] 帧返回，前端可直接展示
        await foreach (var content in StreamContentAsync(provider, prompt, options.SystemPrompt, cancellationToken))
        {
            yield return content;
        }
    }

    /// <summary>
    /// 流式产出正文内容；把过程中的异常转换为 [ERROR] 文本帧，
    /// 避免 IAsyncEnumerable 序列化阶段抛出导致 500 且无可读信息。
    /// </summary>
    private static async IAsyncEnumerable<string> StreamContentAsync(
        ILLMProvider provider,
        string prompt,
        string systemPrompt,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        // 迭代器内 catch 块不能 yield，故把异常先落地为变量、在 try/catch 之外输出
        var stream = provider.ChatStreamAsync(
            [new LlmChatMessage { Role = "user", Content = prompt }],
            new ChatOptions { ModelId = string.Empty, SystemPrompt = systemPrompt },
            cancellationToken);
        await using var enumerator = stream.GetAsyncEnumerator(cancellationToken);
        var yielded = false;

        while (true)
        {
            var moved = false;
            string? next = null;
            string? error = null;
            try
            {
                moved = await enumerator.MoveNextAsync();
                if (moved) next = enumerator.Current;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                error = ex.Message.Split('\n')[0];
            }

            if (error != null)
            {
                // 已输出过内容时把错误附在后面，避免用户丢失已生成的部分
                yield return yielded ? $"\n\n[ERROR] {error}" : $"[ERROR] {error}";
                yield break;
            }
            if (!moved) yield break;

            if (TryExtractContent(next!, out var content) && content.Length > 0)
            {
                yielded = true;
                yield return content;
            }
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

        // 模型解析失败（如 API Key 解密失败）也以 [ERROR] 帧返回，避免序列化阶段 500
        ILLMProvider? provider = null;
        string? resolveError = null;
        try
        {
            provider = await GetProviderAsync(request.ModelId, cancellationToken);
        }
        catch (Exception ex)
        {
            resolveError = ex.Message.Split('\n')[0];
        }
        if (resolveError != null)
        {
            yield return $"[ERROR] {resolveError}";
            yield break;
        }
        if (provider == null)
        {
            yield return "[ERROR] 未找到可用的补全模型";
            yield break;
        }

        var hasCustomPrompt = !string.IsNullOrWhiteSpace(request.SystemPrompt);
        var systemPrompt = hasCustomPrompt
            ? request.SystemPrompt
            : "你是写作助手，擅长根据上下文续写内容。";

        // 强制模型只输出结果文本，不输出任何对话性前后缀；允许按需使用 Markdown 结构组织输出
        systemPrompt += "\n\n【输出要求】只输出处理后的最终文本本身，严格遵守：" +
            "\n1. 不要输出任何解释、前言、引导语或总结建议；" +
            "\n2. 严禁复述或引用笔记标题、题目作为开头；" +
            "\n3. 可以按需使用 Markdown 结构（分节标题、列表、加粗等）组织内容，但不要把多段内容挤在同一行，段落之间用空行分隔；" +
            "\n4. 不要使用代码块包裹；" +
            "\n5. 不要附加评论或建议。";

        string prompt;
        if (hasCustomPrompt)
        {
            // 有自定义指令（润色/翻译/缩写等）：明确区分「待处理文本」与「背景参考」，
            // 避免模型把笔记标题/全文一起输出（替换回编辑器时会整篇被覆盖）
            prompt = string.IsNullOrWhiteSpace(request.SelectedText)
                ? $"【待处理文本】\n标题：{note.Title}\n\n内容：\n{note.Content}"
                : $"【待处理文本】\n{request.SelectedText}\n\n【背景参考，仅供理解语境，禁止出现在输出中】\n标题：{note.Title}\n\n内容：\n{note.Content}";
        }
        else
        {
            // 默认续写
            prompt = string.IsNullOrWhiteSpace(request.SelectedText)
                ? $"请根据以下笔记的上下文进行续写，保持原有风格和主题：\n\n标题：{note.Title}\n\n内容：\n{note.Content}\n\n续写："
                : $"请根据以下笔记内容进行续写或扩展。选中的文本是：\n\n{request.SelectedText}\n\n完整笔记上下文：\n\n标题：{note.Title}\n\n内容：\n{note.Content}\n\n续写：";
        }

        var options = new CompletionOptions
        {
            ModelId = string.Empty,
            SystemPrompt = systemPrompt
        };

        await foreach (var content in StreamContentAsync(provider, prompt, systemPrompt, cancellationToken))
        {
            yield return content;
        }
    }

    /// <summary>
    /// 从 LLM 流式 chunk 中提取正文内容，过滤掉 thinking 等结构化类型。
    /// </summary>
    private static bool TryExtractContent(string chunk, out string content)
    {
        try
        {
            using var doc = JsonDocument.Parse(chunk);
            if (doc.RootElement.TryGetProperty("type", out var typeEl))
            {
                var type = typeEl.GetString();
                // 只返回 content 类型，跳过 thinking 等其他类型
                if (type == "content" && doc.RootElement.TryGetProperty("text", out var textEl))
                {
                    content = textEl.GetString() ?? "";
                    return content.Length > 0;
                }
                content = "";
                return false;
            }
        }
        catch { /* not JSON — treat as plain text */ }

        // Not structured JSON, return as-is
        content = chunk;
        return content.Length > 0;
    }

    private async Task<ILLMProvider?> GetProviderAsync(Guid? modelId, CancellationToken cancellationToken)
    {
        if (modelId.HasValue)
            return await _llmProviderFactory.CreateProviderAsync(modelId.Value, cancellationToken);
        return await _llmProviderFactory.CreateCompletionProviderAsync(cancellationToken)
               ?? await _llmProviderFactory.CreateChatProviderAsync(cancellationToken);
    }
}
