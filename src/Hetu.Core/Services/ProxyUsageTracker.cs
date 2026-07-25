using System.Text.Json;
using Hetu.Core.Interfaces;
using Microsoft.Extensions.Logging;

namespace Hetu.Core.Services;

public class ProxyUsageTracker
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILogger<ProxyUsageTracker> _logger;

    public ProxyUsageTracker(IUnitOfWork unitOfWork, ILogger<ProxyUsageTracker> logger)
    {
        _unitOfWork = unitOfWork;
        _logger = logger;
    }

    public async Task RecordAsync(ProxyUsageRecord record, CancellationToken ct = default)
    {
        var setting = await _unitOfWork.AppSettings.GetByKeyAsync("ProxyUsage", ct);
        var list = new List<ProxyUsageRecord>();
        if (setting?.Value != null)
        {
            try { list = JsonSerializer.Deserialize<List<ProxyUsageRecord>>(setting.Value) ?? new(); }
            catch { }
        }
        list.Add(record);
        // Keep only last 500 records
        if (list.Count > 500) list = list.Skip(list.Count - 500).ToList();

        var appSetting = new Entities.AppSetting
        {
            Key = "ProxyUsage",
            Value = JsonSerializer.Serialize(list),
            UpdatedAt = DateTimeOffset.UtcNow
        };
        await _unitOfWork.AppSettings.SetAsync(appSetting, ct);
        await _unitOfWork.SaveChangesAsync(ct);
        _logger.LogDebug("[ProxyUsage] input={Input} compressed={Compressed} model={Model}",
            record.InputTokens, record.CompressedTokens, record.ModelKey);
    }

    public async Task<List<ProxyUsageRecord>> GetRecordsAsync(CancellationToken ct = default)
    {
        var setting = await _unitOfWork.AppSettings.GetByKeyAsync("ProxyUsage", ct);
        if (setting?.Value == null) return new();
        try { return JsonSerializer.Deserialize<List<ProxyUsageRecord>>(setting.Value) ?? new(); }
        catch { return new(); }
    }
}

public class ProxyUsageRecord
{
    public DateTimeOffset Time { get; set; }
    public string ModelKey { get; set; } = string.Empty;
    public int InputTokens { get; set; }
    public int CompressedTokens { get; set; }
    public int ContentLength { get; set; }
}
