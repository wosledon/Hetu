using Hetu.Api.Services;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Work;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/work-projects/{id:guid}/git")]
public class WorkGitController : ControllerBase
{
    private readonly WorkGitService _gitService;
    private readonly ILocalizer _localizer;

    public WorkGitController(WorkGitService gitService, ILocalizer localizer)
    {
        _gitService = gitService;
        _localizer = localizer;
    }

    /// <summary>仓库状态：当前分支与未提交变更列表</summary>
    [HttpGet("status")]
    public Task<ApiResponse<WorkGitStatusDto>> GetStatus(Guid id, CancellationToken cancellationToken)
        => _gitService.GetStatusAsync(id, cancellationToken).ContinueWith(t => ApiResponse<WorkGitStatusDto>.Ok(t.Result), cancellationToken);

    /// <summary>单个文件的工作区内容与 HEAD 版本对比（未跟踪文件视为新增）</summary>
    [HttpGet("file")]
    public async Task<ApiResponse<WorkGitFileContentDto>> GetFileContent(Guid id, [FromQuery] string path, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(path)) return ApiResponse<WorkGitFileContentDto>.Fail(_localizer.T("work.pathMissing"));
        try
        {
            var content = await _gitService.GetFileContentAsync(id, path, cancellationToken);
            return content == null
                ? ApiResponse<WorkGitFileContentDto>.Fail(_localizer.T("work.projectNotFound"))
                : ApiResponse<WorkGitFileContentDto>.Ok(content);
        }
        catch (InvalidOperationException ex)
        {
            return ApiResponse<WorkGitFileContentDto>.Fail(ex.Message);
        }
    }

    /// <summary>提交选中的文件（git add 指定路径 + commit）</summary>
    [HttpPost("commit")]
    public async Task<ApiResponse<WorkGitCommitResultDto>> Commit(Guid id, [FromBody] WorkGitCommitRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var result = await _gitService.CommitAsync(id, request, cancellationToken);
            return result.Success
                ? ApiResponse<WorkGitCommitResultDto>.Ok(result)
                : ApiResponse<WorkGitCommitResultDto>.Fail(result.Output);
        }
        catch (InvalidOperationException ex)
        {
            return ApiResponse<WorkGitCommitResultDto>.Fail(ex.Message);
        }
    }
}
