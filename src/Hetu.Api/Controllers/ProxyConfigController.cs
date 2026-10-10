using Hetu.Core.Interfaces;
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
    private readonly ILocalizer _localizer;

    public ProxyConfigController(ProxyConfigService config, ILocalizer localizer)
    {
        _config = config;
        _localizer = localizer;
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
            return ApiResponse<ProxyConfigDto>.Fail(_localizer.T("proxyConfig.invalidMode"));
        if (string.IsNullOrWhiteSpace(dto.ModelKey))
            return ApiResponse<ProxyConfigDto>.Fail(_localizer.T("proxyConfig.modelKeyRequired"));

        await _config.SaveAsync(dto, ct);
        return ApiResponse<ProxyConfigDto>.Ok(dto);
    }
}
