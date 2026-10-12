using Hetu.Core.Services;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/usage")]
public class UsageController : ControllerBase
{
    private readonly UsageService _usageService;

    public UsageController(UsageService usageService)
    {
        _usageService = usageService;
    }

    [HttpGet("stats")]
    public async Task<ApiResponse<UsageStatsDto>> GetStats(
        [FromQuery] int days = 0,
        CancellationToken ct = default)
    {
        var stats = await _usageService.GetStatsAsync(days, ct);
        return ApiResponse<UsageStatsDto>.Ok(stats);
    }

    [HttpGet("logs")]
    public async Task<ApiResponse<PagedResult<UsageLogDto>>> GetLogs(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? source = null,
        [FromQuery] string? model = null,
        [FromQuery] Guid? refId = null,
        CancellationToken ct = default)
    {
        var logs = await _usageService.GetLogsAsync(page, pageSize, source, model, refId, ct);
        return ApiResponse<PagedResult<UsageLogDto>>.Ok(logs);
    }
}
