import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import ReactEChartsCore from 'echarts-for-react/esm/core'
import echarts from '../utils/echarts'
import {
  Gauge,
  Zap,
  Clock,
  CalendarDays,
  Calendar,
  CalendarClock,
  Cpu,
  DatabaseZap,
  Layers,
  Minimize2,
  Bot,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import SlidingPill from '../components/SlidingPill'
import { usageService, type IUsageLog, type IUsageModelDayStat, type IUsageSourceModelStat } from '../services/usageService'
import { WeekHourHeatmap, YearHeatmap } from '../components/UsageHeatmap'
import { useIsDark } from '../hooks/useIsDark'
import Select from '../components/Select'

type HeatTab = 'week' | 'year'
type Metric = 'messages' | 'tokens' | 'logs'

function fmtNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

/**
 * 压缩率 = 1 - 压缩后 / 压缩前（管道口径，都是字符数），即「压掉了多少」。
 * 前后一样就是 0%，没压过或没有记录时返回 null。
 */
function compressionRatio(log: IUsageLog): number | null {
  if (!log.inputTokens || log.compressedTokens == null) return null
  return Math.max(0, 1 - log.compressedTokens / log.inputTokens)
}

export default function UsagePage() {
  const { t } = useTranslation('settings')
  const [heatTab, setHeatTab] = useState<HeatTab>('week')
  const [metric, setMetric] = useState<Metric>('tokens')
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d'>('7d')
  const isDark = useIsDark()

  const rangeDays = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90
  const rangeLabel = dateRange === '7d' ? t('usage.range7d') : dateRange === '30d' ? t('usage.range30d') : t('usage.range90d')

  // 模型分布 / 调用来源 / 趋势共用页头的全局时间选择，切范围时保留旧数据避免闪屏
  const { data: stats, isLoading } = useQuery({
    queryKey: ['usageStats', rangeDays],
    queryFn: () => usageService.getStats(rangeDays),
    placeholderData: keepPreviousData,
  })

  const overview = stats?.overview
  const byModel = stats?.byModel ?? []
const bySource = stats?.bySource ?? []

  // 趋势区间：基于 365 天按天数据零填充构建
  const trend = useMemo(() => {
    const map = new Map((stats?.yearDaily ?? []).map((d) => [d.date, d]))
    const out: { date: string; messages: number; tokens: number }[] = []
    const today = new Date()
    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const hit = map.get(iso)
      out.push({ date: iso, messages: hit?.messages ?? 0, tokens: hit?.tokens ?? 0 })
    }
    return out
  }, [stats, rangeDays])

  // 按模型拆分的系列（与环形图同序取色）：近 90 天 日期×模型 数据按当前区间零填充
  const trendByModel = useMemo(() => {
    const rows = new Map<string, Pick<IUsageModelDayStat, 'messages' | 'tokens'>>()
    for (const r of stats?.dailyByModel ?? []) rows.set(`${r.date}|${r.modelName}`, r)
    const key = metric === 'messages' ? ('messages' as const) : ('tokens' as const)
    return (stats?.byModel ?? [])
      .map((m) => ({
        name: m.modelName,
        data: trend.map((d) => rows.get(`${d.date}|${m.modelName}`)?.[key] ?? 0),
      }))
      .filter((s) => s.data.some((v) => v > 0))
  }, [stats, trend, metric])

  const textColor = isDark ? '#9ca3af' : '#6b7280'
  const metricLabel = metric === 'messages' ? t('metrics.messages') : t('metrics.tokens')
  const PALETTE = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#6366f1', '#f43f5e', '#14b8a6', '#a855f7']

  // 趋势曲线图：总量面积线 + 各模型细线同图展示
  const totalName = t('usage.trendTotal')
  const trendOption = {
    grid: { left: 44, right: 12, top: 40, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: isDark ? '#1f2937' : '#fff',
      borderColor: isDark ? '#374151' : '#e5e7eb',
      textStyle: { color: isDark ? '#e5e7eb' : '#111827', fontSize: 12 },
      axisPointer: { type: 'line', lineStyle: { color: isDark ? '#374151' : '#e5e7eb' } },
      formatter: (ps: { axisValue: string; marker: string; seriesName: string; value: number }[]) => {
        const lines = ps
          .filter((p) => p.value > 0)
          .map((p) => `${p.marker} ${p.seriesName}: <b>${fmtNum(p.value)}</b>`)
        return `${ps[0]?.axisValue ?? ''}<br/>${(lines.length > 0 ? lines : [`${metricLabel}: 0`]).join('<br/>')}`
      },
    },
    legend: {
      top: 0,
      right: 0,
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: textColor, fontSize: 10 },
      type: 'scroll',
    },
    xAxis: {
      type: 'category',
      data: trend.map((d) => d.date.slice(5)),
      axisLine: { lineStyle: { color: isDark ? '#374151' : '#e5e7eb' } },
      axisTick: { show: false },
      axisLabel: { color: textColor, fontSize: 11, interval: rangeDays > 30 ? Math.floor(rangeDays / 8) : rangeDays > 7 ? 3 : 0 },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: textColor, fontSize: 10, formatter: (v: number) => fmtNum(v) },
      splitLine: { lineStyle: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' } },
    },
    series: [
      {
        name: totalName,
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: rangeDays > 30 ? 0 : 6,
        showSymbol: rangeDays <= 30,
        sampling: 'lttb',
        data: trend.map((d) => (metric === 'messages' ? d.messages : d.tokens)),
        lineStyle: { width: 2.5, color: '#3b82f6' },
        itemStyle: { color: '#3b82f6', borderColor: '#fff', borderWidth: 2 },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: isDark ? 'rgba(59,130,246,0.35)' : 'rgba(59,130,246,0.25)' },
              { offset: 1, color: 'rgba(59,130,246,0.02)' },
            ],
          },
        },
        emphasis: { itemStyle: { color: '#2563eb' } },
      },
      // 模型细线：与模型分布环形图共用同一色板，同一模型颜色一致
      ...trendByModel.map((s, i) => ({
        name: s.name,
        type: 'line' as const,
        smooth: true,
        symbol: 'circle',
        symbolSize: rangeDays > 30 ? 0 : 4,
        showSymbol: rangeDays <= 30,
        sampling: 'lttb',
        connectNulls: true,
        lineStyle: { width: 1.6, color: PALETTE[i % PALETTE.length] },
        itemStyle: { color: PALETTE[i % PALETTE.length] },
        emphasis: { focus: 'series' as const },
        data: s.data,
      })),
    ],
  }

  // 调用来源：横向堆叠条形图，按模型区分（模型颜色与趋势图 / 模型分布一致）
  const sourceRows = [...bySource].sort((a, b) =>
    metric === 'messages' ? b.messages - a.messages : b.tokens - a.tokens,
  )
  const sourceValueKey = metric === 'messages' ? ('messages' as const) : ('tokens' as const)
  const sourceModelValues = new Map<string, Pick<IUsageSourceModelStat, 'messages' | 'tokens'>>()
  for (const r of stats?.bySourceByModel ?? []) sourceModelValues.set(`${r.source}|${r.modelName}`, r)
  const sourceModels = (stats?.byModel ?? []).map((m) => m.modelName)
  const sourceChartHeight = Math.min(420, sourceRows.length * 34 + 40)
  const sourceOption = {
    grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: isDark ? '#1f2937' : '#fff',
      borderColor: isDark ? '#374151' : '#e5e7eb',
      textStyle: { color: isDark ? '#e5e7eb' : '#111827', fontSize: 12 },
      axisPointer: { type: 'shadow', shadowStyle: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' } },
      formatter: (ps: { axisValue: string; marker: string; seriesName: string; value: number }[]) => {
        const rows = ps.filter((p) => p.value > 0)
        const total = rows.reduce((sum, p) => sum + p.value, 0)
        const lines = rows.map((p) => `${p.marker} ${p.seriesName}: <b>${fmtNum(p.value)}</b>`)
        lines.push(`${metricLabel}: <b>${fmtNum(total)}</b>`)
        return `${ps[0]?.axisValue ?? ''}<br/>${(lines.length > 0 ? lines : [`${metricLabel}: 0`]).join('<br/>')}`
      },
    },
    legend: {
      top: 0,
      right: 0,
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: textColor, fontSize: 10 },
      type: 'scroll',
    },
    xAxis: {
      type: 'value',
      axisLabel: { color: textColor, fontSize: 10, formatter: (v: number) => fmtNum(v) },
      splitLine: { lineStyle: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: sourceRows.map((s) => s.sourceName),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: isDark ? '#d1d5db' : '#374151', fontSize: 11 },
    },
    series: sourceModels.map((mn, mi) => ({
      name: mn,
      type: 'bar' as const,
      stack: 'src',
      barWidth: 16,
      data: sourceRows.map(
        (s) => sourceModelValues.get(`${s.source}|${mn}`)?.[sourceValueKey] ?? 0,
      ),
      itemStyle: { color: PALETTE[mi % PALETTE.length] },
    })),
  }

  // 模型分布环形图
  const pieData = byModel.slice(0, 7)
  const pieOption = {
    tooltip: {
      backgroundColor: isDark ? '#1f2937' : '#fff',
      borderColor: isDark ? '#374151' : '#e5e7eb',
      textStyle: { color: isDark ? '#e5e7eb' : '#111827', fontSize: 12 },
      formatter: (p: { name: string; value: number; percent: number; dataIndex: number }) => {
        const m = pieData[p.dataIndex]
        const cached = m && m.cachedTokens > 0 ? `<br/>${t('usage.tooltipCached', { value: fmtNum(m.cachedTokens) })}` : ''
        return `${p.name}<br/><b>${fmtNum(p.value)} ${metric === 'messages' ? t('usage.unitMessages') : t('usage.unitTokens')} (${p.percent}%)</b>${cached}`
      },
    },
    legend: {
      bottom: 0,
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: textColor, fontSize: 10 },
      type: 'scroll',
    },
    series: [
      {
        type: 'pie',
        radius: ['52%', '74%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: isDark ? '#0c0f1a' : '#fff', borderWidth: 2, borderRadius: 6 },
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 13, fontWeight: 600, color: isDark ? '#e5e7eb' : '#111827', formatter: '{b}\n{d}%' } },
        data: pieData.map((m, i) => ({
          name: m.modelName,
          value: metric === 'messages' ? m.messages : m.tokens,
          itemStyle: { color: PALETTE[i % PALETTE.length] },
        })),
      },
    ],
  }

  const cards = overview
    ? [
        { label: t('usage.totalTokens'), value: fmtNum(overview.totalTokens), icon: Zap, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/10' },
        { label: t('usage.inputCompressed'), value: fmtNum(overview.totalInputTokens || 0), subValue: fmtNum(overview.totalCompressedTokens || 0), icon: Minimize2, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10' },
        { label: t('usage.outputTokens'), value: fmtNum(overview.totalOutputTokens || 0), icon: Bot, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
        { label: t('usage.cachedTokens'), value: fmtNum(overview.totalCachedTokens), icon: DatabaseZap, color: 'text-teal-500', bg: 'bg-teal-50 dark:bg-teal-500/10' },
        { label: t('usage.avgLatency'), value: overview.avgLatencyMs > 0 ? `${(overview.avgLatencyMs / 1000).toFixed(2)}s` : '—', icon: Clock, color: 'text-violet-500', bg: 'bg-violet-50 dark:bg-violet-500/10' },
        { label: t('usage.activeDays'), value: String(overview.activeDays), icon: CalendarDays, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
        { label: t('usage.todayTokens'), value: fmtNum(overview.todayTokens), icon: Zap, color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-500/10' },
      ]
    : []

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
          <div className="mx-auto max-w-6xl px-8 py-8">
            {/* Header */}
            <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm shadow-blue-500/20">
                  <Gauge size={20} className="text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('usage.title')}</h1>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('usage.subtitle')}</p>
                </div>
              </div>
            </div>

            {isLoading ? (
              <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-gray-200 text-sm text-gray-400 dark:border-gray-800 dark:text-gray-500">
                <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-blue-500" />
                {t('common:loading')}
              </div>
            ) : !stats ? (
              <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-gray-200 text-sm text-gray-400 dark:border-gray-800 dark:text-gray-500">{t('common:empty')}</div>
            ) : (
              <div className="space-y-6">
                {/* 概览指标：单卡分栏，避免 7 个同尺寸卡片挤成一行 */}
                <div className="rounded-2xl border border-gray-200 bg-white px-1 py-4 dark:border-gray-800 dark:bg-gray-900">
                  <div className="grid grid-cols-2 gap-y-4 sm:grid-cols-4 xl:grid-cols-7">
                    {cards.map((c: typeof cards[number] & { subValue?: string }) => {
                      const Icon = c.icon
                      return (
                        <div key={c.label} className="min-w-0 px-4 xl:border-l xl:border-gray-100 xl:first:border-l-0 dark:xl:border-white/[0.06]">
                          <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                            <Icon size={12} className={`shrink-0 ${c.color}`} />
                            <span className="truncate">{c.label}</span>
                          </div>
                          <div className="mt-1 text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                            {c.value}{c.subValue ? <span className="ml-0.5 text-xs font-normal text-gray-400 dark:text-gray-500">/{c.subValue}</span> : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* 活跃热力：第二行整行 */}
                <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
                      <Calendar size={15} className="text-emerald-500" />
                      {t('usage.activity')}
                    </h3>
                    <SlidingPill value={heatTab} className="flex items-center gap-1 rounded-full bg-gray-100/80 p-1 dark:bg-white/[0.06]">
                      <button
                        onClick={() => setHeatTab('week')}
                        data-pill-key="week"
                        className={`relative rounded-full px-3 py-1 text-xs font-medium transition-all ${
                          heatTab === 'week'
                            ? 'text-gray-800 dark:text-gray-100'
                            : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                        }`}
                      >
                        {t('usage.heatWeek')}
                      </button>
                      <button
                        onClick={() => setHeatTab('year')}
                        data-pill-key="year"
                        className={`relative rounded-full px-3 py-1 text-xs font-medium transition-all ${
                          heatTab === 'year'
                            ? 'text-gray-800 dark:text-gray-100'
                            : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                        }`}
                      >
                        {t('usage.heatYear')}
                      </button>
                    </SlidingPill>
                  </div>
                  {heatTab === 'week' ? (
                    <WeekHourHeatmap data={stats.weekHourly} metric={metric === 'logs' ? 'messages' : metric} />
                  ) : (
                    <YearHeatmap data={stats.yearDaily} metric={metric === 'logs' ? 'messages' : metric} />
                  )}
                </div>

                {/* 全局时间选择 + 指标切换（作用于热力图下方的趋势 / 模型分布 / 调用来源） */}
                <div className="flex items-center justify-end gap-2">
                  <SlidingPill value={dateRange} className="flex items-center gap-1 rounded-full bg-gray-100/80 p-1 dark:bg-white/[0.06]">
                    {([
                      { key: '7d' as const, labelKey: 'usage.days7' },
                      { key: '30d' as const, labelKey: 'usage.days30' },
                      { key: '90d' as const, labelKey: 'usage.days90' },
                    ]).map((r) => (
                      <button
                        key={r.key}
                        onClick={() => setDateRange(r.key)}
                        data-pill-key={r.key}
                        className={`relative rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
                          dateRange === r.key
                            ? 'text-gray-800 dark:text-gray-100'
                            : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                        }`}
                      >
                        {t(r.labelKey)}
                      </button>
                    ))}
                  </SlidingPill>
                  <SlidingPill value={metric} className="flex items-center gap-1 rounded-full bg-gray-100/80 p-1 dark:bg-white/[0.06]">
                    {(['tokens', 'messages', 'logs'] as Metric[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMetric(m)}
                        data-pill-key={m}
                        className={`relative rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all ${
                          metric === m
                            ? 'text-gray-800 dark:text-gray-100'
                            : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                        }`}
                      >
                        {m === 'tokens' ? t('metrics.tokens') : m === 'messages' ? t('metrics.messages') : t('usage.logs')}
                      </button>
                    ))}
                  </SlidingPill>
                </div>

                {metric === 'logs' ? (
                  <UsageLogs />
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                      {/* 趋势 */}
                      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900 lg:col-span-2">
                        <div className="mb-2 flex items-center justify-between">
                          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
                            <CalendarClock size={15} className="text-blue-500" />
                            {t('usage.trend', { range: rangeLabel })}
                          </h3>
                        </div>
                        <ReactEChartsCore echarts={echarts} option={trendOption} style={{ height: 260, width: '100%' }} notMerge />
                      </div>

                      {/* 模型分布 */}
                      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
                          <Cpu size={15} className="text-violet-500" />
                          {t('usage.modelDistribution')}
                        </h3>
                        {byModel.length === 0 ? (
                          <p className="flex h-[220px] items-center justify-center text-xs text-gray-400 dark:text-gray-500">{t('common:empty')}</p>
                        ) : (
                          <ReactEChartsCore echarts={echarts} option={pieOption} style={{ height: 220, width: '100%' }} notMerge />
                        )}
                      </div>

                      {/* 来源分布：对话 / 编码会话 / 任务看板 / Wiki / ... */}
                      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900 lg:col-span-3">
                        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
                          <Layers size={15} className="text-sky-500" />
                          {t('usage.callSources')}
                        </h3>
                        {bySource.length === 0 ? (
                          <p className="flex h-[120px] items-center justify-center text-xs text-gray-400 dark:text-gray-500">{t('common:empty')}</p>
                        ) : (
                          <ReactEChartsCore echarts={echarts} option={sourceOption} style={{ height: sourceChartHeight, width: '100%' }} notMerge />
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      }
    />
  )
}

const LOGS_PAGE_SIZE = 20

function UsageLogs() {
  const { t } = useTranslation('settings')
  const [page, setPage] = useState(1)
  const [modelFilter, setModelFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')

  // 筛选项来自全量统计（不受当前页限制），日志本体按页从服务端拉取
  const { data: stats } = useQuery({ queryKey: ['usageStats'], queryFn: () => usageService.getStats() })
  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: ['usageLogs', page, sourceFilter, modelFilter],
    queryFn: () =>
      usageService.getLogs(page, LOGS_PAGE_SIZE, sourceFilter || undefined, undefined, modelFilter || undefined),
    placeholderData: keepPreviousData,
  })
  const logs = data?.items ?? []
  const totalPages = Math.max(1, data?.totalPages ?? 1)

  const models = useMemo(
    () => (stats?.byModel ?? []).map((m) => ({ value: m.modelName, label: m.modelName })),
    [stats],
  )
  const sources = useMemo(
    () => (stats?.bySource ?? [])
      .map((s) => ({ value: s.source, label: s.sourceName || s.source }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [stats],
  )

  const changeSource = (v: string) => { setSourceFilter(v); setPage(1) }
  const changeModel = (v: string) => { setModelFilter(v); setPage(1) }

  const fmtDate = (s: string) => {
    const d = new Date(s)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  const fmtTime = (s: string) => {
    const d = new Date(s)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  const pageBtnClass =
    'flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.06]'

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
        <CalendarClock size={15} className="text-blue-500" />
        {t('usage.logs')}
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={sourceFilter}
            onChange={changeSource}
            options={[{ value: '', label: t('usage.allSources') }, ...sources]}
          />
          <Select
            value={modelFilter}
            onChange={changeModel}
            options={[{ value: '', label: t('usage.allModels') }, ...models]}
          />
        </div>
      </h3>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-gray-100 dark:bg-white/[0.06]" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-gray-200 text-sm text-gray-400 dark:border-gray-800 dark:text-gray-500">{t('usage.noLogs')}</div>
      ) : (
        <>
          <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left text-[11px] text-gray-400 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-500">
                    <th className="whitespace-nowrap px-3 py-2.5 font-medium">{t('usage.time')}</th>
                    <th className="whitespace-nowrap px-3 py-2.5 font-medium">{t('usage.source')}</th>
                    <th className="whitespace-nowrap px-3 py-2.5 font-medium">{t('usage.model')}</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">{t('usage.input')}</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">{t('usage.compressed')}</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium" title={t('usage.ratioHint')}>{t('usage.compressionRatio')}</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium" title={t('usage.cacheHitHint')}>{t('usage.cached')}</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">{t('usage.output')}</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">{t('usage.total')}</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">{t('usage.latency')}</th>
                    <th className="whitespace-nowrap px-3 py-2.5 font-medium">{t('usage.content')}</th>
                  </tr>
                </thead>
                <tbody className={`transition-opacity ${isPlaceholderData ? 'opacity-60' : ''}`}>
                  {logs.map((log) => {
                    const ratio = compressionRatio(log)
                    const latency = log.latencyMs
                    const latencyTone =
                      latency == null
                        ? 'text-gray-400 dark:text-gray-500'
                        : latency < 1000
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : latency < 3000
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-rose-600 dark:text-rose-400'
                    return (
                      <tr
                        key={log.messageId}
                        className="border-b border-gray-100 odd:bg-white even:bg-gray-50/60 hover:bg-blue-50/60 last:border-0 dark:border-gray-800 dark:odd:bg-transparent dark:even:bg-white/[0.02] dark:hover:bg-white/[0.04]"
                      >
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                          <div className="text-gray-600 dark:text-gray-300">{fmtTime(log.createdAt)}</div>
                          <div className="text-[10px] text-gray-400 dark:text-gray-500">{fmtDate(log.createdAt)}</div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300">
                            {log.sourceName || log.source}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-gray-300">{log.modelName}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-blue-600 dark:text-blue-400">{log.inputTokens ?? '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-violet-600 dark:text-violet-400">{log.compressedTokens ?? '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {ratio == null ? (
                            <span className="text-gray-300 dark:text-gray-600">—</span>
                          ) : (
                            <span
                              title={t('usage.ratioTooltip', { before: log.inputTokens, after: log.compressedTokens, percent: (ratio * 100).toFixed(1) })}
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                ratio >= 0.5
                                  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                                  : ratio >= 0.2
                                    ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400'
                                    : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400'
                              }`}
                            >
                              {(ratio * 100).toFixed(1)}%
                            </span>
                          )}
                        </td>
                        {(() => {
                          const cached = log.cachedTokens
                          const hitBase = log.compressedTokens ?? log.inputTokens ?? 0
                          const hit = cached != null && hitBase > 0 ? Math.min(cached / hitBase, 1) : null
                          if (hit == null) return <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-300 dark:text-gray-600">—</td>
                          const tone = hit >= 0.5
                            ? 'bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400'
                            : hit > 0
                              ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400'
                              : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400'
                          return (
                            <td className="whitespace-nowrap px-3 py-2 text-right" title={t('usage.tooltipCached', { value: cached ?? 0 })}>
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${tone}`}>
                                {(hit * 100).toFixed(1)}%
                              </span>
                            </td>
                          )
                        })()}
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{log.outputTokens ?? '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-gray-700 dark:text-gray-200">{log.tokensUsed ?? '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          <span className={latencyTone}>{latency != null ? `${(latency / 1000).toFixed(1)}s` : '—'}</span>
                        </td>
                        <td className="max-w-[160px] truncate px-3 py-2 text-gray-400 dark:text-gray-500" title={log.contentPreview}>{log.contentPreview}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              {t('usage.pageInfo', { page, totalPages })} · {t('usage.totalLogs', { count: data?.totalCount ?? 0 })}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || isPlaceholderData}
                className={pageBtnClass}
              >
                <ChevronLeft size={13} />
                {t('usage.prevPage')}
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages || isPlaceholderData}
                className={pageBtnClass}
              >
                {t('usage.nextPage')}
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
