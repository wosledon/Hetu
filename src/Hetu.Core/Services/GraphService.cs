using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Graph;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;

namespace Hetu.Core.Services;

public class GraphService : IGraphService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILLMProviderFactory _llmProviderFactory;
    private readonly IMemoryCache _cache;
    private const string GraphCacheKey = "graph_data";

    private static readonly JsonSerializerOptions SseJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public GraphService(IUnitOfWork unitOfWork, ILLMProviderFactory llmProviderFactory, IMemoryCache cache)
    {
        _unitOfWork = unitOfWork;
        _llmProviderFactory = llmProviderFactory;
        _cache = cache;
    }

    public async Task<ApiResponse<GraphDataDto>> GetGraphAsync(CancellationToken cancellationToken = default)
    {
        if (_cache.TryGetValue(GraphCacheKey, out GraphDataDto? cached) && cached != null)
            return ApiResponse<GraphDataDto>.Ok(cached);

        var dto = await BuildGraphDataAsync(cancellationToken);
        _cache.Set(GraphCacheKey, dto, new MemoryCacheEntryOptions
        {
            SlidingExpiration = TimeSpan.FromMinutes(5)
        });
        return ApiResponse<GraphDataDto>.Ok(dto);
    }

    public async Task StreamGraphAsync(HttpContext httpContext, CancellationToken cancellationToken = default)
    {
        var dto = _cache.TryGetValue(GraphCacheKey, out GraphDataDto? cached) && cached != null
            ? cached
            : await BuildGraphDataAsync(cancellationToken);

        if (!_cache.TryGetValue(GraphCacheKey, out GraphDataDto? _))
        {
            _cache.Set(GraphCacheKey, dto, new MemoryCacheEntryOptions
            {
                SlidingExpiration = TimeSpan.FromMinutes(5)
            });
        }

        httpContext.Response.ContentType = "text/event-stream";
        httpContext.Response.Headers["Cache-Control"] = "no-cache";
        httpContext.Response.Headers["Connection"] = "keep-alive";

        try
        {
            await WriteSseEventAsync(httpContext.Response.Body, "meta", new { entityCount = dto.Entities.Count, relationCount = dto.Relations.Count }, cancellationToken);
            await WriteSseEventAsync(httpContext.Response.Body, "entities", dto.Entities, cancellationToken);

            const int batchSize = 200;
            for (var i = 0; i < dto.Relations.Count; i += batchSize)
            {
                var batch = dto.Relations.Skip(i).Take(batchSize).ToList();
                await WriteSseEventAsync(httpContext.Response.Body, "relations", batch, cancellationToken);
            }

            await WriteSseEventAsync(httpContext.Response.Body, "done", new { }, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            // Client disconnected — this is expected, not an error
        }
    }

    private async Task<GraphDataDto> BuildGraphDataAsync(CancellationToken cancellationToken)
    {
        var entities = await _unitOfWork.GraphEntities.GetAllAsync(cancellationToken);
        var relations = await _unitOfWork.GraphRelations.GetAllAsync(cancellationToken);

        var entityDict = entities.ToDictionary(e => e.Id);

        // O(N+R) relation count via dictionary precomputation
        var relationCountDict = new Dictionary<Guid, int>();
        foreach (var r in relations)
        {
            relationCountDict.TryGetValue(r.SourceEntityId, out var sc);
            relationCountDict[r.SourceEntityId] = sc + 1;
            relationCountDict.TryGetValue(r.TargetEntityId, out var tc);
            relationCountDict[r.TargetEntityId] = tc + 1;
        }

        return new GraphDataDto
        {
            Entities = entities.Select(e => new GraphEntityDto
            {
                Id = e.Id,
                Name = e.Name,
                Type = e.Type,
                Description = e.Description,
                Metadata = e.Metadata,
                RelationCount = relationCountDict.GetValueOrDefault(e.Id, 0),
                CreatedAt = e.CreatedAt,
                UpdatedAt = e.UpdatedAt
            }).ToList(),
            Relations = relations.Select(r => new GraphRelationDto
            {
                Id = r.Id,
                SourceEntityId = r.SourceEntityId,
                SourceEntityName = entityDict.TryGetValue(r.SourceEntityId, out var src) ? src.Name : "",
                TargetEntityId = r.TargetEntityId,
                TargetEntityName = entityDict.TryGetValue(r.TargetEntityId, out var tgt) ? tgt.Name : "",
                RelationType = r.RelationType,
                Description = r.Description,
                Confidence = r.Confidence,
                SourceNoteId = r.SourceNoteId,
                CreatedAt = r.CreatedAt
            }).ToList()
        };
    }

    private static async Task WriteSseEventAsync(Stream responseStream, string eventType, object data, CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(data, SseJsonOptions);
        var eventBytes = System.Text.Encoding.UTF8.GetBytes($"event: {eventType}\ndata: {json}\n\n");
        await responseStream.WriteAsync(eventBytes, cancellationToken);
        await responseStream.FlushAsync(cancellationToken);
    }

    private void InvalidateGraphCache() => _cache.Remove(GraphCacheKey);

    public async Task<ApiResponse<GraphEntityDetailDto>> GetEntityByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var entity = await _unitOfWork.GraphEntities.GetByIdAsync(id, cancellationToken);
        if (entity == null) return ApiResponse<GraphEntityDetailDto>.Fail("实体不存在");

        // Only query relations involving this entity (not all)
        var relatedRelations = await _unitOfWork.GraphRelations
            .FindAsync(r => r.SourceEntityId == id || r.TargetEntityId == id, cancellationToken);

        // Batch-fetch only the distinct entities referenced by these relations
        var referencedIds = relatedRelations
            .SelectMany(r => new[] { r.SourceEntityId, r.TargetEntityId })
            .Distinct()
            .ToHashSet();
        var allEntities = await _unitOfWork.GraphEntities.GetAllAsync(cancellationToken);
        var entityDict = allEntities
            .Where(e => referencedIds.Contains(e.Id))
            .ToDictionary(e => e.Id);

        var relationDtos = relatedRelations
            .Select(r => new GraphRelationDto
            {
                Id = r.Id,
                SourceEntityId = r.SourceEntityId,
                SourceEntityName = entityDict.TryGetValue(r.SourceEntityId, out var src) ? src.Name : "",
                TargetEntityId = r.TargetEntityId,
                TargetEntityName = entityDict.TryGetValue(r.TargetEntityId, out var tgt) ? tgt.Name : "",
                RelationType = r.RelationType,
                Description = r.Description,
                Confidence = r.Confidence,
                SourceNoteId = r.SourceNoteId,
                CreatedAt = r.CreatedAt
            }).ToList();

        // Batch-fetch source notes in a single query
        var sourceNoteIds = relationDtos
            .Where(r => r.SourceNoteId.HasValue)
            .Select(r => r.SourceNoteId!.Value)
            .Distinct()
            .ToList();

        var sourceNotes = new List<GraphSourceNoteDto>();
        if (sourceNoteIds.Count > 0)
        {
            var notes = await _unitOfWork.Notes.FindAsync(n => sourceNoteIds.Contains(n.Id), cancellationToken);
            sourceNotes = notes.Select(n => new GraphSourceNoteDto { NoteId = n.Id, Title = n.Title }).ToList();
        }

        return ApiResponse<GraphEntityDetailDto>.Ok(new GraphEntityDetailDto
        {
            Id = entity.Id,
            Name = entity.Name,
            Type = entity.Type,
            Description = entity.Description,
            Metadata = entity.Metadata,
            Relations = relationDtos,
            SourceNotes = sourceNotes,
            CreatedAt = entity.CreatedAt,
            UpdatedAt = entity.UpdatedAt
        });
    }

    public async Task<ApiResponse<GraphEntityDto>> CreateEntityAsync(CreateGraphEntityRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return ApiResponse<GraphEntityDto>.Fail("实体名称不能为空");

        var existing = await _unitOfWork.GraphEntities
            .FindAsync(e => e.Name == request.Name.Trim(), cancellationToken);
        if (existing.Count > 0)
            return ApiResponse<GraphEntityDto>.Fail("同名实体已存在");

        var entity = new GraphEntity
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            Type = request.Type,
            Description = request.Description,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.GraphEntities.AddAsync(entity, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        InvalidateGraphCache();

        return ApiResponse<GraphEntityDto>.Ok(MapEntity(entity, 0));
    }

    public async Task<ApiResponse<GraphEntityDto>> UpdateEntityAsync(Guid id, UpdateGraphEntityRequest request, CancellationToken cancellationToken = default)
    {
        var entity = await _unitOfWork.GraphEntities.GetByIdAsync(id, cancellationToken);
        if (entity == null) return ApiResponse<GraphEntityDto>.Fail("实体不存在");

        if (request.Name != null) entity.Name = request.Name.Trim();
        if (request.Type != null) entity.Type = request.Type;
        if (request.Description != null) entity.Description = request.Description;
        if (request.Metadata != null) entity.Metadata = request.Metadata;
        entity.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.GraphEntities.UpdateAsync(entity, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        InvalidateGraphCache();

        var relations = await _unitOfWork.GraphRelations
            .FindAsync(r => r.SourceEntityId == id || r.TargetEntityId == id, cancellationToken);

        return ApiResponse<GraphEntityDto>.Ok(MapEntity(entity, relations.Count));
    }

    public async Task<ApiResponse> DeleteEntityAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var entity = await _unitOfWork.GraphEntities.GetByIdAsync(id, cancellationToken);
        if (entity == null) return ApiResponse.Fail("实体不存在");

        var relations = await _unitOfWork.GraphRelations
            .FindAsync(r => r.SourceEntityId == id || r.TargetEntityId == id, cancellationToken);

        foreach (var rel in relations)
            await _unitOfWork.GraphRelations.DeleteAsync(rel, cancellationToken);

        await _unitOfWork.GraphEntities.DeleteAsync(entity, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        InvalidateGraphCache();

        return ApiResponse.Ok();
    }

    public async Task<ApiResponse<GraphRelationDto>> CreateRelationAsync(CreateGraphRelationRequest request, CancellationToken cancellationToken = default)
    {
        var source = await _unitOfWork.GraphEntities.GetByIdAsync(request.SourceEntityId, cancellationToken);
        var target = await _unitOfWork.GraphEntities.GetByIdAsync(request.TargetEntityId, cancellationToken);

        if (source == null || target == null)
            return ApiResponse<GraphRelationDto>.Fail("源实体或目标实体不存在");

        var relation = new GraphRelation
        {
            Id = Guid.NewGuid(),
            SourceEntityId = request.SourceEntityId,
            TargetEntityId = request.TargetEntityId,
            RelationType = request.RelationType,
            Description = request.Description,
            Confidence = 1.0,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.GraphRelations.AddAsync(relation, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        InvalidateGraphCache();

        return ApiResponse<GraphRelationDto>.Ok(new GraphRelationDto
        {
            Id = relation.Id,
            SourceEntityId = relation.SourceEntityId,
            SourceEntityName = source.Name,
            TargetEntityId = relation.TargetEntityId,
            TargetEntityName = target.Name,
            RelationType = relation.RelationType,
            Description = relation.Description,
            Confidence = relation.Confidence,
            SourceNoteId = relation.SourceNoteId,
            CreatedAt = relation.CreatedAt
        });
    }

    public async Task<ApiResponse> DeleteRelationAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var relation = await _unitOfWork.GraphRelations.GetByIdAsync(id, cancellationToken);
        if (relation == null) return ApiResponse.Fail("关系不存在");

        await _unitOfWork.GraphRelations.DeleteAsync(relation, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        InvalidateGraphCache();

        return ApiResponse.Ok();
    }

    public async Task<ApiResponse<ExtractGraphResultDto>> ExtractFromNoteAsync(Guid noteId, CancellationToken cancellationToken = default)
    {
        var note = await _unitOfWork.Notes.GetByIdAsync(noteId, cancellationToken);
        if (note == null) return ApiResponse<ExtractGraphResultDto>.Fail("笔记不存在");

        var provider = await _llmProviderFactory.CreateChatProviderAsync(cancellationToken);
        if (provider == null)
            return ApiResponse<ExtractGraphResultDto>.Fail("未找到可用的 LLM 模型");

        var content = note.Content.Length > 4000 ? note.Content[..4000] : note.Content;
        var jsonExample = """
            {
              "entities": [
                {"name": "实体名称", "type": "concept|person|organization|technology|project", "description": "简短描述"}
              ],
              "relations": [
                {"source": "实体名称", "target": "实体名称", "relation": "belong_to|related_to|depends_on|contains|compared_with", "description": "关系描述"}
              ]
            }
            """;
        var prompt = $"""
            请从以下笔记内容中提取关键实体和它们之间的关系。

            标题：{note.Title}

            内容：
            {content}

            请以 JSON 格式返回，不要包含任何其他文字或 markdown 代码块标记：
            {jsonExample}

            注意：
            - type 必须是 concept、person、organization、technology、project 之一
            - relation 必须是 belong_to、related_to、depends_on、contains、compared_with 之一
            - 只提取真正重要的实体和关系，不要过度提取
            """;

        var response = await provider.ChatAsync(
            [new LlmChatMessage { Role = "user", Content = prompt }],
            new ChatOptions { ModelId = string.Empty, SystemPrompt = "你是知识图谱提取助手。只输出 JSON，不要输出其他内容。" },
            cancellationToken);

        var extracted = ParseExtractionResult(response);
        if (extracted == null)
            return ApiResponse<ExtractGraphResultDto>.Fail("无法解析 LLM 返回的结果");

        var result = await ApplyExtractionResultAsync(extracted, noteId, cancellationToken);
        InvalidateGraphCache();

        return ApiResponse<ExtractGraphResultDto>.Ok(result);
    }

    public async Task<ApiResponse> MergeEntitiesAsync(MergeGraphEntitiesRequest request, CancellationToken cancellationToken = default)
    {
        var keepEntity = await _unitOfWork.GraphEntities.GetByIdAsync(request.KeepEntityId, cancellationToken);
        var mergeEntity = await _unitOfWork.GraphEntities.GetByIdAsync(request.MergeEntityId, cancellationToken);

        if (keepEntity == null || mergeEntity == null)
            return ApiResponse.Fail("实体不存在");

        var mergeRelations = await _unitOfWork.GraphRelations
            .FindAsync(r => r.SourceEntityId == request.MergeEntityId || r.TargetEntityId == request.MergeEntityId, cancellationToken);

        foreach (var rel in mergeRelations)
        {
            if (rel.SourceEntityId == request.MergeEntityId)
                rel.SourceEntityId = request.KeepEntityId;
            if (rel.TargetEntityId == request.MergeEntityId)
                rel.TargetEntityId = request.KeepEntityId;

            if (rel.SourceEntityId == rel.TargetEntityId)
            {
                await _unitOfWork.GraphRelations.DeleteAsync(rel, cancellationToken);
            }
            else
            {
                await _unitOfWork.GraphRelations.UpdateAsync(rel, cancellationToken);
            }
        }

        await _unitOfWork.GraphEntities.DeleteAsync(mergeEntity, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        InvalidateGraphCache();

        return ApiResponse.Ok();
    }

    public async Task<ApiResponse<List<string>>> GetEntityTypesAsync(CancellationToken cancellationToken = default)
    {
        return ApiResponse<List<string>>.Ok(
        [
            "concept", "person", "organization", "technology", "project", "custom"
        ]);
    }

    public async Task<ApiResponse<List<string>>> GetRelationTypesAsync(CancellationToken cancellationToken = default)
    {
        return ApiResponse<List<string>>.Ok(
        [
            "belong_to", "related_to", "depends_on", "contains", "compared_with", "custom"
        ]);
    }

    private async Task<ExtractGraphResultDto> ApplyExtractionResultAsync(ExtractionResult extracted, Guid noteId, CancellationToken cancellationToken)
    {
        var result = new ExtractGraphResultDto();
        var allEntities = await _unitOfWork.GraphEntities.GetAllAsync(cancellationToken);
        var entityNameMap = allEntities.ToDictionary(e => e.Name.ToLowerInvariant(), e => e);

        var createdEntities = new Dictionary<string, GraphEntity>(StringComparer.OrdinalIgnoreCase);

        foreach (var e in extracted.Entities)
        {
            if (string.IsNullOrWhiteSpace(e.Name)) continue;
            var name = e.Name.Trim();

            if (entityNameMap.TryGetValue(name.ToLowerInvariant(), out var existing))
            {
                createdEntities[name] = existing;
                result.SkippedEntities++;
                continue;
            }

            if (createdEntities.TryGetValue(name, out var alreadyCreated))
            {
                result.SkippedEntities++;
                continue;
            }

            var newEntity = new GraphEntity
            {
                Id = Guid.NewGuid(),
                Name = name,
                Type = NormalizeEntityType(e.Type),
                Description = e.Description,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow
            };

            await _unitOfWork.GraphEntities.AddAsync(newEntity, cancellationToken);
            createdEntities[name] = newEntity;
            result.NewEntities++;
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        foreach (var r in extracted.Relations)
        {
            if (string.IsNullOrWhiteSpace(r.Source) || string.IsNullOrWhiteSpace(r.Target)) continue;

            if (!createdEntities.TryGetValue(r.Source.Trim(), out var sourceEntity) &&
                !entityNameMap.TryGetValue(r.Source.Trim().ToLowerInvariant(), out sourceEntity))
                continue;

            if (!createdEntities.TryGetValue(r.Target.Trim(), out var targetEntity) &&
                !entityNameMap.TryGetValue(r.Target.Trim().ToLowerInvariant(), out targetEntity))
                continue;

            if (sourceEntity.Id == targetEntity.Id) continue;

            var existingRelations = await _unitOfWork.GraphRelations
                .FindAsync(rel => rel.SourceEntityId == sourceEntity.Id &&
                                  rel.TargetEntityId == targetEntity.Id &&
                                  rel.RelationType == NormalizeRelationType(r.Relation), cancellationToken);

            if (existingRelations.Count > 0)
            {
                result.SkippedRelations++;
                continue;
            }

            var relation = new GraphRelation
            {
                Id = Guid.NewGuid(),
                SourceEntityId = sourceEntity.Id,
                TargetEntityId = targetEntity.Id,
                RelationType = NormalizeRelationType(r.Relation),
                Description = r.Description,
                Confidence = 0.8,
                SourceNoteId = noteId,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow
            };

            await _unitOfWork.GraphRelations.AddAsync(relation, cancellationToken);
            result.NewRelations++;
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return result;
    }

    private static ExtractionResult? ParseExtractionResult(string response)
    {
        try
        {
            var json = response.Trim();
            if (json.StartsWith("```"))
            {
                var lines = json.Split('\n');
                json = string.Join('\n', lines.Skip(1).TakeWhile(l => !l.TrimStart().StartsWith("```")));
            }

            return JsonSerializer.Deserialize<ExtractionResult>(json, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
        }
        catch
        {
            return null;
        }
    }

    private static string NormalizeEntityType(string? type) => type?.ToLowerInvariant() switch
    {
        "concept" => "concept",
        "person" => "person",
        "organization" or "org" => "organization",
        "technology" or "tech" => "technology",
        "project" => "project",
        _ => "concept"
    };

    private static string NormalizeRelationType(string? type) => type?.ToLowerInvariant() switch
    {
        "belong_to" => "belong_to",
        "related_to" => "related_to",
        "depends_on" => "depends_on",
        "contains" => "contains",
        "compared_with" => "compared_with",
        _ => "related_to"
    };

    private static GraphEntityDto MapEntity(GraphEntity entity, int relationCount) => new()
    {
        Id = entity.Id,
        Name = entity.Name,
        Type = entity.Type,
        Description = entity.Description,
        Metadata = entity.Metadata,
        RelationCount = relationCount,
        CreatedAt = entity.CreatedAt,
        UpdatedAt = entity.UpdatedAt
    };

    private class ExtractionResult
    {
        public List<ExtractedEntity> Entities { get; set; } = [];
        public List<ExtractedRelation> Relations { get; set; } = [];
    }

    private class ExtractedEntity
    {
        public string Name { get; set; } = string.Empty;
        public string Type { get; set; } = "concept";
        public string? Description { get; set; }
    }

    private class ExtractedRelation
    {
        public string Source { get; set; } = string.Empty;
        public string Target { get; set; } = string.Empty;
        public string Relation { get; set; } = "related_to";
        public string? Description { get; set; }
    }
}
