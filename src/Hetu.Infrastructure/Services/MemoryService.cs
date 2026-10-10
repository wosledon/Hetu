using System.Data;
using System.Text;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Utilities;
using Hetu.Infrastructure.Data;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;
using Hetu.Shared.Settings;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.Services;

public class MemoryService : IMemoryService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IEmbeddingProviderFactory _embeddingProviderFactory;
    private readonly ILLMProviderFactory _llmProviderFactory;
    private readonly IAppSettingService _appSettingService;
    private readonly HetuDbContext _dbContext;
    private readonly ILogger<MemoryService> _logger;

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
        IAppSettingService appSettingService,
        HetuDbContext dbContext,
        ILogger<MemoryService> logger)
    {
        _unitOfWork = unitOfWork;
        _embeddingProviderFactory = embeddingProviderFactory;
        _llmProviderFactory = llmProviderFactory;
        _appSettingService = appSettingService;
        _dbContext = dbContext;
        _logger = logger;
    }

    public async Task<ApiResponse<PagedResult<MemoryDto>>> GetAllAsync(int page = 1, int pageSize = 50, string? scope = null, CancellationToken cancellationToken = default)
    {
        var all = await _unitOfWork.Memories.FindAsync(
            m => !m.IsDeleted && (string.IsNullOrWhiteSpace(scope) || m.Scope == scope),
            cancellationToken);

        // 项目记忆回填项目名，列表直接展示
        var projectIds = all.Where(m => m.ProjectId != null).Select(m => m.ProjectId!.Value).Distinct().ToList();
        var projectNames = projectIds.Count == 0
            ? new Dictionary<Guid, string>()
            : (await _unitOfWork.ManagedProjects.GetAllAsync(cancellationToken))
                .Where(p => projectIds.Contains(p.Id)).ToDictionary(p => p.Id, p => p.Name);

        var totalCount = all.Count;
        var items = all
            .OrderByDescending(m => m.LastAccessedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(m =>
            {
                var dto = MapToDto(m);
                if (m.ProjectId != null) dto.ProjectName = projectNames.GetValueOrDefault(m.ProjectId.Value);
                return dto;
            })
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

        // 管理端搜索：跨全部作用域展示，不做过滤
        var results = await SearchWithScoreAsync(query, topK, null, null, applyScope: false, cancellationToken);
        return ApiResponse<List<MemoryDto>>.Ok(results);
    }

    public async Task<ApiResponse<MemoryDto>> CreateAsync(CreateMemoryRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Content))
            return ApiResponse<MemoryDto>.Fail("记忆内容不能为空");

        var scope = NormalizeScope(request.Scope);
        if (scope == MemoryScopes.Project && request.ProjectId == null)
            return ApiResponse<MemoryDto>.Fail("项目记忆必须指定项目");
        // 会话记忆只能由对话提取产生（需要绑定会话），手动创建不接受
        if (scope == MemoryScopes.Session)
            return ApiResponse<MemoryDto>.Fail("会话记忆由对话自动提取产生，请选择全局或项目作用域");

        var memory = new Memory
        {
            Id = Guid.NewGuid(),
            Content = request.Content.Trim(),
            Source = "manual",
            Scope = scope,
            ProjectId = scope == MemoryScopes.Project ? request.ProjectId : null,
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

        var dto = MapToDto(memory);
        await EnrichProjectNameAsync(dto, cancellationToken);
        return ApiResponse<MemoryDto>.Ok(dto);
    }

    public async Task<ApiResponse<MemoryDto>> UpdateAsync(Guid id, UpdateMemoryRequest request, CancellationToken cancellationToken = default)
    {
        var memory = await _unitOfWork.Memories.GetByIdAsync(id, cancellationToken);
        if (memory == null || memory.IsDeleted)
            return ApiResponse<MemoryDto>.Fail("记忆不存在");

        var scope = NormalizeScope(request.Scope);
        if (scope == MemoryScopes.Project && request.ProjectId == null)
            return ApiResponse<MemoryDto>.Fail("项目记忆必须指定项目");
        if (scope == MemoryScopes.Session && memory.TopicId == null)
            return ApiResponse<MemoryDto>.Fail("该记忆未绑定会话，无法设为会话作用域");

        memory.Content = request.Content.Trim();
        memory.Category = request.Category;
        memory.Importance = Math.Clamp(request.Importance, 0f, 1f);
        memory.Scope = scope;
        memory.ProjectId = scope == MemoryScopes.Project ? request.ProjectId : null;
        // TopicId 保留不清：会话记忆「晋升」为全局后仍可切回会话作用域
        memory.UpdatedAt = DateTimeOffset.UtcNow;

        // GetByIdAsync 走 AsNoTracking，必须显式挂回上下文，否则这些改动 SaveChanges 不会写入
        memory = await _unitOfWork.Memories.UpdateAsync(memory, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 内容变更，重新生成 embedding
        await EmbedAndStoreAsync(memory, cancellationToken);

        var dto = MapToDto(memory);
        await EnrichProjectNameAsync(dto, cancellationToken);
        return ApiResponse<MemoryDto>.Ok(dto);
    }

    /// <summary>项目作用域记忆回填项目名（详情/创建/提取返回体）</summary>
    private async Task EnrichProjectNameAsync(MemoryDto dto, CancellationToken cancellationToken)
    {
        if (dto.ProjectId == null) return;
        var project = await _unitOfWork.ManagedProjects.GetByIdAsync(dto.ProjectId.Value, cancellationToken);
        dto.ProjectName = project?.Name;
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var memory = await _unitOfWork.Memories.GetByIdAsync(id, cancellationToken);
        if (memory == null)
            return ApiResponse.Fail("记忆不存在");

        memory.IsDeleted = true;
        memory.UpdatedAt = DateTimeOffset.UtcNow;
        // 同上：不挂回上下文的话接口会返回 200，但记忆仍在列表里（用户看到「删除失败」）
        await _unitOfWork.Memories.UpdateAsync(memory, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        // 一并清掉向量，避免已删除的记忆还能被语义检索命中
        await RemoveEmbeddingsAsync(memory.Id, cancellationToken);

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

            var extracted = LlmJsonExtractor.Deserialize<List<ExtractedFact>>(response);
            if (extracted == null || extracted.Count == 0)
                return ApiResponse<List<MemoryDto>>.Ok([]);

            var createdMemories = new List<MemoryDto>();
            foreach (var fact in extracted)
            {
                if (string.IsNullOrWhiteSpace(fact.Content)) continue;

                // 检查是否与已有记忆重复（仅吸收同归属的记忆，避免把别的会话/项目的记忆当成同一段）
                var existing = await FindSimilarMemoryAsync(fact.Content, 0.9, cancellationToken);
                if (existing != null && existing.Scope == MemoryScopes.Session && existing.TopicId == topicId)
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
                    // 对话提取的记忆默认归属该会话（Dream 巩固时可与全局/项目记忆合并晋升）
                    Scope = MemoryScopes.Session,
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

    // ── Code 会话（编码会话）→ 项目记忆 ────────────────

    /// <summary>
    /// 触发判定：每累计 10 条用户消息提取一次（取模触发，无需跨会话的水位记录；
    /// 重复内容由「同归属相似度去重」吸收）。
    /// </summary>
    public async Task<List<MemoryDto>> TryAutoExtractWorkAsync(Guid workSessionId, CancellationToken cancellationToken = default)
    {
        var session = await _unitOfWork.WorkSessions.GetByIdAsync(workSessionId, cancellationToken);
        if (session == null) return [];

        // 未关联受管项目的 Code 会话不提取：项目事实写进全局记忆会污染其它上下文
        var project = await _unitOfWork.WorkProjects.GetByIdAsync(session.ProjectId, cancellationToken);
        if (project?.ManagedProjectId == null) return [];

        var userMessages = await _unitOfWork.WorkMessages.FindAsync(
            m => m.SessionId == workSessionId && m.Role == "user", cancellationToken);
        var totalCount = userMessages.Count();
        if (totalCount == 0 || totalCount % AutoExtractInterval != 0) return [];

        var result = await ExtractFromWorkSessionAsync(workSessionId, cancellationToken);
        return result.Success ? result.Data ?? [] : [];
    }

    public async Task<ApiResponse<List<MemoryDto>>> ExtractFromWorkSessionAsync(Guid workSessionId, CancellationToken cancellationToken = default)
    {
        var session = await _unitOfWork.WorkSessions.GetByIdAsync(workSessionId, cancellationToken);
        if (session == null) return ApiResponse<List<MemoryDto>>.Fail("会话不存在");

        var project = await _unitOfWork.WorkProjects.GetByIdAsync(session.ProjectId, cancellationToken);
        var managedProjectId = project?.ManagedProjectId;
        if (managedProjectId == null)
            return ApiResponse<List<MemoryDto>>.Ok([]); // 未关联受管项目：无可归属的项目记忆

        var history = await _unitOfWork.WorkMessages.FindAsync(m => m.SessionId == workSessionId, cancellationToken);
        var messages = history.OrderBy(m => m.CreatedAt).ToList();
        if (messages.Count < 2)
            return ApiResponse<List<MemoryDto>>.Ok([]);

        var provider = await CreateFastProviderAsync(cancellationToken);
        if (provider == null)
            return ApiResponse<List<MemoryDto>>.Fail("未配置快速模型，无法提取记忆");

        var conversationText = new StringBuilder();
        foreach (var msg in messages.TakeLast(20))
        {
            var role = msg.Role == "user" ? "用户" : "助手";
            conversationText.AppendLine($"{role}: {msg.Content}");
        }

        var extractPrompt = $""""
你是一个项目记忆提取助手。请从以下编码会话中提取值得沉淀到「项目记忆」的事实，供后续会话复用。

规则：
1. 只提取与当前项目相关的长效信息：技术栈与版本、架构与目录约定、关键决策及原因、命名/代码风格约定、环境与部署要点、踩坑结论
2. 每条记忆独立、完整、可脱离上下文理解；不要提取临时的调试过程、一次性命令输出、与本项目无关的通用知识
3. 评估重要性（0-1）：0.9-1.0 架构级决策/硬性约定；0.7-0.8 重要实现约定；0.5-0.6 一般项目事实；0.3-0.4 次要信息
4. 尽量去重
5. 返回 JSON 数组

会话内容（项目：{project.Name}）：
{conversationText}

请返回 JSON 数组，每项包含 content（事实文本）、importance（0-1）、category（类别，如"项目约定"/"技术栈"/"决策"/"踩坑"）。
如果没有值得记忆的内容，返回空数组 []。只返回 JSON，不要其他文字。
"""";

        try
        {
            var response = await provider.ChatAsync(
                [new LlmChatMessage { Role = "user", Content = extractPrompt }],
                new ChatOptions { Stream = false, Temperature = 0.3 },
                cancellationToken);

            var extracted = LlmJsonExtractor.Deserialize<List<ExtractedFact>>(response);
            if (extracted == null || extracted.Count == 0)
                return ApiResponse<List<MemoryDto>>.Ok([]);

            var createdMemories = new List<MemoryDto>();
            foreach (var fact in extracted)
            {
                if (string.IsNullOrWhiteSpace(fact.Content)) continue;

                var existing = await FindSimilarMemoryAsync(fact.Content, 0.9, cancellationToken);
                if (existing != null && existing.Scope == MemoryScopes.Project && existing.ProjectId == managedProjectId)
                {
                    existing.LastAccessedAt = DateTimeOffset.UtcNow;
                    existing.AccessCount++;
                    var touched = MapToDto(existing);
                    touched.ProjectName = project.Name;
                    createdMemories.Add(touched);
                    continue;
                }

                var memory = new Memory
                {
                    Id = Guid.NewGuid(),
                    Content = fact.Content.Trim(),
                    Source = "work",
                    Scope = MemoryScopes.Project,
                    ProjectId = managedProjectId,
                    Category = fact.Category,
                    Importance = Math.Clamp(fact.Importance, 0.1f, 1f),
                    LastAccessedAt = DateTimeOffset.UtcNow,
                    CreatedAt = DateTimeOffset.UtcNow,
                    UpdatedAt = DateTimeOffset.UtcNow
                };

                await _unitOfWork.Memories.AddAsync(memory, cancellationToken);
                await _unitOfWork.SaveChangesAsync(cancellationToken);
                await EmbedAndStoreAsync(memory, cancellationToken);

                var createdDto = MapToDto(memory);
                createdDto.ProjectName = project.Name;
                createdMemories.Add(createdDto);
            }

            _logger.LogInformation("[Memory] Code 会话 {SessionId} 提取项目记忆 {Count} 条（项目 {ProjectId}）",
                workSessionId, createdMemories.Count, managedProjectId);

            return ApiResponse<List<MemoryDto>>.Ok(createdMemories);
        }
        catch (Exception ex)
        {
            return ApiResponse<List<MemoryDto>>.Fail($"记忆提取失败：{ex.Message}");
        }
    }

    public async Task<List<MemoryDto>> RetrieveForContextAsync(string query, int topK = 5, Guid? topicId = null, Guid? projectId = null, CancellationToken cancellationToken = default)
    {
        return await SearchWithScoreAsync(query, topK, topicId, projectId, applyScope: true, cancellationToken);
    }

    // ── 私有方法 ────────────────────────────────────────

    /// <summary>作用域归属：全局始终命中；会话记忆仅命中所属会话；项目记忆仅命中所属项目</summary>
    private static bool InScope(Memory m, Guid? topicId, Guid? projectId) => m.Scope switch
    {
        MemoryScopes.Session => topicId != null && m.TopicId == topicId,
        MemoryScopes.Project => projectId != null && m.ProjectId == projectId,
        _ => true,
    };

    private static string NormalizeScope(string? scope) =>
        MemoryScopes.All.Contains(scope ?? "") ? scope! : MemoryScopes.Global;

    /// <summary>
    /// 语义搜索 + 回归权重评分
    /// Score = α × similarity + β × importance + γ × recency_decay + δ × access_frequency + 作用域加成
    /// </summary>
    private async Task<List<MemoryDto>> SearchWithScoreAsync(
        string query, int topK, Guid? topicId, Guid? projectId, bool applyScope, CancellationToken cancellationToken)
    {
        float[] queryEmbedding;
        try
        {
            // 提供方创建也可能抛（API Key 解不开），一起兜住：搜索失败退化为空结果，而不是 500
            var embeddingProvider = await _embeddingProviderFactory.CreateEmbeddingProviderAsync(cancellationToken);
            if (embeddingProvider == null)
                return [];

            queryEmbedding = await embeddingProvider.EmbedAsync(query.Trim(), cancellationToken);
        }
        catch
        {
            return [];
        }

        // 从 vec 表中获取最近邻（多取一些，后续按作用域过滤 + 回归权重重排序）
        var candidateCount = topK * 5;
        var candidates = await SearchVecMemoryEmbeddingsAsync(queryEmbedding, candidateCount, cancellationToken);

        if (candidates.Count == 0)
            return [];

        var now = DateTimeOffset.UtcNow;
        var memoryIds = candidates.Select(c => c.MemoryId).ToList();
        var memories = await _unitOfWork.Memories.FindAsync(
            m => memoryIds.Contains(m.Id) && !m.IsDeleted, cancellationToken);
        var memoryDict = memories.ToDictionary(m => m.Id);

        var scored = new List<(Memory Memory, double Score, double Similarity)>();
        foreach (var (memoryId, similarity) in candidates)
        {
            if (!memoryDict.TryGetValue(memoryId, out var memory)) continue;
            // 作用域过滤：只保留「全局 ∪ 当前会话 ∪ 当前项目」的记忆（管理端搜索不过滤）
            if (applyScope && !InScope(memory, topicId, projectId)) continue;

            var daysSinceAccess = (now - memory.LastAccessedAt).TotalDays;
            var recencyDecay = Math.Exp(-DecayLambda * daysSinceAccess);
            var accessFreq = Math.Log(1 + memory.AccessCount) / Math.Log(1 + 50); // 归一化，50次为上限

            var score = Alpha * similarity
                       + Beta * memory.Importance
                       + Gamma * recencyDecay
                       + Delta * accessFreq
                       // 作用域加成：会话/项目这类更贴近当前上下文的记忆优先于泛化的全局记忆
                       + (memory.Scope == MemoryScopes.Global ? 0 : 0.05);

            scored.Add((memory, score, similarity));
        }

        // 按综合得分排序，取 topK
        var result = scored
            .OrderByDescending(x => x.Score)
            .Take(topK)
            .ToList();

        // 更新访问时间（同样要挂回上下文，否则热度权重永远不变）
        foreach (var (memory, _, _) in result)
        {
            memory.LastAccessedAt = now;
            memory.AccessCount++;
            await _unitOfWork.Memories.UpdateAsync(memory, cancellationToken);
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 回填项目名（会话/项目记忆在注入上下文时按「[作用域·项目] 内容」展示）
        var resultProjectIds = result.Select(x => x.Memory.ProjectId).Where(p => p != null).Select(p => p!.Value).Distinct().ToList();
        var resultProjectNames = resultProjectIds.Count == 0
            ? new Dictionary<Guid, string>()
            : (await _unitOfWork.ManagedProjects.GetAllAsync(cancellationToken))
                .Where(p => resultProjectIds.Contains(p.Id)).ToDictionary(p => p.Id, p => p.Name);

        return result.Select(x =>
        {
            var dto = MapToDto(x.Memory);
            dto.Score = x.Score;
            if (x.Memory.ProjectId != null) dto.ProjectName = resultProjectNames.GetValueOrDefault(x.Memory.ProjectId.Value);
            return dto;
        }).ToList();
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
        try
        {
            // 同上：提供方创建失败（API Key 解不开）不能把「新建记忆」整条路径打挂
            var embeddingProvider = await _embeddingProviderFactory.CreateEmbeddingProviderAsync(cancellationToken);
            if (embeddingProvider == null) return null;

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
        try
        {
            // 取 embedding 提供方也可能失败（例如 API Key 解不开），必须在 try 内：
            // 否则「编辑记忆」会因为 embedding 生成不了而整个 500，尽管内容本身已经存好了
            var embeddingProvider = await _embeddingProviderFactory.CreateEmbeddingProviderAsync(cancellationToken);
            if (embeddingProvider == null) return;

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
        catch (Exception ex)
        {
            // embedding 失败不阻塞主流程（内容本身已落库），但要留下可查的日志
            _logger.LogWarning(ex, "记忆 {MemoryId} 的 embedding 生成/写入失败，本次跳过", memory.Id);
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

    // ── Dream 记忆巩固 ────────────────────────────────

    private const string DreamConfigKey = "DreamConfig";

    public async Task<DreamConfigDto> GetDreamConfigAsync(CancellationToken cancellationToken = default)
    {
        var setting = await _appSettingService.GetAsync(DreamConfigKey, cancellationToken);
        if (setting?.Data == null || string.IsNullOrWhiteSpace(setting.Data.Value))
            return new DreamConfigDto();
        try
        {
            return System.Text.Json.JsonSerializer.Deserialize<DreamConfigDto>(setting.Data.Value) ?? new DreamConfigDto();
        }
        catch
        {
            return new DreamConfigDto();
        }
    }

    public async Task SaveDreamConfigAsync(DreamConfigDto config, CancellationToken cancellationToken = default)
    {
        config.IntervalHours = Math.Clamp(config.IntervalHours, 1, 24 * 30);
        config.MergeThreshold = Math.Clamp(config.MergeThreshold, 0.5f, 0.99f);
        config.DecayDays = Math.Clamp(config.DecayDays, 1, 3650);
        config.ForgetDays = Math.Clamp(Math.Max(config.ForgetDays, config.DecayDays), config.DecayDays, 3650);
        config.ForgetBelowImportance = Math.Clamp(config.ForgetBelowImportance, 0.01f, 1f);

        // 保存配置不覆盖「最近执行时间」（由巩固流程单独刷新）
        var existing = await GetDreamConfigAsync(cancellationToken);
        config.LastRunAt ??= existing.LastRunAt;

        await _appSettingService.SetAsync(new UpdateAppSettingRequest
        {
            Key = DreamConfigKey,
            Value = System.Text.Json.JsonSerializer.Serialize(config)
        }, cancellationToken);
    }

    /// <summary>
    /// Dream 记忆巩固（模拟人类睡眠期的记忆整理）：
    /// 1) 合并——相似度 ≥ 阈值的记忆并为一条，重要性取高、频率求和、作用域保留更公共的；
    /// 2) 衰减——DecayDays 未被想起的记忆重要性 ×0.8；
    /// 3) 遗忘——ForgetDays 未想起且重要性低于阈值的清除（软删 + 移除向量）。
    /// </summary>
    public async Task<ApiResponse<DreamResultDto>> DreamConsolidateAsync(CancellationToken cancellationToken = default)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            var config = await GetDreamConfigAsync(cancellationToken);
            var now = DateTimeOffset.UtcNow;
            var memories = (await _unitOfWork.Memories.FindAsync(m => !m.IsDeleted, cancellationToken)).ToList();
            int merged = 0, decayed = 0, forgotten = 0;

            // ── 1) 合并：按 embedding 相似度聚类（贪心：与簇代表比较） ──
            var memoryIds = memories.Select(m => m.Id).ToList();
            var embDict = new Dictionary<Guid, float[]>();
            if (memoryIds.Count > 0)
            {
                foreach (var emb in await _unitOfWork.MemoryEmbeddings.FindAsync(e => memoryIds.Contains(e.MemoryId), cancellationToken))
                {
                    if (emb.Embedding is { Length: > 0 })
                        embDict[emb.MemoryId] = BytesToFloatArray(emb.Embedding);
                }
            }

            var clusters = new List<List<Memory>>();
            foreach (var m in memories)
            {
                List<Memory>? target = null;
                if (embDict.TryGetValue(m.Id, out var vec))
                {
                    foreach (var cluster in clusters)
                    {
                        if (!embDict.TryGetValue(cluster[0].Id, out var repVec)) continue;
                        if (CosineSimilarity(vec, repVec) >= config.MergeThreshold)
                        {
                            target = cluster;
                            break;
                        }
                    }
                }
                if (target != null) target.Add(m);
                else clusters.Add([m]);
            }

            foreach (var cluster in clusters.Where(c => c.Count > 1))
            {
                // keeper：重要性最高 → 作用域更公共（Global > Project > Session）→ 更早创建
                var keeper = cluster
                    .OrderByDescending(m => m.Importance)
                    .ThenBy(m => ScopeRank(m.Scope))
                    .ThenBy(m => m.CreatedAt)
                    .First();
                var absorbed = cluster.Where(x => x.Id != keeper.Id).ToList();

                foreach (var m in absorbed)
                {
                    m.IsDeleted = true;
                    m.UpdatedAt = now;
                    await _unitOfWork.Memories.UpdateAsync(m, cancellationToken);
                    await RemoveEmbeddingsAsync(m.Id, cancellationToken);
                }

                keeper.Importance = Math.Min(1f, keeper.Importance + 0.05f);
                keeper.AccessCount += absorbed.Sum(x => x.AccessCount);
                keeper.LastAccessedAt = cluster.Max(x => x.LastAccessedAt);
                keeper.UpdatedAt = now;
                await _unitOfWork.Memories.UpdateAsync(keeper, cancellationToken);
                merged += absorbed.Count;
            }

            // ── 2) 衰减 + 3) 遗忘 ──
            foreach (var m in memories.Where(x => !x.IsDeleted))
            {
                var days = (now - m.LastAccessedAt).TotalDays;
                if (days > config.ForgetDays && m.Importance < config.ForgetBelowImportance)
                {
                    m.IsDeleted = true;
                    m.UpdatedAt = now;
                    await _unitOfWork.Memories.UpdateAsync(m, cancellationToken);
                    await RemoveEmbeddingsAsync(m.Id, cancellationToken);
                    forgotten++;
                    continue;
                }
                if (days > config.DecayDays && m.Importance > 0.05f)
                {
                    m.Importance = Math.Max(0.05f, m.Importance * 0.8f);
                    m.UpdatedAt = now;
                    await _unitOfWork.Memories.UpdateAsync(m, cancellationToken);
                    decayed++;
                }
            }

            await _unitOfWork.SaveChangesAsync(cancellationToken);

            var remaining = (await _unitOfWork.Memories.FindAsync(m => !m.IsDeleted, cancellationToken)).Count;
            config.LastRunAt = now;
            await SaveDreamConfigAsync(config, cancellationToken);

            sw.Stop();
            _logger.LogInformation(
                "[Dream] 记忆巩固完成：合并 {Merged} · 衰减 {Decayed} · 遗忘 {Forgotten} · 剩余 {Remaining}（{Ms}ms）",
                merged, decayed, forgotten, remaining, sw.ElapsedMilliseconds);

            return ApiResponse<DreamResultDto>.Ok(new DreamResultDto
            {
                RanAt = now,
                Merged = merged,
                Decayed = decayed,
                Forgotten = forgotten,
                Remaining = remaining,
                DurationMs = sw.ElapsedMilliseconds
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Dream 记忆巩固失败");
            return ApiResponse<DreamResultDto>.Fail($"记忆巩固失败：{ex.Message}");
        }
    }

    /// <summary>作用域公共程度：全局最公共，项目次之，会话最私有（合并时优先保留公共侧）</summary>
    private static int ScopeRank(string scope) => scope switch
    {
        MemoryScopes.Global => 0,
        MemoryScopes.Project => 1,
        _ => 2,
    };

    /// <summary>移除记忆向量（embedding 行 + SQLite vec 虚拟表），避免已删除的记忆继续被检索命中</summary>
    private async Task RemoveEmbeddingsAsync(Guid memoryId, CancellationToken cancellationToken)
    {
        var rows = await _unitOfWork.MemoryEmbeddings.FindAsync(e => e.MemoryId == memoryId, cancellationToken);
        foreach (var row in rows)
            await _unitOfWork.MemoryEmbeddings.DeleteAsync(row, cancellationToken);

        if (_dbContext.Database.IsSqlite())
        {
            try
            {
                await using var connection = _dbContext.Database.GetDbConnection();
                if (connection.State != ConnectionState.Open)
                    await connection.OpenAsync(cancellationToken);
                await using var cmd = connection.CreateCommand();
                cmd.CommandText = "DELETE FROM vec_memory_embeddings WHERE memory_id = @id";
                var param = cmd.CreateParameter();
                param.ParameterName = "@id";
                param.Value = memoryId.ToString();
                cmd.Parameters.Add(param);
                await cmd.ExecuteNonQueryAsync(cancellationToken);
            }
            catch
            {
                // vec 表可能不存在
            }
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
        // 存量数据迁移前可能为空串，统一按全局展示
        Scope = string.IsNullOrEmpty(m.Scope) ? MemoryScopes.Global : m.Scope,
        ProjectId = m.ProjectId,
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
