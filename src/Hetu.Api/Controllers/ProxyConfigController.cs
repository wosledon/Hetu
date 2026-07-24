using Hetu.Core.Services;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>
/// 固定两个代理（route / shadow）的配置读写。无新建/删除，开箱即用。
/// </summary>
[ApiController]
[Route("api/proxy-config")]
public class ProxyConfigController : ControllerBase
{
    private readonly ProxyConfigService _config;

    public ProxyConfigController(ProxyConfigService config)
    {
        _config = config;
    }

    [HttpGet]
    public async Task<ApiResponse<List<ProxyConfigDto>>> GetAll(CancellationToken ct)
    {
        var route = await _config.GetAsync("route", ct);
        var shadow = await _config.GetAsync("shadow", ct);
        return ApiResponse<List<ProxyConfigDto>>.Ok(new List<ProxyConfigDto> { route, shadow });
    }

    [HttpPut]
    public async Task<ApiResponse<ProxyConfigDto>> Save([FromBody] ProxyConfigDto dto, CancellationToken ct)
    {
        if (dto.Mode != "route" && dto.Mode != "shadow")
            return ApiResponse<ProxyConfigDto>.Fail("mode 必须是 route 或 shadow");
        if (string.IsNullOrWhiteSpace(dto.ModelKey))
            return ApiResponse<ProxyConfigDto>.Fail("模型 ID 不能为空");

        await _config.SaveAsync(dto, ct);
        return ApiResponse<ProxyConfigDto>.Ok(dto);
    }
}
