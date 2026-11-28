import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Brain, Check, ChevronDown, FolderGit2, GitBranch, Search } from 'lucide-react'
import { POPOVER_EMPTY_CLASS, POPOVER_PANEL_CLASS } from '../../utils/styles'
import { SearchInput, SurfaceButton } from '../ui'

export interface AgentPickerItem {
  id: string
  name: string
  description?: string
  /** bot 通用智能体 / brain 专业智能体 / git 工作流 */
  icon?: 'bot' | 'brain' | 'git'
  /** 名称右侧徽标（专业 / 本地 / .github） */
  badge?: string
}

interface AgentPickerProps {
  items: AgentPickerItem[]
  value?: string
  onSelect: (item: AgentPickerItem) => void
  /** 项目分组：项目 .github 目录下的自定义智能体 */
  projectItems?: AgentPickerItem[]
  projectValue?: string
  onSelectProject?: (item: AgentPickerItem) => void
  /** 工作流分组（仅对话侧可运行） */
  workflows?: AgentPickerItem[]
  workflowValue?: string
  onSelectWorkflow?: (item: AgentPickerItem) => void
  title?: string
  placeholder?: string
  groupLabel?: string
  /** 项目分组标题（默认「项目」） */
  projectGroupLabel?: string
  emptyHint?: string
  projectEmptyHint?: string
}

type PickerCategory = 'all' | 'project' | 'agents' | 'workflows'

const ICONS = { bot: Bot, brain: Brain, git: GitBranch } as const

const BADGE_CLASSES: Record<string, string> = {
  专业: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  本地: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  '.github': 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400',
}

/** 三类候选的图标与配色：bot=通用智能体，brain=专业智能体，git=工作流 */
const TYPE_STYLES = {
  bot: {
    iconBox: 'bg-indigo-50 text-indigo-600 ring-indigo-500/15 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-400/20',
    activeRow: 'bg-indigo-50/70 ring-1 ring-inset ring-indigo-500/15 dark:bg-indigo-500/[0.08] dark:ring-indigo-400/20',
    check: 'text-indigo-500 dark:text-indigo-300',
  },
  brain: {
    iconBox: 'bg-violet-50 text-violet-600 ring-violet-500/15 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/20',
    activeRow: 'bg-violet-50/70 ring-1 ring-inset ring-violet-500/15 dark:bg-violet-500/[0.08] dark:ring-violet-400/20',
    check: 'text-violet-500 dark:text-violet-300',
  },
  git: {
    iconBox: 'bg-sky-50 text-sky-600 ring-sky-500/15 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20',
    activeRow: 'bg-sky-50/70 ring-1 ring-inset ring-sky-500/15 dark:bg-sky-500/[0.08] dark:ring-sky-400/20',
    check: 'text-sky-500 dark:text-sky-300',
  },
} as const

/** 智能体 / 项目 / 工作流选择器：对话与 Code 会话共用同一套浮层，候选项按模式注入 */
export default function AgentPicker({
  items,
  value,
  onSelect,
  projectItems = [],
  projectValue,
  onSelectProject,
  workflows = [],
  workflowValue,
  onSelectWorkflow,
  title,
  placeholder,
  groupLabel,
  projectGroupLabel,
  emptyHint,
  projectEmptyHint,
}: AgentPickerProps) {
  const { t } = useTranslation('agent')
  const triggerTitle = title ?? t('picker.title')
  const triggerLabel = placeholder ?? t('picker.agent')
  const agentsGroupLabel = groupLabel ?? t('picker.agentGroup')
  const projectLabel = projectGroupLabel ?? t('picker.projectGroup')
  const agentsEmptyHint = emptyHint ?? t('picker.emptyAgents')
  const projectEmpty = projectEmptyHint ?? t('picker.emptyProjectAgents')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<PickerCategory>('all')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const normalizedQuery = query.trim().toLowerCase()
  const filterItems = (list: AgentPickerItem[]) => !normalizedQuery
    ? list
    : list.filter((item) => item.name.toLowerCase().includes(normalizedQuery) || item.description?.toLowerCase().includes(normalizedQuery))
  const visibleItems = filterItems(items)
  const visibleProjectItems = filterItems(projectItems)
  const visibleWorkflows = filterItems(workflows)
  const totalCount = items.length + projectItems.length + workflows.length
  const searchable = totalCount > 5
  const hasAny = totalCount > 0

  const categories: { key: PickerCategory; label: string; count: number }[] = [
    { key: 'all', label: t('picker.tabAll'), count: totalCount },
    ...(onSelectProject
      ? [{ key: 'project' as const, label: projectLabel, count: projectItems.length }]
      : []),
    { key: 'agents', label: agentsGroupLabel, count: items.length },
    ...(onSelectWorkflow
      ? [{ key: 'workflows' as const, label: t('picker.workflowGroup'), count: workflows.length }]
      : []),
  ]
  const showTabs = categories.length > 2
  const activeCategory = categories.some((c) => c.key === category) ? category : 'all'

  const visibleForCategory = activeCategory === 'project'
    ? visibleProjectItems.length
    : activeCategory === 'agents'
      ? visibleItems.length
      : activeCategory === 'workflows'
        ? visibleWorkflows.length
        : visibleItems.length + visibleProjectItems.length + visibleWorkflows.length
  const noMatches = normalizedQuery.length > 0 && visibleForCategory === 0

  const selected = items.find((i) => i.id === value)
  const selectedProject = projectItems.find((p) => p.id === projectValue)
  const selectedWorkflow = workflows.find((w) => w.id === workflowValue)
  const active = !!selected || !!selectedProject || !!selectedWorkflow
  const current = selectedWorkflow ?? selectedProject ?? selected

  const CurrentIcon = ICONS[current?.icon ?? 'bot']

  const sectionTitle = (Icon: typeof Bot, label: string, count: number) => (
    <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-2.5">
      <Icon size={11} className="shrink-0 text-gray-400 dark:text-gray-500" />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</span>
      <span className="ml-auto rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
        {count}
      </span>
    </div>
  )

  const renderItem = (item: AgentPickerItem, isActive: boolean, onClick: () => void) => {
    const type = item.icon ?? 'bot'
    const Icon = ICONS[type]
    const style = TYPE_STYLES[type]
    return (
      <SurfaceButton
        key={item.id}
        type="button"
        role="menuitemradio"
        aria-checked={isActive}
        onClick={onClick}
        title={item.description}
        className={`group flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
          isActive ? style.activeRow : 'hover:bg-gray-50 dark:hover:bg-white/[0.045]'
        }`}
      >
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${style.iconBox}`}>
          <Icon size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium text-gray-800 dark:text-gray-100">{item.name}</span>
            {item.badge && (
              <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-medium ${BADGE_CLASSES[item.badge] ?? 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'}`}>
                {item.badge}
              </span>
            )}
          </span>
          {item.description && (
            <span className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-gray-400 dark:text-gray-500">{item.description}</span>
          )}
        </span>
        <span className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center ${isActive ? style.check : ''}`}>
          {isActive
            ? <Check size={13} strokeWidth={2.5} />
            : <span className="h-1.5 w-1.5 rounded-full bg-gray-200 dark:bg-gray-700" />}
        </span>
      </SurfaceButton>
    )
  }

  const renderProjectGroup = activeCategory === 'all' && (normalizedQuery ? visibleProjectItems.length > 0 : projectItems.length > 0)
  const renderAgentsGroup = activeCategory === 'all' && (normalizedQuery ? visibleItems.length > 0 : items.length > 0)
  const renderWorkflowGroup = activeCategory === 'all' && (normalizedQuery ? visibleWorkflows.length > 0 : workflows.length > 0)

  return (
    <div className="relative" ref={containerRef}>
      <SurfaceButton
        onClick={() => {
          if (!open) {
            setQuery('')
            setCategory('all')
          }
          setOpen((v) => !v)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip-owner={open ? '' : undefined}
        className={`flex h-[26px] max-w-[180px] items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-colors ${
          active
            ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700/50 dark:hover:text-gray-200'
        }`}
        title={open ? undefined : triggerTitle}
      >
        <CurrentIcon size={13} className="shrink-0" />
        <span className="truncate">{selectedWorkflow?.name ?? selectedProject?.name ?? selected?.name ?? triggerLabel}</span>
        <ChevronDown size={10} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </SurfaceButton>

      {open && (
        <div
          className={`absolute bottom-full left-0 z-50 mb-2 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden ${POPOVER_PANEL_CLASS}`}
        >
          <div className="border-b border-gray-100 px-3.5 pb-2.5 pt-3 dark:border-white/[0.06]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-100">{triggerTitle}</span>
              <span className="max-w-[160px] truncate rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                {current?.name ?? t('picker.noneSelected')}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-gray-400 dark:text-gray-500">{t('picker.subtitle')}</p>
          </div>

          {showTabs && (
            <div className="flex gap-1 overflow-x-auto border-b border-gray-100 px-2.5 py-2 dark:border-white/[0.06]">
              {categories.map((cat) => {
                const isActive = activeCategory === cat.key
                return (
                  <SurfaceButton
                    key={cat.key}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setCategory(cat.key)}
                    className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      isActive
                        ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                        : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.05]'
                    }`}
                  >
                    {cat.label}
                    <span className={`rounded-full px-1.5 text-[9px] tabular-nums ${
                      isActive
                        ? 'bg-indigo-200/70 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200'
                        : 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'
                    }`}>
                      {cat.count}
                    </span>
                  </SurfaceButton>
                )
              })}
            </div>
          )}

          {searchable && (
            <div className="border-b border-gray-100 p-2 dark:border-white/[0.06]">
              <SearchInput
                tone="indigo"
                size="sm"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('picker.search')}
                className="w-full"
              />
            </div>
          )}

          <div role="menu" aria-label={triggerTitle} className="max-h-[min(56vh,380px)] overflow-y-auto p-1.5">
            {noMatches ? (
              <div className="flex flex-col items-center gap-1.5 px-4 py-7 text-center text-[11px] text-gray-400 dark:text-gray-500">
                <Search size={16} className="text-gray-300 dark:text-gray-600" />
                <span>{t('picker.noMatches')}</span>
              </div>
            ) : activeCategory === 'all' ? (
              <>
                {renderProjectGroup && (
                  <>
                    {sectionTitle(FolderGit2, projectLabel, normalizedQuery ? visibleProjectItems.length : projectItems.length)}
                    {visibleProjectItems.map((p) => renderItem(p, p.id === projectValue, () => {
                      onSelectProject?.(p)
                      setOpen(false)
                    }))}
                  </>
                )}

                {renderAgentsGroup && (
                  <>
                    {renderProjectGroup && <div className="my-1 border-t border-gray-100 dark:border-white/[0.06]" />}
                    {sectionTitle(Bot, agentsGroupLabel, normalizedQuery ? visibleItems.length : items.length)}
                    {visibleItems.map((item) => renderItem(item, item.id === value, () => {
                      onSelect(item)
                      setOpen(false)
                    }))}
                  </>
                )}

                {renderWorkflowGroup && (
                  <>
                    {(renderProjectGroup || renderAgentsGroup) && (
                      <div className="my-1 border-t border-gray-100 dark:border-white/[0.06]" />
                    )}
                    {sectionTitle(GitBranch, t('picker.workflowGroup'), normalizedQuery ? visibleWorkflows.length : workflows.length)}
                    {visibleWorkflows.map((w) => renderItem(w, w.id === workflowValue, () => {
                      onSelectWorkflow?.(w)
                      setOpen(false)
                    }))}
                  </>
                )}

                {!hasAny && (
                  <div className={POPOVER_EMPTY_CLASS}>
                    {onSelectProject ? projectEmpty : agentsEmptyHint}
                  </div>
                )}
              </>
            ) : (
              <>
                {activeCategory === 'project' && (projectItems.length === 0
                  ? <div className={POPOVER_EMPTY_CLASS}>{projectEmpty}</div>
                  : visibleProjectItems.map((p) => renderItem(p, p.id === projectValue, () => {
                      onSelectProject?.(p)
                      setOpen(false)
                    })))}
                {activeCategory === 'agents' && (items.length === 0
                  ? <div className={POPOVER_EMPTY_CLASS}>{agentsEmptyHint}</div>
                  : visibleItems.map((item) => renderItem(item, item.id === value, () => {
                      onSelect(item)
                      setOpen(false)
                    })))}
                {activeCategory === 'workflows' && (workflows.length === 0
                  ? <div className={POPOVER_EMPTY_CLASS}>{t('picker.emptyWorkflows')}</div>
                  : visibleWorkflows.map((w) => renderItem(w, w.id === workflowValue, () => {
                      onSelectWorkflow?.(w)
                      setOpen(false)
                    })))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}