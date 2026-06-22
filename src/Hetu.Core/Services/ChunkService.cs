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
                return await ChunkByLLMAsync(note, llm, cancellationToken);
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
                ChunkIndex = i,
                Content = finalChunks[i].Trim(),
                ChunkMethod = "structure",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow
            });
        }

        return chunks;
    }

    public async Task<List<NoteChunk>> ChunkTextAsync(string text, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(text))
            return new List<NoteChunk>();

        // 如果配置了 LLM，让大模型直接理解文档并返回分块+摘要
        var chunkModelId = await GetChunkModelIdAsync(cancellationToken);
        if (!string.IsNullOrWhiteSpace(chunkModelId))
        {
            var llm = await _llmProviderFactory.CreateProviderAsync(Guid.Parse(chunkModelId), cancellationToken);
            if (llm != null)
            {
                try
                {
                    return await LlmChunkAsync(text, llm, cancellationToken);
                }
                catch
                {
                    // LLM 失败时回退到结构化分块
                }
            }
        }

        // 未配置 LLM 或 LLM 不可用：纯物理分块
        return StructureChunkText(text);
    }

    public async Task<List<NoteChunk>> ChunkByLLMAsync(Note note, ILLMProvider llm, CancellationToken cancellationToken = default)
    {
        var content = note.Content;
        if (string.IsNullOrWhiteSpace(content))
            return new List<NoteChunk>();

        try
        {
            return await LlmChunkAsync(content, llm, cancellationToken);
        }
        catch (Exception ex)
        {
            // LLM chunking failed, fall back to structure chunking
            System.Diagnostics.Debug.WriteLine($"[ChunkService] LLM chunking failed, falling back to structure: {ex.Message}");
            return ChunkByStructure(note);
        }
    }

    /// <summary>
    /// 让大模型理解文档，一次性返回结构化的分块+摘要
    /// </summary>
    private async Task<List<NoteChunk>> LlmChunkAsync(string content, ILLMProvider llm, CancellationToken cancellationToken)
    {
        var truncated = content.Length > 12000 ? content[..12000] : content;

        var prompt = $@"请将以下文档进行智能分块，每个分块应是一个完整的语义单元。
对每个分块，同时生成一段简洁的摘要（不超过 100 字）。

请以 JSON 数组格式输出，每个元素包含：
- summary: 分块摘要
- content: 分块原始内容

要求：
1. 每个分块控制在 300-1500 字之间
2. 分块之间尽量不重叠
3. 保持段落/章节的完整性
4. 如果文档较短（< 500 字），可以只返回一个分块

文档内容：
{truncated}

请直接输出 JSON 数组，不要添加其他说明。示例：
[{{""summary"":""摘要内容"",""content"":""分块正文内容""}}]";

        var messages = new List<LlmChatMessage>
        {
            new() { Role = "user", Content = prompt }
        };

        var options = new ChatOptions
        {
            Temperature = 0.3,
            MaxTokens = 4096
        };

        var result = await llm.ChatAsync(messages, options, cancellationToken);
        if (string.IsNullOrWhiteSpace(result))
            return new List<NoteChunk>();

        var chunks = ParseLlmChunks(result.Trim());
        return chunks;
    }

    /// <summary>
    /// 解析 LLM 返回的 JSON 分块结果
    /// </summary>
    private static List<NoteChunk> ParseLlmChunks(string json)
    {
        var chunks = new List<NoteChunk>();

        try
        {
            var jsonStr = json.Trim();

            // Strip markdown code fences: ```json ... ``` or ``` ... ```
            var codeFenceMatch = Regex.Match(jsonStr, @"```(?:json)?\s*\n([\s\S]*?)\n```", RegexOptions.IgnoreCase);
            if (codeFenceMatch.Success)
            {
                jsonStr = codeFenceMatch.Groups[1].Value.Trim();
            }
            else
            {
                // Try to extract just the JSON array with a greedy match
                var arrayMatch = Regex.Match(jsonStr, @"\[[\s\S]*\]");
                if (arrayMatch.Success)
                    jsonStr = arrayMatch.Value;
            }

            var items = JsonSerializer.Deserialize<List<LlmChunkResult>>(jsonStr, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });

            if (items == null || items.Count == 0) return chunks;

            for (int i = 0; i < items.Count; i++)
            {
                var item = items[i];
                if (string.IsNullOrWhiteSpace(item.Content)) continue;

                chunks.Add(new NoteChunk
                {
                    Id = Guid.NewGuid(),
                    ChunkIndex = i,
                    Content = item.Content.Trim(),
                    Summary = string.IsNullOrWhiteSpace(item.Summary) ? null : item.Summary.Trim(),
                    ChunkMethod = "llm",
                    CreatedAt = DateTimeOffset.UtcNow,
                    UpdatedAt = DateTimeOffset.UtcNow
                });
            }
        }
        catch
        {
            // JSON 解析失败
        }

        return chunks;
    }

    /// <summary>
    /// 纯物理结构化分块
    /// </summary>
    private static List<NoteChunk> StructureChunkText(string text)
    {
        var sections = SplitByHeadings(text);
        if (sections.Count <= 1)
            sections = SplitByParagraphs(text);

        var finalChunks = new List<string>();
        foreach (var section in sections)
        {
            if (section.Length <= MaxChunkSize)
                finalChunks.Add(section);
            else
                finalChunks.AddRange(SplitLargeSection(section));
        }
        finalChunks = MergeSmallChunks(finalChunks);

        var chunks = new List<NoteChunk>();
        for (int i = 0; i < finalChunks.Count; i++)
        {
            chunks.Add(new NoteChunk
            {
                Id = Guid.NewGuid(),
                ChunkIndex = i,
                Content = finalChunks[i].Trim(),
                ChunkMethod = "structure",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow
            });
        }

        return chunks;
    }

    private record LlmChunkResult(string? Summary, string? Content);

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
