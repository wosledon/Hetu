using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;

namespace Hetu.Core.Services;

/// <summary>聚合 ChatMessage 的 Token/延迟/消息数，产出用量统计。</summary>
public class UsageService
{
    private readonly IUnitOfWork _unitOfWork;

    public UsageService(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    public async Task<UsageStatsDto> GetStatsAsync(CancellationToken ct = default)
    {
        var messages = await _unitOfWork.ChatMessages.FindAsync(m => m.Role == "assistant", ct);
        var models = await _unitOfWork.AiModels.GetAllAsync(ct);
        var modelNames = models.ToDictionary(m => m.Id, m => string.IsNullOrWhiteSpace(m.DisplayName) ? m.ModelId : m.DisplayName);

        var now = DateTimeOffset.Now;
        var today = now.Date;
        var result = new UsageStatsDto();

        // 概览
        result.Overview.TotalMessages = messages.Count;
        result.Overview.TotalTokens = messages.Sum(m => (long)(m.TokensUsed ?? 0));
        result.Overview.TotalCachedTokens = messages.Sum(m => (long)(m.CachedTokens ?? 0));
        result.Overview.TotalInputTokens = messages.Sum(m => (long)(m.InputTokens ?? 0));
        result.Overview.TotalCompressedTokens = messages.Sum(m => (long)(m.CompressedTokens ?? 0));
        result.Overview.TotalOutputTokens = messages.Sum(m => (long)(m.OutputTokens ?? 0));
        var latencies = messages.Where(m => m.LatencyMs.HasValue).Select(m => (double)m.LatencyMs!.Value).ToList();
        result.Overview.AvgLatencyMs = latencies.Count > 0 ? latencies.Average() : 0;
        result.Overview.ActiveDays = messages.Select(m => m.CreatedAt.LocalDateTime.Date).Distinct().Count();
        result.Overview.TodayMessages = messages.Count(m => m.CreatedAt.LocalDateTime.Date == today);
        result.Overview.TodayTokens = messages.Where(m => m.CreatedAt.LocalDateTime.Date == today).Sum(m => (long)(m.TokensUsed ?? 0));

        // 近 7 天按天趋势（含 0 填充）
        for (int i = 6; i >= 0; i--)
        {
            var day = today.AddDays(-i);
            var dayMsgs = messages.Where(m => m.CreatedAt.LocalDateTime.Date == day).ToList();
            result.DailyTrend.Add(new UsageDayStat
            {
                Date = day.ToString("yyyy-MM-dd"),
                Messages = dayMsgs.Count,
                Tokens = dayMsgs.Sum(m => (long)(m.TokensUsed ?? 0)),
            });
        }

        // 近 365 天按天聚合（年热力图）
        var yearAgo = today.AddDays(-364);
        result.YearDaily = messages
            .Where(m => m.CreatedAt.LocalDateTime.Date >= yearAgo)
            .GroupBy(m => m.CreatedAt.LocalDateTime.Date)
            .Select(g => new UsageDayStat
            {
                Date = g.Key.ToString("yyyy-MM-dd"),
                Messages = g.Count(),
                Tokens = g.Sum(m => (long)(m.TokensUsed ?? 0)),
            })
            .OrderBy(d => d.Date)
            .ToList();

        // 近 7 天 日期×小时 聚合（周热力图）
        var weekAgo = today.AddDays(-6);
        result.WeekHourly = messages
            .Where(m => m.CreatedAt.LocalDateTime.Date >= weekAgo)
            .GroupBy(m => new { Day = m.CreatedAt.LocalDateTime.Date, Hour = m.CreatedAt.LocalDateTime.Hour })
            .Select(g => new UsageHourStat
            {
                Date = g.Key.Day.ToString("yyyy-MM-dd"),
                Hour = g.Key.Hour,
                Messages = g.Count(),
                Tokens = g.Sum(m => (long)(m.TokensUsed ?? 0)),
            })
            .ToList();

        // 按模型聚合
        result.ByModel = messages
            .GroupBy(m => m.ModelId)
            .Select(g => new UsageModelStat
            {
                ModelName = g.Key.HasValue && modelNames.TryGetValue(g.Key.Value, out var n) ? n : "默认模型",
                Messages = g.Count(),
                Tokens = g.Sum(m => (long)(m.TokensUsed ?? 0)),
                CachedTokens = g.Sum(m => (long)(m.CachedTokens ?? 0)),
            })
            .OrderByDescending(m => m.Tokens)
            .ToList();

        return result;
    }

    /// <summary>获取请求日志明细（分页）</summary>
    public async Task<List<UsageLogDto>> GetLogsAsync(int page = 1, int pageSize = 50, CancellationToken ct = default)
    {
        var messages = await _unitOfWork.ChatMessages.FindAsync(m => m.Role == "assistant", ct);
        var models = await _unitOfWork.AiModels.GetAllAsync(ct);
        var modelNames = models.ToDictionary(m => m.Id, m => string.IsNullOrWhiteSpace(m.DisplayName) ? m.ModelId : m.DisplayName);

        return messages
            .OrderByDescending(m => m.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(m => new UsageLogDto
            {
                MessageId = m.Id,
                TopicId = m.TopicId,
                CreatedAt = m.CreatedAt,
                ModelName = m.ModelId.HasValue && modelNames.TryGetValue(m.ModelId.Value, out var n) ? n : "默认模型",
                InputTokens = m.InputTokens,
                CompressedTokens = m.CompressedTokens,
                OutputTokens = m.OutputTokens,
                TokensUsed = m.TokensUsed,
                CachedTokens = m.CachedTokens,
                LatencyMs = m.LatencyMs,
                ContentPreview = m.Content?.Length > 80 ? m.Content[..80] + "..." : m.Content ?? "",
                Source = m.TopicId == Guid.Empty ? "proxy" : "chat",
            })
            .ToList();
    }
}
