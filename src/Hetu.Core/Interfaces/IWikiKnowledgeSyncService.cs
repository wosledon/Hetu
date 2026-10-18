using Hetu.Core.Entities;
using Hetu.Shared.Projects;

namespace Hetu.Core.Interfaces;

/// <summary>
/// 把项目 Wiki 页面接入知识与 Agent 体系：
/// 生成/更新页面时写入知识库（分块 + 向量索引）并把页面送入知识图谱抽取；删除页面时清理对应投影。
/// </summary>
public interface IWikiKnowledgeSyncService
{
    /// <summary>同步单个 Wiki 页面并按其配置入队索引与图谱抽取</summary>
    Task<WikiSyncResultDto> SyncAsync(WikiDocument document, CancellationToken cancellationToken = default);

    /// <summary>同步一套 Wiki 的所有页面（生成完成后批量调用）</summary>
    Task<WikiSyncResultDto> SyncSetAsync(IReadOnlyList<WikiDocument> documents, CancellationToken cancellationToken = default);

    /// <summary>删除单个 Wiki 页面在知识库与图谱中的投影</summary>
    Task RemoveAsync(Guid wikiDocumentId, CancellationToken cancellationToken = default);

    /// <summary>删除一套 Wiki 在知识库与图谱中的投影</summary>
    Task RemoveSetAsync(IReadOnlyCollection<Guid> wikiDocumentIds, CancellationToken cancellationToken = default);
}
