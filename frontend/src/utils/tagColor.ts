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
