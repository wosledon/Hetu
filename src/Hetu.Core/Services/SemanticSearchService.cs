using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Notes;

namespace Hetu.Core.Services;

public class SemanticSearchService : ISemanticSearchService
{
    private readonly IEmbeddingProviderFactory _embeddingProviderFactory;
    private readonly ISemanticSearchStrategy _searchStrategy;
    private readonly IUnitOfWork _unitOfWork;

    public SemanticSearchService(
        IEmbeddingProviderFactory embeddingProviderFactory,
        ISemanticSearchStrategy searchStrategy,
        IUnitOfWork unitOfWork)
    {
        _embeddingProviderFactory = embeddingProviderFactory;
        _searchStrategy = searchStrategy;
        _unitOfWork = unitOfWork;
    }

    public async Task<ApiResponse<PagedResult<NoteSearchResultDto>>> SearchAsync(string query, int topK = 10, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(query))
            return ApiResponse<PagedResult<NoteSearchResultDto>>.Ok(new PagedResult<NoteSearchResultDto>());

        var provider = await _embeddingProviderFactory.CreateEmbeddingProviderAsync(cancellationToken);
        if (provider == null)
            return ApiResponse<PagedResult<NoteSearchResultDto>>.Fail("未配置 Embedding 模型");

        float[] queryEmbedding;
        try
        {
            queryEmbedding = await provider.EmbedAsync(query.Trim(), cancellationToken);
        }
        catch (Exception ex)
        {
            return ApiResponse<PagedResult<NoteSearchResultDto>>.Fail($"生成查询向量失败：{ex.Message}");
        }
        var results = await _searchStrategy.SearchAsync(queryEmbedding, topK, cancellationToken);

        // 图谱增强：从搜索结果中扩展相关笔记
        var enhancedResults = await EnhanceWithGraphAsync(results.ToList(), topK, cancellationToken);

        return ApiResponse<PagedResult<NoteSearchResultDto>>.Ok(new PagedResult<NoteSearchResultDto>
        {
            Items = enhancedResults,
            TotalCount = enhancedResults.Count,
            Page = 1,
            PageSize = topK,
        });
    }

    private async Task<List<NoteSearchResultDto>> EnhanceWithGraphAsync(
        List<NoteSearchResultDto> originalResults,
        int topK,
        CancellationToken cancellationToken)
    {
        if (originalResults.Count == 0)
            return originalResults;

        try
        {
            // 获取原始结果中的笔记 ID
            var originalNoteIds = originalResults.Select(r => r.Id).ToHashSet();

            // 查找这些笔记关联的图谱实体（通过 GraphRelation.SourceNoteId）
            var allRelations = await _unitOfWork.GraphRelations.GetAllAsync(cancellationToken);
            var relatedEntityIds = new HashSet<Guid>();

            foreach (var relation in allRelations)
            {
                if (relation.SourceNoteId.HasValue && originalNoteIds.Contains(relation.SourceNoteId.Value))
                {
                    relatedEntityIds.Add(relation.SourceEntityId);
                    relatedEntityIds.Add(relation.TargetEntityId);
                }
            }

            if (relatedEntityIds.Count == 0)
                return originalResults;

            // 查找相关实体的 1 跳邻居
            var neighborEntityIds = new HashSet<Guid>();
            foreach (var relation in allRelations)
            {
                if (relatedEntityIds.Contains(relation.SourceEntityId))
                    neighborEntityIds.Add(relation.TargetEntityId);
                if (relatedEntityIds.Contains(relation.TargetEntityId))
                    neighborEntityIds.Add(relation.SourceEntityId);
            }

            // 移除已存在的实体
            foreach (var id in relatedEntityIds)
                neighborEntityIds.Remove(id);

            if (neighborEntityIds.Count == 0)
                return originalResults;

            // 查找与邻居实体关联的笔记
            var expandedNoteIds = new HashSet<Guid>();
            foreach (var relation in allRelations)
            {
                if (neighborEntityIds.Contains(relation.SourceEntityId) || neighborEntityIds.Contains(relation.TargetEntityId))
                {
                    if (relation.SourceNoteId.HasValue && !originalNoteIds.Contains(relation.SourceNoteId.Value))
                        expandedNoteIds.Add(relation.SourceNoteId.Value);
                }
            }

            if (expandedNoteIds.Count == 0)
                return originalResults;

            // 获取扩展笔记的详细信息
            var allNotes = await _unitOfWork.Notes.GetAllAsync(cancellationToken);
            var expandedNotes = allNotes.Where(n => expandedNoteIds.Contains(n.Id)).Take(topK / 2).ToList();

            // 将扩展结果添加到原始结果中（给予较低的相似度分数）
            var result = new List<NoteSearchResultDto>(originalResults);
            foreach (var note in expandedNotes)
            {
                if (result.Count >= topK)
                    break;

                result.Add(new NoteSearchResultDto
                {
                    Id = note.Id,
                    Title = note.Title,
                    ContentSnippet = note.Content.Length > 200 ? note.Content[..200] + "..." : note.Content,
                    UpdatedAt = note.UpdatedAt,
                });
            }

            return result;
        }
        catch
        {
            // 图谱增强失败时返回原始结果
            return originalResults;
        }
    }
}
