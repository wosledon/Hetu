using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;
using Hetu.Shared.Agent;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>Agent 运行时能力：权限模式等由后端统一定义的元数据，供对话页与编码会话共用。</summary>
[ApiController]
[Route("api/agent")]
public class AgentController : ControllerBase
{
    private readonly ILocalizer _localizer;

    public AgentController(ILocalizer localizer)
    {
        _localizer = localizer;
    }

    /// <summary>权限模式清单（plan / readonly / ask / auto / bypass）：值、名称与说明。</summary>
    [HttpGet("permission-modes")]
    public ApiResponse<List<AgentPermissionModeDto>> GetPermissionModes()
        => ApiResponse<List<AgentPermissionModeDto>>.Ok(
            WorkToolPolicy.AllModes.Select(mode =>
            {
                var value = WorkToolPolicy.ToValue(mode);
                return new AgentPermissionModeDto
                {
                    Value = value,
                    Label = _localizer.T($"agentPermission.{value}.label"),
                    Description = _localizer.T($"agentPermission.{value}.description"),
                };
            }).ToList());
}