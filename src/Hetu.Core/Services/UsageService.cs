using System.Linq.Expressions;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;

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
        LlmUsageSources.Skill => _localizer.T("usage.sourceSkill"),
        LlmUsageSources.Graph => _localizer.T("usage.sourceGraph"),
        LlmUsageSources.Search => _localizer.T("usage.sourceSearch"),
        LlmUsageSources.Scheduled => _localizer.T("usage.sourceScheduled"),
        LlmUsageSources.Proxy => _localizer.T("usage.sourceProxy"),
        LlmUsageSources.Compression => _localizer.T("usage.sourceCompression"),
        _ => source,
    };

    /// <summary>请求类型展示名：区分主 Agent 请求与压缩 / 摘要 / 子 Agent 等辅助请求</summary>
    private string LocalizeRequestKind(string kind) => kind.ToLowerInvariant() switch
    {
        LlmUsageRequestKinds.Agent => _localizer.T("usage.kindAgent"),
        LlmUsageRequestKinds.SubAgent => _localizer.T("usage.kindSubAgent"),
        LlmUsageRequestKinds.Compression => _localizer.T("usage.kindCompression"),
        LlmUsageRequestKinds.Compaction => _localizer.T("usage.kindCompaction"),
        LlmUsageRequestKinds.Summarize => _localizer.T("usage.kindSummarize"),
        LlmUsageRequestKinds.Classify => _localizer.T("usage.kindClassify"),
        LlmUsageRequestKinds.Memory => _localizer.T("usage.kindMemory"),
        _ => kind,
    };

    public async Task<UsageStatsDto> GetStatsAsync(int days = 0, CancellationToken ct = default)
    {
        // 只投影统计需要的列（不加载实体与内容摘要），聚合/分组逻辑保持不变
        var logs = await _unitOfWork.LlmUsageLogs.SelectAsync(
            _ => true,
            l => new
            {
                l.CreatedAt,
                l.TokensUsed,
                l.CachedTokens,
                l.CacheCreationTokens,
                l.PromptTokens,
                l.InputTokens,
                l.CompressedTokens,
                l.OutputTokens,
                l.LatencyMs,
                l.ModelId,
                l.Source,
            },
            ct);
        var models = await _unitOfWork.AiModels.GetAllAsync(ct);
        var modelNames = models.ToDictionary(m => m.Id, m => string.IsNullOrWhiteSpace(m.DisplayName) ? m.ModelId : m.DisplayName);

        var today = DateTimeOffset.Now.Date;
        var result = new UsageStatsDto();

        // 页头全局时间选择：days>0 时按模型/来源的聚合只统计最近 N 天；概览与热力图保持原口径
        var aggLogs = days > 0
            ? logs.Where(l => l.CreatedAt.LocalDateTime.Date >= today.AddDays(-(days - 1))).ToList()
            : logs;

        result.Overview.TotalMessages = logs.Count;
        result.Overview.TotalTokens = logs.Sum(l => (long)(l.TokensUsed ?? 0));
        result.Overview.TotalCachedTokens = logs.Sum(l => (long)(l.CachedTokens ?? 0));
        result.Overview.TotalCacheCreationTokens = logs.Sum(l => (long)(l.CacheCreationTokens ?? 0));
        result.Overview.TotalPromptTokens = logs.Sum(l => (long)(l.PromptTokens ?? 0));
        // 命中率分母用 Provider 实报的 Prompt（含缓存读取），而不是字符估算值
        result.Overview.CacheHitRate = result.Overview.TotalPromptTokens > 0
            ? (double)result.Overview.TotalCachedTokens / result.Overview.TotalPromptTokens
            : null;
        // 输入 / 压缩后只统计真正走过压缩管道的请求（每轮首次）：
        // 逐次请求行里其余迭代没有压缩，把它们的估算加进来会把压缩率稀释成接近 0
        var compressedLogs = logs.Where(l => l.CompressedTokens.HasValue).ToList();
        result.Overview.TotalInputTokens = compressedLogs.Sum(l => (long)(l.InputTokens ?? 0));
        result.Overview.TotalCompressedTokens = compressedLogs.Sum(l => (long)(l.CompressedTokens ?? 0));
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

        // 近 90 天按 日期×模型 聚合（趋势图按模型拆分），模型展示名在此解析一次
        var defaultModelName = _localizer.T("usage.defaultModel");
        string NameOf(Guid? id) => id.HasValue && modelNames.TryGetValue(id.Value, out var n) ? n : defaultModelName;
        var trendAgo = today.AddDays(-89);
        result.DailyByModel = logs
            .Where(l => l.CreatedAt.LocalDateTime.Date >= trendAgo)
            .GroupBy(l => new { Date = l.CreatedAt.LocalDateTime.Date, Name = NameOf(l.ModelId) })
            .Select(g => new UsageModelDayStat
            {
                Date = g.Key.Date.ToString("yyyy-MM-dd"),
                ModelName = g.Key.Name,
                Messages = g.Count(),
                Tokens = g.Sum(l => (long)(l.TokensUsed ?? 0)),
            })
            .OrderBy(d => d.Date)
            .ThenBy(d => d.ModelName)
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
        result.ByModel = aggLogs
            .GroupBy(l => l.ModelId)
            .Select(g => new UsageModelStat
            {
                ModelName = g.Key.HasValue && modelNames.TryGetValue(g.Key.Value, out var n) ? n : _localizer.T("usage.defaultModel"),
                Messages = g.Count(),
                Tokens = g.Sum(l => (long)(l.TokensUsed ?? 0)),
                CachedTokens = g.Sum(l => (long)(l.CachedTokens ?? 0)),
                PromptTokens = g.Sum(l => (long)(l.PromptTokens ?? 0)),
            })
            .OrderByDescending(m => m.Tokens)
            .ToList();

        // 按来源聚合（对话 / 编码会话 / 看板 / Wiki / ...）
        result.BySource = aggLogs
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

        // 按来源×模型聚合（调用来源条形图按模型堆叠，模型名复用上面的解析）
        result.BySourceByModel = aggLogs
            .GroupBy(l => new { l.Source, Name = NameOf(l.ModelId) })
            .Select(g => new UsageSourceModelStat
            {
                Source = g.Key.Source,
                SourceName = LocalizeSource(g.Key.Source),
                ModelName = g.Key.Name,
                Messages = g.Count(),
                Tokens = g.Sum(l => (long)(l.TokensUsed ?? 0)),
            })
            .OrderByDescending(x => x.Tokens)
            .ToList();

        return result;
    }

    /// <summary>获取请求日志明细（数据库分页，含总数）。可按来源、模型、业务引用（话题 / 会话 / 任务）与轮次过滤。</summary>
    public async Task<PagedResult<UsageLogDto>> GetLogsAsync(
        int page = 1,
        int pageSize = 50,
        string? source = null,
        string? model = null,
        Guid? refId = null,
        Guid? turnId = null,
        CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var sourceFilter = string.IsNullOrWhiteSpace(source) ? null : source.Trim();
        var modelFilter = string.IsNullOrWhiteSpace(model) ? null : model.Trim();
        var refFilter = refId;
        var turnFilter = turnId;
        var models = await _unitOfWork.AiModels.GetAllAsync(ct);
        var modelNames = models.ToDictionary(m => m.Id, m => string.IsNullOrWhiteSpace(m.DisplayName) ? m.ModelId : m.DisplayName);
        var defaultModelName = _localizer.T("usage.defaultModel");

        // 模型筛选按展示名解析成 ID 集合；ModelId 为空的记录归入默认模型
        var modelFilterIds = new List<Guid>();
        if (modelFilter != null)
        {
            modelFilterIds.AddRange(
                models.Where(m => (string.IsNullOrWhiteSpace(m.DisplayName) ? m.ModelId : m.DisplayName) == modelFilter)
                    .Select(m => m.Id));
        }

        Expression<Func<LlmUsageLog, bool>> predicate = l =>
            (sourceFilter == null || l.Source == sourceFilter) &&
            (refFilter == null || l.RefId == refFilter) &&
            (turnFilter == null || l.TurnId == turnFilter) &&
            (modelFilter == null ||
                (l.ModelId == null
                    ? defaultModelName == modelFilter
                    : modelFilterIds.Contains(l.ModelId.Value)));

        // 过滤与分页下推到数据库：用量日志会随每次 LLM 调用增长，不再整表加载
        var total = await _unitOfWork.LlmUsageLogs.CountAsync(predicate, ct);
        var logs = await _unitOfWork.LlmUsageLogs.GetPagedByDateAsync(
            predicate,
            l => l.CreatedAt,
            descending: true,
            skip: (page - 1) * pageSize,
            take: pageSize,
            ct);

        return new PagedResult<UsageLogDto>
        {
            Items = logs
                .Select(l => new UsageLogDto
                {
                    MessageId = l.Id,
                    TopicId = l.RefId ?? Guid.Empty,
                    TurnId = l.TurnId,
                    Iteration = l.Iteration,
                    RequestKind = l.RequestKind,
                    RequestKindName = LocalizeRequestKind(l.RequestKind),
                    CreatedAt = l.CreatedAt,
                    ModelName = l.ModelId.HasValue && modelNames.TryGetValue(l.ModelId.Value, out var n) ? n : defaultModelName,
                    InputTokens = l.InputTokens,
                    CompressedTokens = l.CompressedTokens,
                    PromptTokens = l.PromptTokens,
                    OutputTokens = l.OutputTokens,
                    TokensUsed = l.TokensUsed,
                    CachedTokens = l.CachedTokens,
                    CacheCreationTokens = l.CacheCreationTokens,
                    LatencyMs = l.LatencyMs,
                    FinishReason = l.FinishReason,
                    ToolCallCount = l.ToolCallCount,
                    ContentPreview = l.ContentPreview ?? "",
                    Source = l.Source,
                    SourceName = LocalizeSource(l.Source),
                })
                .ToList(),
            TotalCount = total,
            Page = page,
            PageSize = pageSize,
        };
    }
}
