using Hetu.Shared.Common;
using Hetu.Shared.Projects;

namespace Hetu.Core.Interfaces;

public interface IManagedProjectService
{
    Task<ApiResponse<List<ManagedProjectDto>>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<ManagedProjectDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<ManagedProjectDto>> CreateAsync(CreateManagedProjectRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<ManagedProjectDto>> UpdateAsync(Guid id, UpdateManagedProjectRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse> SortAsync(SortProjectsRequest request, CancellationToken cancellationToken = default);
    /// <summary>记录最近打开时间（目录打开成功后调用）</summary>
    Task<ApiResponse> MarkOpenedAsync(Guid id, CancellationToken cancellationToken = default);
}

public interface IProjectGroupService
{
    Task<ApiResponse<List<ProjectGroupDto>>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<ProjectGroupDto>> CreateAsync(CreateProjectGroupRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<ProjectGroupDto>> UpdateAsync(Guid id, UpdateProjectGroupRequest request, CancellationToken cancellationToken = default);
    /// <summary>删除分组：组内项目移到「未分组」，不删除项目本身</summary>
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
}
