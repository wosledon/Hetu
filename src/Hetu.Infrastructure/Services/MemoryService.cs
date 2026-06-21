using System.Data;
using System.Text;
using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Infrastructure.Data;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Hetu.Infrastructure.Services;

public class MemoryService : IMemoryService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IEmbeddingProviderFactory _embeddingProviderFactory;
    private readonly ILLMProviderFactory _llmProviderFactory;
    private readonly HetuDbContext _dbContext;

    // 回归权重参数
    private const double Alpha = 0.4;   // 语义相似度权重
    private const double Beta = 0.3;    // 重要性权重
    private const double Gamma = 0.2;   // 时间衰减权重
    private const double Delta = 0.1;   // 访问频率权重
    private const double DecayLambda = 0.05; // 指数衰减系数（天）

    // 自动提取阈值：每 N 条用户消息提取一次
    private const int AutoExtractInterval = 10;
    // 时间触发阈值（分钟）：距上次提取超过此时间触发
    private const int TimeTriggerMinutes = 30;

    public MemoryService(
        IUnitOfWork unitOfWork,
        IEmbeddingProviderFactory embeddingProviderFactory,
        ILLMProviderFactory llmProviderFactory,
        HetuDbContext dbContext)
    {
        _unitOfWork = unitOfWork;
        _embeddingProviderFactory = embeddingProviderFactory;
        _llmProviderFactory = llmProviderFactory;
        _dbContext = dbContext;
    }

    public async Task<ApiResponse<PagedResult<MemoryDto>>> GetAllAsync(int page = 1, int pageSize = 50, CancellationToken cancellationToken = default)
    {
        var all = await _unitOfWork.Memories.FindAsync(m => !m.IsDeleted, cancellationToken);
        var totalCount = all.Count;
        var items = all
            .OrderByDescending(m => m.LastAccessedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(MapToDto)
            .ToList();

        return ApiResponse<PagedResult<MemoryDto>>.Ok(new PagedResult<MemoryDto>
        {
            Items = items,
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize
        });
    }

    public async Task<ApiResponse<List<MemoryDto>>> SearchAsync(string query, int topK = 10, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(query))
            return ApiResponse<List<MemoryDto>>.Ok([]);

        var results = await SearchWithScoreAsync(query, topK, cancellationToken);
        return ApiResponse<List<MemoryDto>>.Ok(results);
    }

    public async Task<ApiResponse<MemoryDto>> CreateAsync(CreateMemoryRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Content))
            return ApiResponse<MemoryDto>.Fail("记忆内容不能为空");

        var memory = new Memory
        {
            Id = Guid.NewGuid(),
            Content = request.Content.Trim(),
            Source = "manual",
            Category = request.Category,
            Importance = Math.Clamp(request.Importance, 0f, 1f),
            LastAccessedAt = DateTimeOffset.UtcNow,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.Memories.AddAsync(memory, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 生成并存储 embedding
        await EmbedAndStoreAsync(memory, cancellationToken);

        return ApiResponse<MemoryDto>.Ok(MapToDto(memory));
    }

    public async Task<ApiResponse<MemoryDto>> UpdateAsync(Guid id, UpdateMemoryRequest request, CancellationToken cancellationToken = default)
    {
        var memory = await _unitOfWork.Memories.GetByIdAsync(id, cancellationToken);
        if (memory == null || memory.IsDeleted)
            return ApiResponse<MemoryDto>.Fail("记忆不存在");

        memory.Content = request.Content.Trim();
        memory.Category = request.Category;
        memory.Importance = Math.Clamp(request.Importance, 0f, 1f);
        memory.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 内容变更，重新生成 embedding
        await EmbedAndStoreAsync(memory, cancellationToken);

        return ApiResponse<MemoryDto>.Ok(MapToDto(memory));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var memory = await _unitOfWork.Memories.GetByIdAsync(id, cancellationToken);
        if (memory == null)
            return ApiResponse.Fail("记忆不存在");

        memory.IsDeleted = true;
        memory.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return ApiResponse.Ok();
    }

    public async Task<ApiResponse<List<MemoryDto>>> ExtractFromConversationAsync(Guid topicId, CancellationToken cancellationToken = default)
    {
        // 获取话题历史消息
        var history = await _unitOfWork.ChatMessages.FindAsync(m => m.TopicId == topicId, cancellationToken);
        var messages = history.OrderBy(m => m.CreatedAt).ToList();

        if (messages.Count < 2)
            return ApiResponse<List<MemoryDto>>.Ok([]);

        // 使用快速模型提取事实
        var provider = await CreateFastProviderAsync(cancellationToken);
        if (provider == null)
            return ApiResponse<List<MemoryDto>>.Fail("未配置快速模型，无法提取记忆");

        var conversationText = new StringBuilder();
        foreach (var msg in messages.TakeLast(20)) // 最多取最近20条
        {
            var role = msg.Role == "user" ? "用户" : "助手";
            conversationText.AppendLine($"{role}: {msg.Content}");
        }

        var extractPrompt = $""""
你是一个记忆提取助手。请从以下对话中提取关键事实和用户偏好，用于长期记忆存储。

规则：
1. 提取用户明确表达的偏好、习惯、身份信息、重要事实
2. 每条记忆应该是一个独立的、完整的事实
3. 为每条记忆评估重要性（0-1），其中：
   - 0.9-1.0: 核心身份信息、关键偏好
   - 0.7-0.8: 重要习惯、明确需求
   - 0.5-0.6: 一般性事实
   - 0.3-0.4: 次要信息
4. 尽量去重，与已有记忆合并
5. 返回 JSON 数组格式

对话内容：
{conversationText}

请返回 JSON 数组，每项包含 content（事实文本）、importance（重要性 0-1）、category（类别，如"偏好"/"身份"/"工作"/"习惯"等）。
如果没有值得记忆的内容，返回空数组 []。
只返回 JSON，不要其他文字。
"""";

        try
        {
            var chatMessages = new List<LlmChatMessage>
            {
                new() { Role = "user", Content = extractPrompt }
            };
            var options = new ChatOptions { Stream = false, Temperature = 0.3 };

            var response = await provider.ChatAsync(chatMessages, options, cancellationToken);
            var responseText = response.Trim();

            // 尝试提取 JSON 部分
            var jsonStart = responseText.IndexOf('[');
            var jsonEnd = responseText.LastIndexOf(']');
            if (jsonStart >= 0 && jsonEnd > jsonStart)
            {
                responseText = responseText[jsonStart..(jsonEnd + 1)];
            }

            var extracted = JsonSerializer.Deserialize<List<ExtractedFact>>(responseText,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            if (extracted == null || extracted.Count == 0)
                return ApiResponse<List<MemoryDto>>.Ok([]);

            var createdMemories = new List<MemoryDto>();
            foreach (var fact in extracted)
            {
                if (string.IsNullOrWhiteSpace(fact.Content)) continue;

                // 检查是否与已有记忆重复
                var existing = await FindSimilarMemoryAsync(fact.Content, 0.9, cancellationToken);
                if (existing != null)
                {
                    // 更新已有记忆的访问时间
                    existing.LastAccessedAt = DateTimeOffset.UtcNow;
                    existing.AccessCount++;
                    createdMemories.Add(MapToDto(existing));
                    continue;
                }

                var memory = new Memory
                {
                    Id = Guid.NewGuid(),
                    Content = fact.Content.Trim(),
                    Source = "conversation",
                    TopicId = topicId,
                    Category = fact.Category,
                    Importance = Math.Clamp(fact.Importance, 0.1f, 1f),
                    LastAccessedAt = DateTimeOffset.UtcNow,
                    CreatedAt = DateTimeOffset.UtcNow,
                    UpdatedAt = DateTimeOffset.UtcNow
                };

                await _unitOfWork.Memories.AddAsync(memory, cancellationToken);
                await _unitOfWork.SaveChangesAsync(cancellationToken);
                await EmbedAndStoreAsync(memory, cancellationToken);

                createdMemories.Add(MapToDto(memory));
            }

            return ApiResponse<List<MemoryDto>>.Ok(createdMemories);
        }
        catch (Exception ex)
        {
            return ApiResponse<List<MemoryDto>>.Fail($"记忆提取失败：{ex.Message}");
        }
    }

    public async Task<List<MemoryDto>> TryAutoExtractAsync(Guid topicId, CancellationToken cancellationToken = default)
    {
        // 统计该话题的用户消息数
        var userMessages = await _unitOfWork.ChatMessages.FindAsync(
            m => m.TopicId == topicId && m.Role == "user", cancellationToken);
        var allMessages = userMessages.OrderBy(m => m.CreatedAt).ToList();
        var totalCount = allMessages.Count;

        if (totalCount == 0)
            return [];

        // 获取该话题最近一次提取的时间和提取时的消息数
        var lastMemory = (await _unitOfWork.Memories.FindAsync(
            m => m.TopicId == topicId && m.Source == "conversation", cancellationToken))
            .OrderByDescending(m => m.CreatedAt)
            .FirstOrDefault();

        var lastExtractTime = lastMemory?.CreatedAt ?? DateTimeOffset.MinValue;
        var messagesSinceLastExtract = lastMemory == null
            ? totalCount
            : allMessages.Count(m => m.CreatedAt > lastExtractTime);

        // ── 多信号触发算法 ──
        var now = DateTimeOffset.UtcNow;
        var minutesSinceLastExtract = (now - lastExtractTime).TotalMinutes;

        // 信号 1: 消息数阈值（常规触发）
        var countTrigger = messagesSinceLastExtract >= AutoExtractInterval;

        // 信号 2: 时间阈值（长时间对话触发）
        var timeTrigger = minutesSinceLastExtract >= TimeTriggerMinutes && messagesSinceLastExtract >= 3;

        // 信号 3: 信息密度触发（最近消息内容较长，说明有实质内容）
        var recentMessages = allMessages.TakeLast(3).ToList();
        var avgLength = recentMessages.Average(m => m.Content?.Length ?? 0);
        var densityTrigger = messagesSinceLastExtract >= 5 && avgLength > 200;

        // 任一信号触发即可
        if (!countTrigger && !timeTrigger && !densityTrigger)
            return [];

        var result = await ExtractFromConversationAsync(topicId, cancellationToken);
        return result.Success ? result.Data ?? [] : [];
    }

    public async Task<List<MemoryDto>> RetrieveForContextAsync(string query, int topK = 5, CancellationToken cancellationToken = default)
    {
        return await SearchWithScoreAsync(query, topK, cancellationToken);
    }

    // ── 私有方法 ────────────────────────────────────────

    /// <summary>
    /// 语义搜索 + 回归权重评分
    /// Score = α × similarity + β × importance + γ × recency_decay + δ × access_frequency
    /// </summary>
    private async Task<List<MemoryDto>> SearchWithScoreAsync(string query, int topK, CancellationToken cancellationToken)
    {
        var embeddingProvider = await _embeddingProviderFactory.CreateEmbeddingProviderAsync(cancellationToken);
        if (embeddingProvider == null)
            return [];

        float[] queryEmbedding;
        try
        {
            queryEmbedding = await embeddingProvider.EmbedAsync(query.Trim(), cancellationToken);
        }
        catch
        {
            return [];
        }

        // 从 vec 表中获取最近邻（多取一些，后续用回归权重重排序）
        var candidateCount = topK * 3;
        var candidates = await SearchVecMemoryEmbeddingsAsync(queryEmbedding, candidateCount, cancellationToken);

        if (candidates.Count == 0)
            return [];

        var now = DateTimeOffset.UtcNow;
        var memoryIds = candidates.Select(c => c.MemoryId).ToList();
        var memories = await _unitOfWork.Memories.FindAsync(m => memoryIds.Contains(m.Id), cancellationToken);
        var memoryDict = memories.ToDictionary(m => m.Id);

        var scored = new List<(Memory Memory, double Score, double Similarity)>();
        foreach (var (memoryId, similarity) in candidates)
        {
            if (!memoryDict.TryGetValue(memoryId, out var memory)) continue;

            var daysSinceAccess = (now - memory.LastAccessedAt).TotalDays;
            var recencyDecay = Math.Exp(-DecayLambda * daysSinceAccess);
            var accessFreq = Math.Log(1 + memory.AccessCount) / Math.Log(1 + 50); // 归一化，50次为上限

            var score = Alpha * similarity
                       + Beta * memory.Importance
                       + Gamma * recencyDecay
                       + Delta * accessFreq;

            scored.Add((memory, score, similarity));
        }

        // 按综合得分排序，取 topK
        var result = scored
            .OrderByDescending(x => x.Score)
            .Take(topK)
            .Select(x =>
            {
                // 更新访问时间
                x.Memory.LastAccessedAt = now;
                x.Memory.AccessCount++;
                var dto = MapToDto(x.Memory);
                dto.Score = x.Score;
                return dto;
            })
            .ToList();

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return result;
    }

    private async Task<List<(Guid MemoryId, double Similarity)>> SearchVecMemoryEmbeddingsAsync(float[] queryEmbedding, int topK, CancellationToken cancellationToken)
    {
        var results = new List<(Guid, double)>();

        if (_dbContext.Database.IsSqlite())
        {
            try
            {
                results = await SearchMemoryVecAsync(queryEmbedding, topK, cancellationToken);
                if (results.Count > 0) return results;
            }
            catch
            {
                // vec 扩展不可用，回退到内存计算
            }

            // 回退：内存计算余弦相似度
            return await SearchMemoryInMemoryAsync(queryEmbedding, topK, cancellationToken);
        }

        // PostgreSQL: 使用 pgvector
        return await SearchMemoryPostgresAsync(queryEmbedding, topK, cancellationToken);
    }

    private async Task<List<(Guid, double)>> SearchMemoryVecAsync(float[] queryEmbedding, int topK, CancellationToken cancellationToken)
    {
        var results = new List<(Guid, double)>();
        var queryBytes = FloatArrayToBytes(queryEmbedding);

        await using var connection = _dbContext.Database.GetDbConnection();
        if (connection.State != ConnectionState.Open)
            await connection.OpenAsync(cancellationToken);

        await using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT memory_id, distance
            FROM vec_memory_embeddings
            WHERE embedding MATCH @query
            ORDER BY distance
            LIMIT @k";
        var param = cmd.CreateParameter();
        param.ParameterName = "@query";
        param.Value = queryBytes;
        cmd.Parameters.Add(param);
        var kParam = cmd.CreateParameter();
        kParam.ParameterName = "@k";
        kParam.Value = topK;
        cmd.Parameters.Add(kParam);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var id = reader.GetGuid(0);
            var distance = reader.GetDouble(1);
            var similarity = 1.0 - distance; // vec0 返回 L2 距离，转为相似度
            results.Add((id, Math.Max(0, similarity)));
        }

        return results;
    }

    private async Task<List<(Guid, double)>> SearchMemoryInMemoryAsync(float[] queryEmbedding, int topK, CancellationToken cancellationToken)
    {
        var allEmbeddings = await _unitOfWork.MemoryEmbeddings.GetAllAsync(cancellationToken);
        var results = new List<(Guid, double)>();

        foreach (var emb in allEmbeddings)
        {
            if (emb.Embedding == null || emb.Embedding.Length == 0) continue;
            var embedding = BytesToFloatArray(emb.Embedding);
            var similarity = CosineSimilarity(queryEmbedding, embedding);
            results.Add((emb.MemoryId, similarity));
        }

        return results.OrderByDescending(x => x.Item2).Take(topK).ToList();
    }

    private async Task<List<(Guid, double)>> SearchMemoryPostgresAsync(float[] queryEmbedding, int topK, CancellationToken cancellationToken)
    {
        var results = new List<(Guid, double)>();

        await using var connection = _dbContext.Database.GetDbConnection();
        if (connection.State != ConnectionState.Open)
            await connection.OpenAsync(cancellationToken);

        await using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT ""MemoryId"", 1 - (""Vector"" <=> @query::vector) AS similarity
            FROM ""MemoryEmbeddings""
            ORDER BY ""Vector"" <=> @query::vector
            LIMIT @k";
        var param = cmd.CreateParameter();
        param.ParameterName = "@query";
        param.Value = $"[{string.Join(",", queryEmbedding)}]";
        cmd.Parameters.Add(param);
        var kParam = cmd.CreateParameter();
        kParam.ParameterName = "@k";
        kParam.Value = topK;
        cmd.Parameters.Add(kParam);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var id = reader.GetGuid(0);
            var similarity = reader.GetDouble(1);
            results.Add((id, similarity));
        }

        return results;
    }

    private async Task<Memory?> FindSimilarMemoryAsync(string content, double threshold, CancellationToken cancellationToken)
    {
        var embeddingProvider = await _embeddingProviderFactory.CreateEmbeddingProviderAsync(cancellationToken);
        if (embeddingProvider == null) return null;

        try
        {
            var embedding = await embeddingProvider.EmbedAsync(content.Trim(), cancellationToken);
            var candidates = await SearchVecMemoryEmbeddingsAsync(embedding, 1, cancellationToken);
            if (candidates.Count > 0 && candidates[0].Item2 >= threshold)
            {
                return await _unitOfWork.Memories.GetByIdAsync(candidates[0].Item1, cancellationToken);
            }
        }
        catch
        {
            // embedding 失败时不阻塞
        }

        return null;
    }

    private async Task EmbedAndStoreAsync(Memory memory, CancellationToken cancellationToken)
    {
        var embeddingProvider = await _embeddingProviderFactory.CreateEmbeddingProviderAsync(cancellationToken);
        if (embeddingProvider == null) return;

        try
        {
            var vector = await embeddingProvider.EmbedAsync(memory.Content, cancellationToken);

            // 删除旧的 embedding
            var oldEmbeddings = await _unitOfWork.MemoryEmbeddings.FindAsync(e => e.MemoryId == memory.Id, cancellationToken);
            foreach (var old in oldEmbeddings)
                await _unitOfWork.MemoryEmbeddings.DeleteAsync(old, cancellationToken);

            // 存储新的 embedding
            var memoryEmbedding = new MemoryEmbedding
            {
                Id = Guid.NewGuid(),
                MemoryId = memory.Id,
                Content = memory.Content,
                Embedding = FloatArrayToBytes(vector),
                Vector = vector,
                CreatedAt = DateTimeOffset.UtcNow
            };

            await _unitOfWork.MemoryEmbeddings.AddAsync(memoryEmbedding, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            // 同步到 vec 虚拟表（SQLite）
            if (_dbContext.Database.IsSqlite())
            {
                await SyncToVecTableAsync(memory.Id, vector, cancellationToken);
            }
        }
        catch
        {
            // embedding 存储失败不阻塞主流程
        }
    }

    private async Task SyncToVecTableAsync(Guid memoryId, float[] vector, CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = _dbContext.Database.GetDbConnection();
            if (connection.State != ConnectionState.Open)
                await connection.OpenAsync(cancellationToken);

            var bytes = FloatArrayToBytes(vector);
            await using var cmd = connection.CreateCommand();
            cmd.CommandText = "INSERT OR REPLACE INTO vec_memory_embeddings (memory_id, embedding) VALUES (@id, @embedding)";
            var idParam = cmd.CreateParameter();
            idParam.ParameterName = "@id";
            idParam.Value = memoryId.ToString();
            cmd.Parameters.Add(idParam);
            var embParam = cmd.CreateParameter();
            embParam.ParameterName = "@embedding";
            embParam.Value = bytes;
            cmd.Parameters.Add(embParam);

            await cmd.ExecuteNonQueryAsync(cancellationToken);
        }
        catch
        {
            // vec 表可能不存在
        }
    }

    private async Task<ILLMProvider?> CreateFastProviderAsync(CancellationToken cancellationToken)
    {
        // 优先使用快速模型
        var fastSetting = await _unitOfWork.AppSettings.GetByKeyAsync("DefaultFastModelId", cancellationToken);
        if (!string.IsNullOrWhiteSpace(fastSetting?.Value) && Guid.TryParse(fastSetting.Value, out var fastModelId))
        {
            var provider = await _llmProviderFactory.CreateProviderAsync(fastModelId, cancellationToken);
            if (provider != null) return provider;
        }

        // 回退到默认 chat 模型
        return await _llmProviderFactory.CreateChatProviderAsync(cancellationToken);
    }

    private static MemoryDto MapToDto(Memory m) => new()
    {
        Id = m.Id,
        Content = m.Content,
        Source = m.Source,
        TopicId = m.TopicId,
        Category = m.Category,
        Importance = m.Importance,
        AccessCount = m.AccessCount,
        LastAccessedAt = m.LastAccessedAt,
        CreatedAt = m.CreatedAt,
        UpdatedAt = m.UpdatedAt
    };

    private static byte[] FloatArrayToBytes(float[] floats)
    {
        var bytes = new byte[floats.Length * 4];
        Buffer.BlockCopy(floats, 0, bytes, 0, bytes.Length);
        return bytes;
    }

    private static float[] BytesToFloatArray(byte[] bytes)
    {
        var floats = new float[bytes.Length / 4];
        Buffer.BlockCopy(bytes, 0, floats, 0, bytes.Length);
        return floats;
    }

    private static double CosineSimilarity(float[] a, float[] b)
    {
        if (a.Length != b.Length) return 0;
        double dot = 0, normA = 0, normB = 0;
        for (int i = 0; i < a.Length; i++)
        {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        var denominator = Math.Sqrt(normA) * Math.Sqrt(normB);
        return denominator == 0 ? 0 : dot / denominator;
    }

    private class ExtractedFact
    {
        public string Content { get; set; } = string.Empty;
        public float Importance { get; set; } = 0.5f;
        public string? Category { get; set; }
    }
}
