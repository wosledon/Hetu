using System.Diagnostics;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Projects;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>
/// 项目目录管理：本地 / SSH 远程项目目录的登记、分组、归类与打开。
/// 只管理目录本身，不涉及 Code 工作区的会话与消息。
/// </summary>
[ApiController]
[Route("api/projects")]
public class ManagedProjectsController : ControllerBase
{
    private readonly IManagedProjectService _projectService;
    private readonly ILocalizer _localizer;

    public ManagedProjectsController(IManagedProjectService projectService, ILocalizer localizer)
    {
        _projectService = projectService;
        _localizer = localizer;
    }

    [HttpGet]
    public Task<ApiResponse<List<ManagedProjectDto>>> GetAll(CancellationToken cancellationToken)
        => _projectService.GetAllAsync(cancellationToken);

    [HttpGet("{id:guid}")]
    public Task<ApiResponse<ManagedProjectDto>> GetById(Guid id, CancellationToken cancellationToken)
        => _projectService.GetByIdAsync(id, cancellationToken);

    [HttpPost]
    public Task<ApiResponse<ManagedProjectDto>> Create([FromBody] CreateManagedProjectRequest request, CancellationToken cancellationToken)
        => _projectService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<ManagedProjectDto>> Update(Guid id, [FromBody] UpdateManagedProjectRequest request, CancellationToken cancellationToken)
        => _projectService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _projectService.DeleteAsync(id, cancellationToken);

    /// <summary>批量保存拖拽后的排序</summary>
    [HttpPost("sorts")]
    public Task<ApiResponse> Sort([FromBody] SortProjectsRequest request, CancellationToken cancellationToken)
        => _projectService.SortAsync(request, cancellationToken);

    /// <summary>在系统文件管理器中打开本地项目目录（远程项目请通过 SSH 客户端访问）</summary>
    [HttpPost("{id:guid}/open")]
    public async Task<ApiResponse<string>> Open(Guid id, CancellationToken cancellationToken)
    {
        var result = await _projectService.GetByIdAsync(id, cancellationToken);
        if (!result.Success || result.Data == null)
            return ApiResponse<string>.Fail(result.Error ?? _localizer.T("projects.notFound"));

        var project = result.Data;
        if (project.ProjectType != "Local")
            return ApiResponse<string>.Fail(_localizer.T("projects.remoteOpenUnsupported"));
        if (!Directory.Exists(project.DirectoryPath))
            return ApiResponse<string>.Fail(_localizer.T("projects.dirNotExists"));

        try
        {
            var psi = new ProcessStartInfo { UseShellExecute = true, CreateNoWindow = true };
            if (OperatingSystem.IsWindows())
            {
                psi.FileName = "explorer.exe";
                psi.ArgumentList.Add(project.DirectoryPath);
            }
            else if (OperatingSystem.IsMacOS())
            {
                psi.FileName = "open";
                psi.ArgumentList.Add(project.DirectoryPath);
            }
            else
            {
                psi.FileName = "xdg-open";
                psi.ArgumentList.Add(project.DirectoryPath);
            }
            using var process = Process.Start(psi);
            if (process == null) return ApiResponse<string>.Fail(_localizer.T("projects.openLauncherFailed"));
        }
        catch (Exception ex)
        {
            return ApiResponse<string>.Fail(_localizer.T("projects.openFailed", ex.Message));
        }

        await _projectService.MarkOpenedAsync(id, cancellationToken);
        return ApiResponse<string>.Ok(_localizer.T("projects.openedInFileManager", project.DirectoryPath));
    }
}

/// <summary>项目分组：项目按分组组织，删除分组不会删除其中的项目</summary>
[ApiController]
[Route("api/project-groups")]
public class ProjectGroupsController : ControllerBase
{
    private readonly IProjectGroupService _groupService;

    public ProjectGroupsController(IProjectGroupService groupService)
    {
        _groupService = groupService;
    }

    [HttpGet]
    public Task<ApiResponse<List<ProjectGroupDto>>> GetAll(CancellationToken cancellationToken)
        => _groupService.GetAllAsync(cancellationToken);

    [HttpPost]
    public Task<ApiResponse<ProjectGroupDto>> Create([FromBody] CreateProjectGroupRequest request, CancellationToken cancellationToken)
        => _groupService.CreateAsync(request, cancellationToken);

    [HttpPut("{id:guid}")]
    public Task<ApiResponse<ProjectGroupDto>> Update(Guid id, [FromBody] UpdateProjectGroupRequest request, CancellationToken cancellationToken)
        => _groupService.UpdateAsync(id, request, cancellationToken);

    [HttpDelete("{id:guid}")]
    public Task<ApiResponse> Delete(Guid id, CancellationToken cancellationToken)
        => _groupService.DeleteAsync(id, cancellationToken);
}
