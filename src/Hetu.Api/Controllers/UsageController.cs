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
    public async Task<ApiResponse<UsageStatsDto>> GetStats(CancellationToken ct)
    {
        var stats = await _usageService.GetStatsAsync(ct);
        return ApiResponse<UsageStatsDto>.Ok(stats);
    }
}
