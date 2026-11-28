import type { ComponentProps } from 'react'
import ReactEChartsCore from 'echarts-for-react/esm/core'
import echarts from '../../utils/echarts'

type ChartOption = ComponentProps<typeof ReactEChartsCore>['option']

/**
 * ECharts 统一包装：页面只传 option 与高度，echarts 实例、按需注册与样式由这里收口，
 * 第三方图表库不再出现在页面层。
 */
export default function UsageChart({ option, height }: { option: ChartOption; height: number }) {
  return <ReactEChartsCore echarts={echarts} option={option} style={{ height, width: '100%' }} notMerge />
}