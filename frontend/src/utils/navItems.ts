import {
  Atom, BookOpen, BookText, Bot, Boxes, CalendarClock, Code, Cpu, Database, FolderInput,
  GitBranch, ListTodo, MessageSquare, Network, PenTool, SquareKanban, Tag, Wrench, Zap,
} from 'lucide-react'

export interface NavItem {
  path: string
  /** 文案 key（nav 命名空间，如 'nav:notes'） */
  labelKey: string
  icon: typeof BookOpen
  /** 可选的角标文案 key（如 'nav:beta'），用于标记实验性入口 */
  badgeKey?: string
}

/**
 * 主导航全部入口：固定区与动态区都从这里取，数组顺序即默认顺序。
 * 固定区/动态区的具体成员由用户在「设置 - 导航菜单」里拖动决定，
 * 这里只保留「有哪些入口、长什么样」这一份事实来源。
 */
export const NAV_ITEMS: NavItem[] = [
  { path: '/', labelKey: 'nav:mainChat', icon: MessageSquare },
  { path: '/notes', labelKey: 'nav:notes', icon: BookOpen },
  { path: '/code', labelKey: 'nav:code', icon: Code },
  { path: '/projects', labelKey: 'nav:projects', icon: FolderInput },
  { path: '/kanban', labelKey: 'nav:kanban', icon: SquareKanban },
  { path: '/wiki', labelKey: 'nav:wiki', icon: BookText },
  { path: '/tags', labelKey: 'nav:tags', icon: Tag },
  { path: '/agents', labelKey: 'nav:agents', icon: Bot },
  { path: '/skills', labelKey: 'nav:skills', icon: Zap },
  { path: '/tools', labelKey: 'nav:tools', icon: Wrench },
  { path: '/knowledge-base', labelKey: 'nav:knowledgeBase', icon: Database },
  { path: '/graph', labelKey: 'nav:graph', icon: Network },
  { path: '/whiteboard', labelKey: 'nav:whiteboard', icon: PenTool, badgeKey: 'nav:new' },
  { path: '/tasks/background', labelKey: 'nav:tasksBackground', icon: ListTodo },
  { path: '/tasks/scheduled', labelKey: 'nav:tasksScheduled', icon: CalendarClock },
  { path: '/memories', labelKey: 'nav:memories', icon: Atom },
  { path: '/models', labelKey: 'nav:models', icon: Cpu },
  { path: '/foundry-local', labelKey: 'nav:foundryLocal', icon: Boxes, badgeKey: 'nav:beta' },
  { path: '/workflows', labelKey: 'nav:workflows', icon: GitBranch },
]

/** 固定区默认成员（改版前的硬编码集合） */
export const DEFAULT_FIXED_NAV_ITEMS = ['/', '/notes', '/code', '/projects', '/kanban', '/wiki']

/** 动态区默认成员：除固定区外的全部入口，顺序同 NAV_ITEMS */
export const DEFAULT_DYNAMIC_NAV_ITEMS = NAV_ITEMS
  .map((item) => item.path)
  .filter((path) => !DEFAULT_FIXED_NAV_ITEMS.includes(path))

const NAV_PATHS = new Set(NAV_ITEMS.map((item) => item.path))

export function getNavItem(path: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.path === path)
}

/** 过滤掉已不存在的路由（历史设置里可能留下陈旧路径）并去重，保持传入顺序 */
export function sanitizeNavPaths(paths: unknown): string[] {
  if (!Array.isArray(paths)) return []
  const result: string[] = []
  for (const path of paths) {
    if (typeof path === 'string' && NAV_PATHS.has(path) && !result.includes(path)) result.push(path)
  }
  return result
}

/** 把 path 列表解析成导航项列表（跳过未知路径，保持顺序） */
export function resolveNavItems(paths: string[]): NavItem[] {
  return paths.map(getNavItem).filter((item): item is NavItem => item !== undefined)
}

/** 同列表内移动：把 path 移到 index 处（插入到该位置原元素之前） */
export function reorderNavPaths(paths: string[], path: string, index: number): string[] {
  const without = paths.filter((p) => p !== path)
  const at = Math.max(0, Math.min(index, without.length))
  return [...without.slice(0, at), path, ...without.slice(at)]
}
