using Hetu.Shared.Common;
using Hetu.Shared.Projects;

namespace Hetu.Core.Interfaces;

/// <summary>
/// 项目 Wiki 服务：读取本地项目目录资料，交由 LLM 生成结构化 Markdown Wiki 文档。
/// </summary>
public interface IWikiService
{
    /// <summary>查询 Wiki 文档；可按项目过滤，按生成时间倒序</summary>
    Task<ApiResponse<List<WikiDocumentDto>>> GetAllAsync(Guid? projectId, CancellationToken cancellationToken = default);

    Task<ApiResponse<WikiDocumentDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>为指定项目生成一篇 Wiki 文档（同步等待 LLM 产出后落库）</summary>
    Task<ApiResponse<WikiDocumentDto>> GenerateAsync(Guid projectId, CancellationToken cancellationToken = default);

    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
}
