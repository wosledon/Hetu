using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Projects;

namespace Hetu.Core.Services;

/// <summary>项目分组服务：分组仅用于组织项目目录，删除分组时项目移入「未分组」</summary>
public class ProjectGroupService : IProjectGroupService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILocalizer _localizer;

    public ProjectGroupService(IUnitOfWork unitOfWork, ILocalizer localizer)
    {
        _unitOfWork = unitOfWork;
        _localizer = localizer;
    }

    public async Task<ApiResponse<List<ProjectGroupDto>>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var groups = await _unitOfWork.ProjectGroups.GetAllAsync(cancellationToken);
        var projects = await _unitOfWork.ManagedProjects.GetAllAsync(cancellationToken);
        var countByGroup = projects.GroupBy(p => p.GroupId ?? Guid.Empty).ToDictionary(g => g.Key, g => g.Count());
        return ApiResponse<List<ProjectGroupDto>>.Ok(groups
            .OrderBy(g => g.SortOrder)
            .ThenBy(g => g.Name, StringComparer.OrdinalIgnoreCase)
            .Select(g => Map(g, countByGroup.GetValueOrDefault(g.Id)))
            .ToList());
    }

    public async Task<ApiResponse<ProjectGroupDto>> CreateAsync(CreateProjectGroupRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name)) return ApiResponse<ProjectGroupDto>.Fail(_localizer.T("group.nameRequired"));

        var groups = await _unitOfWork.ProjectGroups.GetAllAsync(cancellationToken);
        if (groups.Any(g => g.Name.Equals(request.Name.Trim(), StringComparison.OrdinalIgnoreCase)))
            return ApiResponse<ProjectGroupDto>.Fail(_localizer.T("group.duplicated"));

        var group = new ProjectGroup
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            SortOrder = groups.Count == 0 ? 0 : groups.Max(g => g.SortOrder) + 1,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        await _unitOfWork.ProjectGroups.AddAsync(group, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<ProjectGroupDto>.Ok(Map(group, 0));
    }

    public async Task<ApiResponse<ProjectGroupDto>> UpdateAsync(Guid id, UpdateProjectGroupRequest request, CancellationToken cancellationToken = default)
    {
        var group = await _unitOfWork.ProjectGroups.GetByIdAsync(id, cancellationToken);
        if (group == null) return ApiResponse<ProjectGroupDto>.Fail(_localizer.T("group.notFound"));

        var name = string.IsNullOrWhiteSpace(request.Name) ? group.Name : request.Name.Trim();
        if (name != group.Name)
        {
            var groups = await _unitOfWork.ProjectGroups.GetAllAsync(cancellationToken);
            if (groups.Any(g => g.Id != id && g.Name.Equals(name, StringComparison.OrdinalIgnoreCase)))
                return ApiResponse<ProjectGroupDto>.Fail(_localizer.T("group.duplicated"));
        }

        group.Name = name;
        group.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        group.SortOrder = request.SortOrder;
        group.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.ProjectGroups.UpdateAsync(group, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return await GetGroupAsync(id, cancellationToken);
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var group = await _unitOfWork.ProjectGroups.GetByIdAsync(id, cancellationToken);
        if (group == null) return ApiResponse.Fail(_localizer.T("group.notFound"));

        // 组内项目移到「未分组」而不是删除
        var projects = await _unitOfWork.ManagedProjects.FindAsync(p => p.GroupId == id, cancellationToken);
        foreach (var project in projects)
        {
            project.GroupId = null;
            project.UpdatedAt = DateTimeOffset.UtcNow;
            await _unitOfWork.ManagedProjects.UpdateAsync(project, cancellationToken);
        }
        await _unitOfWork.ProjectGroups.DeleteAsync(group, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    private async Task<ApiResponse<ProjectGroupDto>> GetGroupAsync(Guid id, CancellationToken cancellationToken)
    {
        var all = await GetAllAsync(cancellationToken);
        var group = all.Data?.FirstOrDefault(g => g.Id == id);
        return group == null ? ApiResponse<ProjectGroupDto>.Fail(_localizer.T("group.notFound")) : ApiResponse<ProjectGroupDto>.Ok(group);
    }

    private static ProjectGroupDto Map(ProjectGroup group, int projectCount) => new()
    {
        Id = group.Id,
        Name = group.Name,
        Description = group.Description,
        SortOrder = group.SortOrder,
        ProjectCount = projectCount,
        CreatedAt = group.CreatedAt,
        UpdatedAt = group.UpdatedAt,
    };
}
