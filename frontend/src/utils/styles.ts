/// 分段控件（顶部导航 pill、页内 Tab、指标切换）中按钮的选中/未选中样式。
const SEGMENT_ACTIVE = 'bg-white text-blue-600 shadow-sm dark:bg-white/10 dark:text-blue-300'
const SEGMENT_INACTIVE =
  'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'

export function segmentButtonClass(active: boolean): string {
  return active ? SEGMENT_ACTIVE : SEGMENT_INACTIVE
}
