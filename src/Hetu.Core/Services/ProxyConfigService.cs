using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;

namespace Hetu.Core.Services;

/// <summary>
/// 固定两个代理（route / shadow）的配置，存于 AppSettings。开箱即用，无新建/删除。
/// </summary>
public class ProxyConfigService
{
    public const string RouteKey = "Proxy:Route";
    public const string ShadowKey = "Proxy:Shadow";

    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private readonly IUnitOfWork _unitOfWork;

    public ProxyConfigService(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    public async Task<ProxyConfigDto> GetAsync(string mode, CancellationToken ct)
    {
        var key = mode == "route" ? RouteKey : ShadowKey;
        var setting = await _unitOfWork.AppSettings.GetByKeyAsync(key, ct);
        if (setting?.Value != null)
        {
            try
            {
                var dto = JsonSerializer.Deserialize<ProxyConfigDto>(setting.Value, JsonOpts);
                if (dto != null) { dto.Mode = mode; return dto; }
            }
            catch { }
        }
        // 默认开箱即用配置
        return new ProxyConfigDto
        {
            Mode = mode,
            ModelKey = mode == "route" ? "hetu-route" : "hetu-shadow",
            ShadowTargetModelKey = null,
            RouteClassifierModelKey = null,
            RouteRules = mode == "route" ? new() { new ProxyRouteRuleDto { Category = "default", TargetModelKey = "" } } : new(),
        };
    }

    public async Task SaveAsync(ProxyConfigDto dto, CancellationToken ct)
    {
        var key = dto.Mode == "route" ? RouteKey : ShadowKey;
        var json = JsonSerializer.Serialize(dto, JsonOpts);
        await _unitOfWork.AppSettings.SetAsync(new Entities.AppSetting { Key = key, Value = json, UpdatedAt = DateTimeOffset.UtcNow }, ct);
        await _unitOfWork.SaveChangesAsync(ct);
    }
}
