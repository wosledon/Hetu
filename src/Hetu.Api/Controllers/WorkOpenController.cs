using Hetu.Api.Services;
using Hetu.Shared.Common;
using Hetu.Shared.Work;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>
/// 打开方式：已安装应用列表（含图标）与应用图标 PNG。
/// </summary>
[ApiController]
[Route("api/work-open")]
public class WorkOpenController : ControllerBase
{
    private readonly WorkOpenInAppService _openService;

    public WorkOpenController(WorkOpenInAppService openService)
    {
        _openService = openService;
    }

    /// <summary>已安装的打开方式列表（未安装的应用不返回）</summary>
    [HttpGet("apps")]
    public ApiResponse<List<WorkOpenAppDto>> GetApps()
        => ApiResponse<List<WorkOpenAppDto>>.Ok(_openService.GetApps());

    /// <summary>应用图标 PNG（从可执行文件提取并缓存）</summary>
    [HttpGet("icon")]
    public IActionResult GetIcon([FromQuery] string app)
    {
        var bytes = _openService.GetIcon(app);
        return bytes == null ? NotFound() : File(bytes, "image/png");
    }
}
