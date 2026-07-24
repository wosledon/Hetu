import ReactECharts from 'echarts-for-react'
import { useUIStore } from '../stores/uiStore'
import type { IUsageDayStat, IUsageHourStat } from '../services/usageService'

type Metric = 'messages' | 'tokens'

const METRIC_LABEL: Record<Metric, string> = { messages: '消息数', tokens: 'Tokens' }

export function useIsDark(): boolean {
  const theme = useUIStore((s) => s.theme)
  return theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
}

function fmt(n: number): string {
  if (n >= 10000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

function last7Days(): string[] {
  const out: string[] = []
  const today = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return out
}

function dayLabel(iso: string, isToday: boolean): string {
  if (isToday) return '今天'
  const week = ['日', '一', '二', '三', '四', '五', '六'][new Date(iso).getDay()]
  return `${iso.slice(5)} 周${week}`
}

const HOURS = Array.from({ length: 24 }, (_, h) => `${h}`)

function heatColors(isDark: boolean): string[] {
  return isDark
    ? ['#1e293b', '#1e3a5f', '#1d4ed8', '#3b82f6', '#60a5fa']
    : ['#f1f5f9', '#bfdbfe', '#60a5fa', '#3b82f6', '#1d4ed8']
}

/** 近 7 天 × 24 小时 热力图 */
export function WeekHourHeatmap({ data, metric }: { data: IUsageHourStat[]; metric: Metric }) {
  const isDark = useIsDark()
  const days = last7Days()
  const map = new Map<string, number>()
  let max = 1
  for (const d of data) {
    const v = metric === 'messages' ? d.messages : d.tokens
    map.set(`${d.date}_${d.hour}`, v)
    if (v > max) max = v
  }

  const seriesData: [number, number, number][] = []
  days.forEach((day, di) => {
    for (let h = 0; h < 24; h++) {
      seriesData.push([h, di, map.get(`${day}_${h}`) ?? 0])
    }
  })

  const textColor = isDark ? '#9ca3af' : '#6b7280'
  const option = {
    grid: { left: 76, right: 16, top: 10, bottom: 56 },
    tooltip: {
      confine: true,
      appendToBody: true,
      backgroundColor: isDark ? '#1f2937' : '#fff',
      borderColor: isDark ? '#374151' : '#e5e7eb',
      borderWidth: 1,
      padding: [6, 10],
      extraCssText: 'box-shadow: 0 4px 12px rgba(0,0,0,0.12); border-radius: 8px;',
      textStyle: { color: isDark ? '#e5e7eb' : '#111827', fontSize: 12 },
      formatter: (p: { value: [number, number, number] }) => {
        const [h, di, v] = p.value
        return `${days[di]} ${h}:00<br/><b>${METRIC_LABEL[metric]}: ${fmt(v)}</b>`
      },
    },
    xAxis: {
      type: 'category',
      data: HOURS,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: textColor, fontSize: 10, interval: 5 },
    },
    yAxis: {
      type: 'category',
      data: days.map((d, i) => dayLabel(d, i === days.length - 1)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: textColor, fontSize: 10 },
    },
    visualMap: {
      min: 0,
      max,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 12,
      itemHeight: 80,
      textStyle: { color: textColor, fontSize: 10 },
      inRange: { color: heatColors(isDark) },
    },
    series: [
      {
        type: 'heatmap',
        data: seriesData,
        label: { show: false },
        itemStyle: { borderColor: isDark ? '#0c0f1a' : '#fff', borderWidth: 2, borderRadius: 3 },
      },
    ],
  }

  return <ReactECharts option={option} style={{ height: 260, width: '100%' }} notMerge />
}

/** 近一年 GitHub 风格日历热力图 */
export function YearHeatmap({ data, metric }: { data: IUsageDayStat[]; metric: Metric }) {
  const isDark = useIsDark()
  const map = new Map<string, number>()
  let max = 1
  for (const d of data) {
    const v = metric === 'messages' ? d.messages : d.tokens
    map.set(d.date, v)
    if (v > max) max = v
  }

  const today = new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - 364)
  const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const seriesData: [string, number][] = []
  const cursor = new Date(start)
  while (cursor <= today) {
    const iso = toIso(cursor)
    seriesData.push([iso, map.get(iso) ?? 0])
    cursor.setDate(cursor.getDate() + 1)
  }

  const textColor = isDark ? '#9ca3af' : '#6b7280'
  const option = {
    tooltip: {
      backgroundColor: isDark ? '#1f2937' : '#fff',
      borderColor: isDark ? '#374151' : '#e5e7eb',
      textStyle: { color: isDark ? '#e5e7eb' : '#111827', fontSize: 12 },
      formatter: (p: { value: [string, number] }) =>
        `${p.value[0]}<br/><b>${METRIC_LABEL[metric]}: ${fmt(p.value[1])}</b>`,
    },
    visualMap: {
      min: 0,
      max,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 12,
      itemHeight: 80,
      textStyle: { color: textColor, fontSize: 10 },
      inRange: { color: heatColors(isDark) },
    },
    calendar: {
      top: 30,
      left: 50,
      right: 16,
      bottom: 56,
      range: [toIso(start), toIso(today)],
      cellSize: ['auto', 14],
      splitLine: { show: false },
      itemStyle: { color: 'transparent', borderWidth: 2, borderColor: isDark ? '#0c0f1a' : '#fff' },
      dayLabel: { color: textColor, fontSize: 10, nameMap: ['日', '一', '二', '三', '四', '五', '六'] },
      monthLabel: { color: textColor, fontSize: 10, nameMap: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'] },
      yearLabel: { show: false },
    },
    series: [
      {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: seriesData,
      },
    ],
  }

  return <ReactECharts option={option} style={{ height: 220, width: '100%' }} notMerge />
}
