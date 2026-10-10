import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactEChartsCore from 'echarts-for-react/esm/core'
import echarts from '../utils/echarts'
import { useIsDark } from '../hooks/useIsDark'
import type { IUsageDayStat, IUsageHourStat } from '../services/usageService'

type Metric = 'messages' | 'tokens'

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

const HOURS = Array.from({ length: 24 }, (_, h) => `${h}`)

function heatColors(isDark: boolean): string[] {
  return isDark
    ? ['#1e293b', '#1e3a5f', '#1d4ed8', '#3b82f6', '#60a5fa']
    : ['#f1f5f9', '#bfdbfe', '#60a5fa', '#3b82f6', '#1d4ed8']
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** 实测容器宽度，用于把热力图格子算成正方形 */
function useContainerWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

/** 近 7 天 × 24 小时 热力图（方格保持正方形） */
export function WeekHourHeatmap({ data, metric }: { data: IUsageHourStat[]; metric: Metric }) {
  const { t } = useTranslation('settings')
  const isDark = useIsDark()
  const [wrapRef, width] = useContainerWidth()
  const days = last7Days()
  const weekdays = t('heatmap.weekdays', { returnObjects: true }) as unknown as string[]
  const metricLabel = metric === 'messages' ? t('metrics.messages') : t('metrics.tokens')
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

  // 可用宽度减去坐标轴占位后均分 24 列，行高取同值得到正方形格子
  const cell = width > 0 ? clamp((width - 92) / 24, 8, 44) : 14
  const chartWidth = width > 0 ? Math.min(width, Math.round(cell * 24 + 92)) : '100%'
  const chartHeight = Math.round(cell * 7 + 38)

  const textColor = isDark ? '#9ca3af' : '#6b7280'
  const option = {
    grid: { left: 76, right: 16, top: 10, bottom: 28 },
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
        return `${days[di]} ${h}:00<br/><b>${metricLabel}: ${fmt(v)}</b>`
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
      data: days.map((d, i) => i === days.length - 1
        ? t('heatmap.today')
        : t('heatmap.dayLabel', { date: d.slice(5), weekday: weekdays[new Date(d).getDay()] })),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: textColor, fontSize: 10 },
    },
    visualMap: {
      show: false,
      min: 0,
      max,
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

  return (
    <div ref={wrapRef}>
      <ReactEChartsCore echarts={echarts} option={option} style={{ height: chartHeight, width: chartWidth }} notMerge />
    </div>
  )
}

/** 近一年 GitHub 风格日历热力图（方格保持正方形） */
export function YearHeatmap({ data, metric }: { data: IUsageDayStat[]; metric: Metric }) {
  const { t } = useTranslation('settings')
  const isDark = useIsDark()
  const [wrapRef, width] = useContainerWidth()
  const months = t('heatmap.months', { returnObjects: true }) as unknown as string[]
  const weekdays = t('heatmap.weekdays', { returnObjects: true }) as unknown as string[]
  const metricLabel = metric === 'messages' ? t('metrics.messages') : t('metrics.tokens')
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

  // 可用宽度减去日历边距后均分约 53 周，得到正方形格子
  const cell = width > 0 ? clamp((width - 66) / 53, 6, 18) : 12
  const chartWidth = width > 0 ? Math.min(width, Math.round(cell * 53 + 66)) : '100%'
  const chartHeight = Math.round(cell * 7 + 54)

  const textColor = isDark ? '#9ca3af' : '#6b7280'
  const option = {
    tooltip: {
      backgroundColor: isDark ? '#1f2937' : '#fff',
      borderColor: isDark ? '#374151' : '#e5e7eb',
      textStyle: { color: isDark ? '#e5e7eb' : '#111827', fontSize: 12 },
      formatter: (p: { value: [string, number] }) =>
        `${p.value[0]}<br/><b>${metricLabel}: ${fmt(p.value[1])}</b>`,
    },
    visualMap: {
      show: false,
      min: 0,
      max,
      inRange: { color: heatColors(isDark) },
    },
    calendar: {
      top: 30,
      left: 50,
      right: 16,
      bottom: 24,
      range: [toIso(start), toIso(today)],
      cellSize: cell,
      splitLine: { show: false },
      itemStyle: { color: 'transparent', borderWidth: 2, borderColor: isDark ? '#0c0f1a' : '#fff' },
      dayLabel: { color: textColor, fontSize: 10, nameMap: weekdays },
      monthLabel: { color: textColor, fontSize: 10, nameMap: months },
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

  return (
    <div ref={wrapRef}>
      <ReactEChartsCore echarts={echarts} option={option} style={{ height: chartHeight, width: chartWidth }} notMerge />
    </div>
  )
}
