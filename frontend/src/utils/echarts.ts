import * as echarts from 'echarts/core'
import { BarChart, HeatmapChart, LineChart, PieChart } from 'echarts/charts'
import {
  AxisPointerComponent,
  CalendarComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

// 按需引入 echarts：仅注册实际用到的图表与组件，避免把整个 echarts（约 1MB）打进产物
echarts.use([
  CalendarComponent,
  BarChart,
  HeatmapChart,
  LineChart,
  PieChart,
  AxisPointerComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
])

export default echarts
