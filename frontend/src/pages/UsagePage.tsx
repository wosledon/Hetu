import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import ReactECharts from 'echarts-for-react'
import {
  Gauge,
  Zap,
  Clock,
  CalendarDays,
  Calendar,
  CalendarClock,
  Cpu,
  DatabaseZap,
  Minimize2,
  Bot,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { usageService } from '../services/usageService'
import { WeekHourHeatmap, YearHeatmap, useIsDark } from '../components/UsageHeatmap'
import Select from '../components/Select'

type HeatTab = 'week' | 'year'
type Metric = 'messages' | 'tokens' | 'logs'

function fmtNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

export default function UsagePage() {
  const [heatTab, setHeatTab] = useState<HeatTab>('week')
  const [metric, setMetric] = useState<Metric>('tokens')
  const isDark = useIsDark()

  const { data: stats, isLoading } = useQuery({
    queryKey: ['usageStats'],
    queryFn: usageService.getStats,
  })

  const overview = stats?.overview
  const trend = stats?.dailyTrend ?? []
  const byModel = stats?.byModel ?? []

  const textColor = isDark ? '#9ca3af' : '#6b7280'
  const metricLabel = metric === 'messages' ? '消息数' : 'Tokens'

  // 近 7 天趋势柱状图
  const trendOption = {
    grid: { left: 44, right: 12, top: 24, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: isDark ? '#1f2937' : '#fff',
      borderColor: isDark ? '#374151' : '#e5e7eb',
      textStyle: { color: isDark ? '#e5e7eb' : '#111827', fontSize: 12 },
      axisPointer: { type: 'shadow' },
      formatter: (ps: { axisValue: string; value: number }[]) =>
        `${ps[0].axisValue}<br/><b>${metricLabel}: ${fmtNum(ps[0].value)}</b>`,
    },
    xAxis: {
      type: 'category',
      data: trend.map((d) => d.date.slice(5)),
      axisLine: { lineStyle: { color: isDark ? '#374151' : '#e5e7eb' } },
      axisTick: { show: false },
      axisLabel: { color: textColor, fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: textColor, fontSize: 10, formatter: (v: number) => fmtNum(v) },
      splitLine: { lineStyle: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' } },
    },
    series: [
      {
        type: 'bar',
        data: trend.map((d) => (metric === 'messages' ? d.messages : d.tokens)),
        barWidth: '55%',
        itemStyle: {
          borderRadius: [6, 6, 0, 0],
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: '#60a5fa' },
              { offset: 1, color: '#3b82f6' },
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
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-6 py-8">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
                  <Gauge size={22} className="text-blue-500" />
                  用量统计
                </h1>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">消息量与 Token 消耗的时间分布</p>
              </div>
              {/* 指标切换 */}
              <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-white/[0.06]">
                {(['tokens', 'messages', 'logs'] as Metric[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMetric(m)}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                      metric === m
                        ? 'bg-white text-blue-600 shadow-sm dark:bg-white/10 dark:text-blue-300'
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    }`}
                  >
                    {m === 'tokens' ? 'Tokens' : m === 'messages' ? '消息数' : '请求日志'}
                  </button>
                ))}
              </div>
            </div>

            {isLoading ? (
              <div className="flex h-64 items-center justify-center text-sm text-gray-400">
                <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-blue-500" />
                加载中...
              </div>
            ) : !stats ? (
              <div className="flex h-64 items-center justify-center text-sm text-gray-400">暂无数据</div>
            ) : (
              <div className="space-y-6">
                {/* 概览卡片 */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                  {cards.map((c: typeof cards[number] & { subValue?: string }) => {
                    const Icon = c.icon
                    return (
                      <div key={c.label} className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03]">
                        <div className={`mb-2 flex h-8 w-8 items-center justify-center rounded-lg ${c.bg}`}>
                          <Icon size={15} className={c.color} />
                        </div>
                        <div className="text-xl font-bold text-gray-900 dark:text-gray-50">{c.value}{c.subValue ? <span className="text-xs font-normal text-gray-400">/{c.subValue}</span> : null}</div>
                        <div className="mt-0.5 text-[11px] text-gray-400">{c.label}</div>
                      </div>
                    )
                  })}
                </div>

                {metric === 'logs' ? (
                  <UsageLogs />
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                      {/* 近 7 天趋势 */}
                      <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03] lg:col-span-2">
                        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
                          <CalendarClock size={15} className="text-blue-500" />
                          近 7 天趋势
                        </h3>
                        <ReactECharts option={trendOption} style={{ height: 220, width: '100%' }} notMerge />
                      </div>

                      {/* 模型分布 */}
                      <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03]">
                        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
                          <Cpu size={15} className="text-violet-500" />
                          模型分布
                        </h3>
                        {byModel.length === 0 ? (
                          <p className="flex h-[220px] items-center justify-center text-xs text-gray-400">暂无数据</p>
                        ) : (
                          <ReactECharts option={pieOption} style={{ height: 220, width: '100%' }} notMerge />
                        )}
                      </div>
                    </div>

                    {/* 热力图 */}
                    <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03]">
                      <div className="mb-4 flex items-center justify-between">
                        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
                          <Calendar size={15} className="text-emerald-500" />
                          活跃热力
                        </h3>
                        <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-white/[0.06]">
                          <button
                            onClick={() => setHeatTab('week')}
                            className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                              heatTab === 'week'
                                ? 'bg-white text-blue-600 shadow-sm dark:bg-white/10 dark:text-blue-300'
                                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                            }`}
                          >
                            周 × 时
                          </button>
                          <button
                            onClick={() => setHeatTab('year')}
                            className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                              heatTab === 'year'
                                ? 'bg-white text-blue-600 shadow-sm dark:bg-white/10 dark:text-blue-300'
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
  const filtered = logs.filter(l => {
    if (modelFilter && l.modelName !== modelFilter) return false
    if (sourceFilter === 'chat' && l.source !== 'chat') return false
    if (sourceFilter === 'proxy' && l.source !== 'proxy') return false
    return true
  })

  const fmtTime = (s: string) => {
    const d = new Date(s)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03]">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
        <CalendarClock size={15} className="text-blue-500" />
        请求日志
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={sourceFilter}
            onChange={setSourceFilter}
            options={[{ value: '', label: '全部来源' }, { value: 'chat', label: '对话' }, { value: 'proxy', label: '代理' }]}
          />
          <Select
            value={modelFilter}
            onChange={setModelFilter}
            options={[{ value: '', label: '全部模型' }, ...models.map(m => ({ value: m, label: m }))]}
          />
        </div>
      </h3>
      {isLoading ? (
        <div className="flex h-32 items-center justify-center text-sm text-gray-400">加载中...</div>
      ) : filtered.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-gray-400">暂无日志</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-400 dark:border-gray-700">
                <th className="whitespace-nowrap pb-2 pr-3 font-medium">时间</th>
                <th className="whitespace-nowrap pb-2 pr-3 font-medium">来源</th>
                <th className="whitespace-nowrap pb-2 pr-3 font-medium">模型</th>
                <th className="whitespace-nowrap pb-2 pr-3 font-medium text-right">输入</th>
                <th className="whitespace-nowrap pb-2 pr-3 font-medium text-right">压缩后</th>
                <th className="whitespace-nowrap pb-2 pr-3 font-medium text-right">输出</th>
                <th className="whitespace-nowrap pb-2 pr-3 font-medium text-right">总计</th>
                <th className="whitespace-nowrap pb-2 pr-3 font-medium text-right">延迟</th>
                <th className="whitespace-nowrap pb-2 font-medium">内容</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((log) => (
                <tr key={log.messageId} className="border-b border-gray-100 hover:bg-gray-50 dark:border-gray-700/50 dark:hover:bg-white/[0.02]">
                  <td className="whitespace-nowrap py-2 pr-3 text-gray-500">{fmtTime(log.createdAt)}</td>
                  <td className="whitespace-nowrap py-2 pr-3">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      log.source === 'proxy'
                        ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400'
                        : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                    }`}>
                      {log.source === 'proxy' ? '代理' : '对话'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-gray-600 dark:text-gray-300">{log.modelName}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right text-blue-600 dark:text-blue-400">{log.inputTokens ?? '—'}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right text-violet-600 dark:text-violet-400">{log.compressedTokens ?? '—'}</td>
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
