const TAG_COLOR_OPTIONS = [
  'blue',
  'green',
  'purple',
  'yellow',
  'red',
  'indigo',
  'pink',
  'orange',
  'teal',
  'cyan',
] as const

type TagColor = (typeof TAG_COLOR_OPTIONS)[number]

// 颜色名 → 用于内联样式的色值，避免依赖 Tailwind 动态类生成
export const TAG_COLOR_HEX: Record<string, { dot: string; soft: string; text: string }> = {
  blue:    { dot: '#3b82f6', soft: 'rgba(59,130,246,0.12)',  text: '#2563eb' },
  green:   { dot: '#22c55e', soft: 'rgba(34,197,94,0.12)',   text: '#16a34a' },
  purple:  { dot: '#a855f7', soft: 'rgba(168,85,247,0.12)',  text: '#9333ea' },
  yellow:  { dot: '#eab308', soft: 'rgba(234,179,8,0.14)',   text: '#a16207' },
  red:     { dot: '#ef4444', soft: 'rgba(239,68,68,0.12)',   text: '#dc2626' },
  indigo:  { dot: '#6366f1', soft: 'rgba(99,102,241,0.12)',  text: '#4f46e5' },
  pink:    { dot: '#ec4899', soft: 'rgba(236,72,153,0.12)',  text: '#db2777' },
  orange:  { dot: '#f97316', soft: 'rgba(249,115,22,0.12)',  text: '#ea580c' },
  teal:    { dot: '#14b8a6', soft: 'rgba(20,184,166,0.12)',  text: '#0d9488' },
  cyan:    { dot: '#06b6d4', soft: 'rgba(6,182,212,0.12)',   text: '#0891b2' },
}

// 未设置颜色时的中性灰
export const TAG_NEUTRAL_HEX = { dot: '#9ca3af', soft: 'rgba(156,163,175,0.15)', text: '#6b7280' }

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

export function resolveTagColor(name: string, color?: string): TagColor {
  if (color) {
    const normalized = color.toLowerCase()
    if (TAG_COLOR_OPTIONS.includes(normalized as TagColor)) {
      return normalized as TagColor
    }
  }
  return TAG_COLOR_OPTIONS[hashString(name) % TAG_COLOR_OPTIONS.length]
}

export function getTagColorClasses(name: string, color?: string): string {
  const c = resolveTagColor(name, color)
  return `bg-${c}-100 text-${c}-700 hover:bg-${c}-200 dark:bg-${c}-950/40 dark:text-${c}-200 dark:hover:bg-${c}-900/60`
}

/**
 * 返回标签的内联色值。未设置 color 时返回中性灰，
 * 而非随机色——让用户显式设置颜色后才显示彩色。
 */
export function tagPalette(tag: { name: string; color?: string }) {
  if (!tag.color) return TAG_NEUTRAL_HEX
  return TAG_COLOR_HEX[tag.color.toLowerCase()] ?? TAG_NEUTRAL_HEX
}
