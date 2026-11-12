/// 分段控件（顶部导航 pill、页内 Tab、指标切换）中按钮的选中/未选中样式。
const SEGMENT_ACTIVE = 'bg-white text-blue-600 shadow-sm dark:bg-white/10 dark:text-blue-300'
const SEGMENT_INACTIVE =
  'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'

export function segmentButtonClass(active: boolean): string {
  return active ? SEGMENT_ACTIVE : SEGMENT_INACTIVE
}

/** 仅文字态：与 SlidingPill 滑块搭配（背景由滑块提供，按钮不再自带 bg） */
export function segmentTextClass(active: boolean): string {
  return active ? 'text-blue-600 dark:text-blue-300' : SEGMENT_INACTIVE
}

export const POPOVER_PANEL_CLASS =
  'rounded-2xl border border-gray-200/90 bg-white/95 shadow-[0_20px_50px_-20px_rgba(15,23,42,0.42)] dark:border-white/10 dark:bg-gray-900/95'

export const POPOVER_SECTION_TITLE_CLASS =
  'px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500'

export const POPOVER_EMPTY_CLASS =
  'px-4 py-6 text-center text-[11px] leading-5 text-gray-400 dark:text-gray-500'

export function popoverItemClass(active: boolean): string {
  return `group flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
    active
      ? 'bg-blue-50/90 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200'
      : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.045]'
  }`
}
