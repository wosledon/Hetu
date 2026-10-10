import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
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
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { usageService, type IUsageLog } from '../services/usageService'
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
  const [heatTab, setHeatTab] = useState<HeatTab>('week')
  const [metric, setMetric] = useState<Metric>('tokens')
  const [trendRange, setTrendRange] = useState<'7d' | '30d' | '90d'>('7d')
  const isDark = useIsDark()

  const { data: stats, isLoading } = useQuery({
    queryKey: ['usageStats'],
    queryFn: usageService.getStats,
  })

  const overview = stats?.overview
  const byModel = stats?.byModel ?? []
const bySource = stats?.bySource ?? []

  // 趋势区间：基于 365 天按天数据零填充构建
  const rangeDays = trendRange === '7d' ? 7 : trendRange === '30d' ? 30 : 90
  const rangeLabel = trendRange === '7d' ? '近 7 天' : trendRange === '30d' ? '近 30 天' : '近 90 天'
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

  const textColor = isDark ? '#9ca3af' : '#6b7280'
  const metricLabel = metric === 'messages' ? '消息数' : 'Tokens'

  // 趋势曲线图（面积图）
  const trendOption = {
    grid: { left: 44, right: 12, top: 24, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: isDark ? '#1f2937' : '#fff',
      borderColor: isDark ? '#374151' : '#e5e7eb',
      textStyle: { color: isDark ? '#e5e7eb' : '#111827', fontSize: 12 },
      axisPointer: { type: 'line', lineStyle: { color: isDark ? '#374151' : '#e5e7eb' } },
      formatter: (ps: { axisValue: string; value: number }[]) =>
        `${ps[0].axisValue}<br/><b>${metricLabel}: ${fmtNum(ps[0].value)}</b>`,
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
    ],
  }

  // 模型分布环形图
  const PALETTE = ['#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#6366f1']
  const pieData = byModel.slice(0, 7)
  const pieOption = {
    tooltip: {
      backgroundColor: isDark ? '#1f2937' : '#fff',
      borderColor: isDark ? '#374151' : '#e5e7eb',
      textStyle: { color: isDark ? '#e5e7eb' : '#111827', fontSize: 12 },
      formatter: (p: { name: string; value: number; percent: number; dataIndex: number }) => {
        const m = pieData[p.dataIndex]
        const cached = m && m.cachedTokens > 0 ? `<br/>缓存 ${fmtNum(m.cachedTokens)} tokens` : ''
        return `${p.name}<br/><b>${fmtNum(p.value)} ${metric === 'messages' ? '条' : 'tokens'} (${p.percent}%)</b>${cached}`
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
        { label: '总 Tokens', value: fmtNum(overview.totalTokens), icon: Zap, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/10' },
        { label: '输入 / 压缩后', value: fmtNum(overview.totalInputTokens || 0), subValue: fmtNum(overview.totalCompressedTokens || 0), icon: Minimize2, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10' },
        { label: '输出 Tokens', value: fmtNum(overview.totalOutputTokens || 0), icon: Bot, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
        { label: '缓存 Tokens', value: fmtNum(overview.totalCachedTokens), icon: DatabaseZap, color: 'text-teal-500', bg: 'bg-teal-50 dark:bg-teal-500/10' },
        { label: '平均延迟', value: overview.avgLatencyMs > 0 ? `${(overview.avgLatencyMs / 1000).toFixed(2)}s` : '—', icon: Clock, color: 'text-violet-500', bg: 'bg-violet-50 dark:bg-violet-500/10' },
        { label: '活跃天数', value: String(overview.activeDays), icon: CalendarDays, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
        { label: '今日 Tokens', value: fmtNum(overview.todayTokens), icon: Zap, color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-500/10' },
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
                  <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">用量统计</h1>
                  <p className="text-xs text-gray-500 dark:text-gray-400">消息量与 Token 消耗的时间分布</p>
                </div>
              </div>
              {overview && (
                <div className="ml-auto flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                  <span><b className="text-sm font-semibold text-blue-600 dark:text-blue-400">{fmtNum(overview.todayTokens)}</b> 今日 Tokens</span>
                  <span className="h-3.5 w-px bg-gray-200 dark:bg-gray-700" />
                  <span><b className="text-sm font-semibold text-gray-700 dark:text-gray-200">{overview.activeDays}</b> 活跃天数</span>
                </div>
              )}
              {/* 指标切换 */}
              <div className="flex items-center gap-1 rounded-full bg-gray-100/80 p-1 dark:bg-white/[0.06]">
                {(['tokens', 'messages', 'logs'] as Metric[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMetric(m)}
                    className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all ${
                      metric === m
                        ? 'bg-white text-gray-800 shadow-sm dark:bg-white/10 dark:text-gray-100'
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    }`}
                  >
                    {m === 'tokens' ? 'Tokens' : m === 'messages' ? '消息数' : '请求日志'}
                  </button>
                ))}
              </div>
            </div>

            {isLoading ? (
              <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-gray-200 text-sm text-gray-400 dark:border-gray-800 dark:text-gray-500">
                <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-blue-500" />
                加载中...
              </div>
            ) : !stats ? (
              <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-gray-200 text-sm text-gray-400 dark:border-gray-800 dark:text-gray-500">暂无数据</div>
            ) : (
              <div className="space-y-6">
                {/* 概览卡片 */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                  {cards.map((c: typeof cards[number] & { subValue?: string }) => {
                    const Icon = c.icon
                    return (
                      <div key={c.label} className="rounded-2xl border border-gray-200 bg-white p-4 transition-all duration-200 hover:border-gray-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700">
                        <div className={`mb-2 flex h-8 w-8 items-center justify-center rounded-lg ${c.bg}`}>
                          <Icon size={15} className={c.color} />
                        </div>
                        <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{c.value}{c.subValue ? <span className="text-xs font-normal text-gray-400 dark:text-gray-500">/{c.subValue}</span> : null}</div>
                        <div className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">{c.label}</div>
                      </div>
                    )
                  })}
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
                            {rangeLabel}趋势
                          </h3>
                          <div className="flex items-center gap-1 rounded-full bg-gray-100/80 p-1 dark:bg-white/[0.06]">
                            {([
                              { key: '7d' as const, label: '7 天' },
                              { key: '30d' as const, label: '30 天' },
                              { key: '90d' as const, label: '90 天' },
                            ]).map((r) => (
                              <button
                                key={r.key}
                                onClick={() => setTrendRange(r.key)}
                                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
                                  trendRange === r.key
                                    ? 'bg-white text-gray-800 shadow-sm dark:bg-white/10 dark:text-gray-100'
                                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                                }`}
                              >
                                {r.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <ReactEChartsCore echarts={echarts} option={trendOption} style={{ height: 260, width: '100%' }} notMerge />
                      </div>

                      {/* 模型分布 */}
                      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
                          <Cpu size={15} className="text-violet-500" />
                          模型分布
                        </h3>
                        {byModel.length === 0 ? (
                          <p className="flex h-[220px] items-center justify-center text-xs text-gray-400 dark:text-gray-500">暂无数据</p>
                        ) : (
                          <ReactEChartsCore echarts={echarts} option={pieOption} style={{ height: 220, width: '100%' }} notMerge />
                        )}
                      </div>

                      {/* 来源分布：对话 / 编码会话 / 任务看板 / Wiki / ... */}
                      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
                          <Layers size={15} className="text-sky-500" />
                          调用来源
                        </h3>
                        {bySource.length === 0 ? (
                          <p className="flex h-[220px] items-center justify-center text-xs text-gray-400 dark:text-gray-500">暂无数据</p>
                        ) : (
                          <ul className="space-y-2">
                            {bySource.map((s) => {
                              const max = Math.max(...bySource.map(x => x.tokens), 1)
                              return (
                                <li key={s.source} className="flex items-center gap-2">
                                  <span className="w-20 shrink-0 truncate text-[11px] text-gray-600 dark:text-gray-300" title={s.sourceName}>
                                    {s.sourceName}
                                  </span>
                                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06]">
                                    <span
                                      className="block h-full rounded-full bg-sky-500/70"
                                      style={{ width: `${Math.round((s.tokens / max) * 100)}%` }}
                                    />
                                  </span>
                                  <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                                    {s.tokens >= 1000 ? `${(s.tokens / 1000).toFixed(1)}k` : s.tokens}
                                  </span>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    </div>

                    {/* 热力图 */}
                    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
                          <Calendar size={15} className="text-emerald-500" />
                          活跃热力
                        </h3>
                        <div className="flex items-center gap-1 rounded-full bg-gray-100/80 p-1 dark:bg-white/[0.06]">
                          <button
                            onClick={() => setHeatTab('week')}
                            className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                              heatTab === 'week'
                                ? 'bg-white text-gray-800 shadow-sm dark:bg-white/10 dark:text-gray-100'
                                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                            }`}
                          >
                            周 × 时
                          </button>
                          <button
                            onClick={() => setHeatTab('year')}
                            className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                              heatTab === 'year'
                                ? 'bg-white text-gray-800 shadow-sm dark:bg-white/10 dark:text-gray-100'
                                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                            }`}
                          >
                            年 × 日
                          </button>
                        </div>
                      </div>
                      {heatTab === 'week' ? (
                        <WeekHourHeatmap data={stats.weekHourly} metric={metric} />
                      ) : (
                        <YearHeatmap data={stats.yearDaily} metric={metric} />
                      )}
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

function UsageLogs() {
  const [modelFilter, setModelFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['usageLogs'],
    queryFn: () => usageService.getLogs(1, 100),
  })

  const models = useMemo(() => [...new Set(logs.map(l => l.modelName))].sort(), [logs])
  const sources = useMemo(
    () => [...new Map(logs.map(l => [l.source, l.sourceName || l.source])).entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [logs],
  )
  const filtered = logs.filter(l => {
    if (modelFilter && l.modelName !== modelFilter) return false
    if (sourceFilter && l.source !== sourceFilter) return false
    return true
  })

  const fmtTime = (s: string) => {
    const d = new Date(s)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
        <CalendarClock size={15} className="text-blue-500" />
        请求日志
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={sourceFilter}
            onChange={setSourceFilter}
            options={[{ value: '', label: '全部来源' }, ...sources]}
          />
          <Select
            value={modelFilter}
            onChange={setModelFilter}
            options={[{ value: '', label: '全部模型' }, ...models.map(m => ({ value: m, label: m }))]}
          />
        </div>
      </h3>
      {isLoading ? (
        <div className="flex h-32 items-center justify-center text-sm text-gray-400 dark:text-gray-500">加载中...</div>
      ) : filtered.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-gray-200 text-sm text-gray-400 dark:border-gray-800 dark:text-gray-500">暂无日志</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-400 dark:border-gray-800">
                <th className="whitespace-nowrap pb-2 pr-3 font-medium">时间</th>
                <th className="whitespace-nowrap pb-2 pr-3 font-medium">来源</th>
                <th className="whitespace-nowrap pb-2 pr-3 font-medium">模型</th>
                <th className="whitespace-nowrap pb-2 pr-3 font-medium text-right">输入</th>
                <th className="whitespace-nowrap pb-2 pr-3 font-medium text-right">压缩后</th>
                <th className="whitespace-nowrap pb-2 pr-3 font-medium text-right" title="压缩率 = 1 - 压缩后 / 压缩前，越大压得越多；0% 表示这条没有重复内容可压">压缩率</th>
                <th className="whitespace-nowrap pb-2 pr-3 font-medium text-right">输出</th>
                <th className="whitespace-nowrap pb-2 pr-3 font-medium text-right">总计</th>
                <th className="whitespace-nowrap pb-2 pr-3 font-medium text-right">延迟</th>
                <th className="whitespace-nowrap pb-2 font-medium">内容</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((log) => (
                <tr key={log.messageId} className="border-b border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-white/[0.02]">
                  <td className="whitespace-nowrap py-2 pr-3 text-gray-500">{fmtTime(log.createdAt)}</td>
                  <td className="whitespace-nowrap py-2 pr-3">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300">
                      {log.sourceName || log.source}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-gray-600 dark:text-gray-300">{log.modelName}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right text-blue-600 dark:text-blue-400">{log.inputTokens ?? '—'}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right text-violet-600 dark:text-violet-400">{log.compressedTokens ?? '—'}</td>
                  {(() => {
                    const ratio = compressionRatio(log)
                    if (ratio == null) return <td className="whitespace-nowrap py-2 pr-3 text-right text-gray-300 dark:text-gray-600">—</td>
                    const tone = ratio >= 0.5
                      ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                      : ratio >= 0.2
                        ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400'
                        : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400'
                    return (
                      <td className="whitespace-nowrap py-2 pr-3 text-right">
                        <span
                          title={`压缩前 ${log.inputTokens} → 压缩后 ${log.compressedTokens} 字符（压掉 ${(ratio * 100).toFixed(1)}%）`}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}
                        >
                          {(ratio * 100).toFixed(1)}%
                        </span>
                      </td>
                    )
                  })()}
                  <td className="whitespace-nowrap py-2 pr-3 text-right text-emerald-600 dark:text-emerald-400">{log.outputTokens ?? '—'}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right font-medium text-gray-700 dark:text-gray-200">{log.tokensUsed ?? '—'}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right text-gray-500">{log.latencyMs != null ? `${(log.latencyMs / 1000).toFixed(1)}s` : '—'}</td>
                  <td className="max-w-[160px] truncate py-2 text-gray-400">{log.contentPreview}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
