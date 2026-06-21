using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Notes;

namespace Hetu.Core.Services;

public class ChunkService : IChunkService
{
    private readonly ILLMProviderFactory _llmProviderFactory;
    private readonly IUnitOfWork _unitOfWork;
    private const int MaxChunkSize = 1500;  // 每块最大字符数
    private const int MinChunkSize = 200;   // 每块最小字符数
    private const int OverlapSize = 100;    // 块之间的重叠字符数

    public ChunkService(ILLMProviderFactory llmProviderFactory, IUnitOfWork unitOfWork)
    {
        _llmProviderFactory = llmProviderFactory;
        _unitOfWork = unitOfWork;
    }

    public async Task<List<NoteChunk>> ChunkNoteAsync(Note note, CancellationToken cancellationToken = default)
    {
        // 尝试获取配置的 Chunk 模型
        var chunkModelId = await GetChunkModelIdAsync(cancellationToken);

        if (!string.IsNullOrWhiteSpace(chunkModelId))
        {
            var llm = await _llmProviderFactory.CreateProviderAsync(Guid.Parse(chunkModelId), cancellationToken);
            if (llm != null)
            {
                return await ChunkByLLMAsync(note, llm, chunkModelId, cancellationToken);
            }
        }

        // 没有配置 Chunk 模型或模型不可用，使用结构化分块
        return ChunkByStructure(note);
    }

    public List<NoteChunk> ChunkByStructure(Note note)
    {
        var content = note.Content;
        if (string.IsNullOrWhiteSpace(content))
        {
            return new List<NoteChunk>();
        }

        var chunks = new List<NoteChunk>();
        var sections = SplitByHeadings(content);

        // 如果没有标题结构，按段落拆分
        if (sections.Count <= 1)
        {
            sections = SplitByParagraphs(content);
        }

        // 对过大的段落进一步拆分
        var finalChunks = new List<string>();
        foreach (var section in sections)
        {
            if (section.Length <= MaxChunkSize)
            {
                finalChunks.Add(section);
            }
            else
            {
                finalChunks.AddRange(SplitLargeSection(section));
            }
        }

        // 合并过小的块
        finalChunks = MergeSmallChunks(finalChunks);

        for (int i = 0; i < finalChunks.Count; i++)
        {
            chunks.Add(new NoteChunk
            {
                Id = Guid.NewGuid(),
                NoteId = note.Id,
                ChunkIndex = i,
                Content = finalChunks[i].Trim(),
                ChunkMethod = "structure",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow
            });
        }

        return chunks;
    }

    public async Task<List<NoteChunk>> ChunkByLLMAsync(Note note, ILLMProvider llm, string modelId, CancellationToken cancellationToken = default)
    {
        var content = note.Content;
        if (string.IsNullOrWhiteSpace(content))
        {
            return new List<NoteChunk>();
        }

        // 先用结构化方式做初步分块
        var structureChunks = ChunkByStructure(note);

        // 对每个块使用 LLM 生成摘要
        var chunks = new List<NoteChunk>();
        foreach (var chunk in structureChunks)
        {
            string? summary = null;
            try
            {
                summary = await GenerateSummaryAsync(llm, chunk.Content, modelId, cancellationToken);
            }
            catch
            {
                // LLM 调用失败时跳过摘要
            }

            chunk.Summary = summary;
            chunk.ChunkMethod = "llm";
            chunks.Add(chunk);
        }

        return chunks;
    }

    private async Task<string?> GenerateSummaryAsync(ILLMProvider llm, string content, string modelId, CancellationToken cancellationToken)
    {
        var prompt = @"请对以下文本段落生成一段简洁的摘要（不超过 100 字），保留关键信息，便于后续向量搜索匹配。

原文：
" + content + @"

请直接输出摘要内容，不要添加任何前缀或说明。";

        var messages = new List<LlmChatMessage>
        {
            new() { Role = "user", Content = prompt }
        };

        var options = new ChatOptions
        {
            ModelId = modelId,
            Temperature = 0.3,
            MaxTokens = 200
        };

        var result = await llm.ChatAsync(messages, options, cancellationToken);
        return string.IsNullOrWhiteSpace(result) ? null : result.Trim();
    }

    /// <summary>
    /// 按 Markdown 标题拆分
    /// </summary>
    private static List<string> SplitByHeadings(string content)
    {
        var sections = new List<string>();
        var lines = content.Split('\n');
        var current = new StringBuilder();

        foreach (var line in lines)
        {
            if (Regex.IsMatch(line.TrimStart(), @"^#{1,6}\s+") && current.Length > 0)
            {
                sections.Add(current.ToString().Trim());
                current.Clear();
            }
            current.AppendLine(line);
        }

        if (current.Length > 0)
        {
            sections.Add(current.ToString().Trim());
        }

        return sections.Where(s => !string.IsNullOrWhiteSpace(s)).ToList();
    }

    /// <summary>
    /// 按段落（空行分隔）拆分
    /// </summary>
    private static List<string> SplitByParagraphs(string content)
    {
        var paragraphs = Regex.Split(content, @"\n\s*\n")
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(p => p.Trim())
            .ToList();

        if (paragraphs.Count == 0)
        {
            paragraphs.Add(content);
        }

        return paragraphs;
    }

    /// <summary>
    /// 将过大的段落按句子拆分
    /// </summary>
    private static List<string> SplitLargeSection(string section)
    {
        var chunks = new List<string>();
        var sentences = Regex.Split(section, @"(?<=[。！？.!?\n])\s*")
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .ToList();

        var current = new StringBuilder();
        foreach (var sentence in sentences)
        {
            if (current.Length + sentence.Length > MaxChunkSize && current.Length >= MinChunkSize)
            {
                chunks.Add(current.ToString().Trim());
                // 保留重叠
                var overlap = current.ToString();
                current.Clear();
                if (overlap.Length > OverlapSize)
                {
                    current.Append(overlap[^OverlapSize..]);
                }
            }
            current.Append(sentence);
        }

        if (current.Length > 0)
        {
            chunks.Add(current.ToString().Trim());
        }

        return chunks;
    }

    /// <summary>
    /// 合并过小的块
    /// </summary>
    private static List<string> MergeSmallChunks(List<string> chunks)
    {
        if (chunks.Count <= 1) return chunks;

        var merged = new List<string>();
        var buffer = new StringBuilder();

        foreach (var chunk in chunks)
        {
            if (buffer.Length + chunk.Length < MinChunkSize)
            {
                buffer.AppendLine();
                buffer.Append(chunk);
            }
            else
            {
                if (buffer.Length > 0)
                {
                    merged.Add(buffer.ToString().Trim());
                    buffer.Clear();
                }
                buffer.Append(chunk);
            }
        }

        if (buffer.Length > 0)
        {
            merged.Add(buffer.ToString().Trim());
        }

        return merged;
    }

    private async Task<string?> GetChunkModelIdAsync(CancellationToken cancellationToken)
    {
        var setting = await _unitOfWork.AppSettings.GetByKeyAsync("DefaultChunkModelId", cancellationToken);
        return string.IsNullOrWhiteSpace(setting?.Value) ? null : setting.Value;
    }
}
