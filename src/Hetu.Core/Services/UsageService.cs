using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;

namespace Hetu.Core.Services;

/// <summary>
/// 聚合 <see cref="LlmUsageLog"/> 的 Token/延迟统计。
/// 全部 LLM 调用路径（对话、编码会话、看板任务、工作流、Wiki、笔记 AI、
/// 话题整理、技能、图谱、查询改写、定时任务、代理）都记同一张表，
/// 因此用量统计覆盖所有来源，而不是只有对话页。
/// </summary>
public class UsageService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILocalizer _localizer;

    public UsageService(IUnitOfWork unitOfWork, ILocalizer localizer)
    {
        _unitOfWork = unitOfWork;
        _localizer = localizer;
    }

    /// <summary>来源的展示名，供前端拆分展示</summary>
    private string LocalizeSource(string source) => source.ToLowerInvariant() switch
    {
        LlmUsageSources.Chat => _localizer.T("usage.sourceChat"),
        LlmUsageSources.Work => _localizer.T("usage.sourceWork"),
        LlmUsageSources.Kanban => _localizer.T("usage.sourceKanban"),
        LlmUsageSources.Workflow => _localizer.T("usage.sourceWorkflow"),
        LlmUsageSources.Wiki => _localizer.T("usage.sourceWiki"),
        LlmUsageSources.NoteAi => _localizer.T("usage.sourceNoteAi"),
        LlmUsageSources.Organize => _localizer.T("usage.sourceOrganize"),
        LlmUsageSources.Skill => _localizer.T("usage.sourceSkill"),
        LlmUsageSources.Graph => _localizer.T("usage.sourceGraph"),
        LlmUsageSources.Search => _localizer.T("usage.sourceSearch"),
        LlmUsageSources.Scheduled => _localizer.T("usage.sourceScheduled"),
        LlmUsageSources.Proxy => _localizer.T("usage.sourceProxy"),
        _ => source,
    };

    public async Task<UsageStatsDto> GetStatsAsync(CancellationToken ct = default)
    {
        var logs = await _unitOfWork.LlmUsageLogs.GetAllAsync(ct);
        var models = await _unitOfWork.AiModels.GetAllAsync(ct);
        var modelNames = models.ToDictionary(m => m.Id, m => string.IsNullOrWhiteSpace(m.DisplayName) ? m.ModelId : m.DisplayName);

        var today = DateTimeOffset.Now.Date;
        var result = new UsageStatsDto();

        result.Overview.TotalMessages = logs.Count;
        result.Overview.TotalTokens = logs.Sum(l => (long)(l.TokensUsed ?? 0));
        result.Overview.TotalCachedTokens = logs.Sum(l => (long)(l.CachedTokens ?? 0));
        result.Overview.TotalInputTokens = logs.Sum(l => (long)(l.InputTokens ?? 0));
        result.Overview.TotalCompressedTokens = logs.Sum(l => (long)(l.CompressedTokens ?? l.InputTokens ?? 0));
        result.Overview.TotalOutputTokens = logs.Sum(l => (long)(l.OutputTokens ?? 0));
        var latencies = logs.Where(l => l.LatencyMs.HasValue).Select(l => (double)l.LatencyMs!.Value).ToList();
        result.Overview.AvgLatencyMs = latencies.Count > 0 ? latencies.Average() : 0;
        result.Overview.ActiveDays = logs.Select(l => l.CreatedAt.LocalDateTime.Date).Distinct().Count();
        result.Overview.TodayMessages = logs.Count(l => l.CreatedAt.LocalDateTime.Date == today);
        result.Overview.TodayTokens = logs.Where(l => l.CreatedAt.LocalDateTime.Date == today).Sum(l => (long)(l.TokensUsed ?? 0));

        // 近 7 天按天趋势（含 0 填充）
        for (int i = 6; i >= 0; i--)
        {
            var day = today.AddDays(-i);
            var dayLogs = logs.Where(l => l.CreatedAt.LocalDateTime.Date == day).ToList();
            result.DailyTrend.Add(new UsageDayStat
            {
                Date = day.ToString("yyyy-MM-dd"),
                Messages = dayLogs.Count,
                Tokens = dayLogs.Sum(l => (long)(l.TokensUsed ?? 0)),
            });
        }

        // 近 365 天按天聚合（年热力图）
        var yearAgo = today.AddDays(-364);
        result.YearDaily = logs
            .Where(l => l.CreatedAt.LocalDateTime.Date >= yearAgo)
            .GroupBy(l => l.CreatedAt.LocalDateTime.Date)
            .Select(g => new UsageDayStat
            {
                Date = g.Key.ToString("yyyy-MM-dd"),
                Messages = g.Count(),
                Tokens = g.Sum(l => (long)(l.TokensUsed ?? 0)),
            })
            .OrderBy(d => d.Date)
            .ToList();

        // 近 7 天 日期×小时 聚合（周热力图）
        var weekAgo = today.AddDays(-6);
        result.WeekHourly = logs
            .Where(l => l.CreatedAt.LocalDateTime.Date >= weekAgo)
            .GroupBy(l => new { Day = l.CreatedAt.LocalDateTime.Date, Hour = l.CreatedAt.LocalDateTime.Hour })
            .Select(g => new UsageHourStat
            {
                Date = g.Key.Day.ToString("yyyy-MM-dd"),
                Hour = g.Key.Hour,
                Messages = g.Count(),
                Tokens = g.Sum(l => (long)(l.TokensUsed ?? 0)),
            })
            .ToList();

        // 按模型聚合
        result.ByModel = logs
            .GroupBy(l => l.ModelId)
            .Select(g => new UsageModelStat
            {
                ModelName = g.Key.HasValue && modelNames.TryGetValue(g.Key.Value, out var n) ? n : _localizer.T("usage.defaultModel"),
                Messages = g.Count(),
                Tokens = g.Sum(l => (long)(l.TokensUsed ?? 0)),
                CachedTokens = g.Sum(l => (long)(l.CachedTokens ?? 0)),
            })
            .OrderByDescending(m => m.Tokens)
            .ToList();

        // 按来源聚合（对话 / 编码会话 / 看板 / Wiki / ...）
        result.BySource = logs
            .GroupBy(l => l.Source)
            .Select(g => new UsageSourceStat
            {
                Source = g.Key,
                SourceName = LocalizeSource(g.Key),
                Messages = g.Count(),
                Tokens = g.Sum(l => (long)(l.TokensUsed ?? 0)),
            })
            .OrderByDescending(s => s.Tokens)
            .ToList();

        return result;
    }

    /// <summary>获取请求日志明细（分页）。可按来源与业务引用（话题 / 会话 / 任务）过滤。</summary>
    public async Task<List<UsageLogDto>> GetLogsAsync(
        int page = 1,
        int pageSize = 50,
        string? source = null,
        Guid? refId = null,
        CancellationToken ct = default)
    {
        var logs = await _unitOfWork.LlmUsageLogs.GetAllAsync(ct);
        var models = await _unitOfWork.AiModels.GetAllAsync(ct);
        var modelNames = models.ToDictionary(m => m.Id, m => string.IsNullOrWhiteSpace(m.DisplayName) ? m.ModelId : m.DisplayName);

        var query = logs.AsEnumerable();
        if (!string.IsNullOrWhiteSpace(source))
            query = query.Where(l => string.Equals(l.Source, source, StringComparison.OrdinalIgnoreCase));
        if (refId.HasValue)
            query = query.Where(l => l.RefId == refId.Value);

        return query
            .OrderByDescending(l => l.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(l => new UsageLogDto
            {
                MessageId = l.Id,
                TopicId = l.RefId ?? Guid.Empty,
                CreatedAt = l.CreatedAt,
                ModelName = l.ModelId.HasValue && modelNames.TryGetValue(l.ModelId.Value, out var n) ? n : _localizer.T("usage.defaultModel"),
                InputTokens = l.InputTokens,
                CompressedTokens = l.CompressedTokens,
                OutputTokens = l.OutputTokens,
                TokensUsed = l.TokensUsed,
                CachedTokens = l.CachedTokens,
                LatencyMs = l.LatencyMs,
                ContentPreview = l.ContentPreview ?? "",
                Source = l.Source,
                SourceName = LocalizeSource(l.Source),
            })
            .ToList();
    }
}
