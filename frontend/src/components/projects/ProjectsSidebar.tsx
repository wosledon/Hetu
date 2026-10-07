import { Folder, FolderOpen, Inbox, LayoutGrid, Pin, Settings2, Tag, X } from 'lucide-react'
import type { IProjectGroup, IManagedProject, IProjectFilter } from '../../types/project'

interface ProjectsSidebarProps {
  groups: IProjectGroup[]
  projects: IManagedProject[]
  filter: IProjectFilter
  onFilterChange: (filter: IProjectFilter) => void
  onManageGroups: () => void
  /** 拖拽项目到分组上：移动项目归属 */
  onMoveToGroup: (projectId: string, groupId: string | null) => void
}

function isSameFilter(a: IProjectFilter, b: IProjectFilter): boolean {
  return a.type === b.type && (a.id ?? '') === (b.id ?? '')
}

const ALL_FILTER: IProjectFilter = { type: 'all' }

export default function ProjectsSidebar({
  groups, projects, filter, onFilterChange, onManageGroups, onMoveToGroup,
}: ProjectsSidebarProps) {
  const ungroupedCount = projects.filter((p) => !p.groupId).length

  // 分类与标签计数由当前项目列表实时汇总
  const categories = Array.from(
    projects.reduce((map, p) => {
      if (p.category) map.set(p.category, (map.get(p.category) ?? 0) + 1)
      return map
    }, new Map<string, number>()),
  ).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

  const tags = Array.from(
    projects.reduce((map, p) => {
      for (const t of p.tags) map.set(t, (map.get(t) ?? 0) + 1)
      return map
    }, new Map<string, number>()),
  ).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

  const navItemClass = (active: boolean) =>
    `flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
      active
        ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300'
        : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]'
    }`

  return (
    <aside className="flex h-full w-52 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <button
          onClick={() => onFilterChange(ALL_FILTER)}
          className={navItemClass(isSameFilter(filter, ALL_FILTER))}
        >
          <LayoutGrid size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">全部项目</span>
          <span className="shrink-0 text-[11px] text-gray-400">{projects.length}</span>
        </button>

        {/* 分组 */}
        <div className="mt-5 flex items-center justify-between px-2.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">分组</span>
          <button
            onClick={onManageGroups}
            title="管理分组"
            aria-label="管理分组"
            className="rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            <Settings2 size={12} />
          </button>
        </div>
        <div className="mt-1 space-y-0.5">
          <button
            onClick={() => onFilterChange({ type: 'ungrouped' })}
            className={navItemClass(filter.type === 'ungrouped')}
          >
            <Inbox size={14} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">未分组</span>
            <span className="shrink-0 text-[11px] text-gray-400">{ungroupedCount}</span>
          </button>
          {groups.map((group) => (
            <button
              key={group.id}
              onClick={() => onFilterChange({ type: 'group', id: group.id })}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('bg-blue-50', 'dark:bg-blue-950/40') }}
              onDragLeave={(e) => e.currentTarget.classList.remove('bg-blue-50', 'dark:bg-blue-950/40')}
              onDrop={(e) => {
                e.preventDefault()
                e.currentTarget.classList.remove('bg-blue-50', 'dark:bg-blue-950/40')
                const projectId = e.dataTransfer.getData('application/x-project-id')
                if (projectId) onMoveToGroup(projectId, group.id)
              }}
              className={navItemClass(filter.type === 'group' && filter.id === group.id)}
            >
              <Folder size={14} className="shrink-0 text-amber-400" />
              <span className="min-w-0 flex-1 truncate" title={group.name}>{group.name}</span>
              <span className="shrink-0 text-[11px] text-gray-400">{group.projectCount}</span>
            </button>
          ))}
          {groups.length === 0 && (
            <p className="px-2.5 py-1 text-[11px] leading-relaxed text-gray-400">还没有分组，点击右上角图标创建</p>
          )}
        </div>

        {/* 分类 */}
        {categories.length > 0 && (
          <>
            <div className="mt-5 px-2.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">分类</span>
            </div>
            <div className="mt-1 space-y-0.5">
              {categories.map(([name, count]) => (
                <button
                  key={name}
                  onClick={() => onFilterChange({ type: 'category', id: name })}
                  className={navItemClass(filter.type === 'category' && filter.id === name)}
                >
                  <FolderOpen size={14} className="shrink-0 text-emerald-400" />
                  <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
                  <span className="shrink-0 text-[11px] text-gray-400">{count}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* 标签 */}
        {tags.length > 0 && (
          <>
            <div className="mt-5 px-2.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">标签</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1 px-1.5">
              {tags.map(([name, count]) => {
                const active = filter.type === 'tag' && filter.id === name
                return (
                  <button
                    key={name}
                    onClick={() => onFilterChange({ type: 'tag', id: name })}
                    className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                      active
                        ? 'border-blue-300 bg-blue-50 text-blue-600 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400'
                    }`}
                  >
                    <Tag size={9} />
                    {name}
                    <span className="text-gray-400">{count}</span>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* 当前筛选提示 */}
      {filter.type !== 'all' && (
        <div className="shrink-0 border-t border-gray-100 px-3 py-2 dark:border-gray-800">
          <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
            <Pin size={10} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {filter.type === 'group' && `分组：${groups.find((g) => g.id === filter.id)?.name ?? ''}`}
              {filter.type === 'ungrouped' && '仅看未分组'}
              {filter.type === 'category' && `分类：${filter.id}`}
              {filter.type === 'tag' && `标签：${filter.id}`}
            </span>
            <button
              onClick={() => onFilterChange(ALL_FILTER)}
              title="清除筛选"
              aria-label="清除筛选"
              className="shrink-0 rounded p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <X size={11} />
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
