import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Brain, Check, ChevronDown, GitBranch } from 'lucide-react'
import { POPOVER_EMPTY_CLASS, POPOVER_PANEL_CLASS, POPOVER_SECTION_TITLE_CLASS, popoverItemClass } from '../../utils/styles'
import { SearchInput } from '../ui'

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

const ICONS = { bot: Bot, brain: Brain, git: GitBranch } as const

const BADGE_CLASSES: Record<string, string> = {
  专业: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  本地: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  '.github': 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400',
}

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
  const searchable = items.length + projectItems.length + workflows.length > 5

  const selected = items.find((i) => i.id === value)
  const selectedProject = projectItems.find((p) => p.id === projectValue)
  const selectedWorkflow = workflows.find((w) => w.id === workflowValue)
  const active = !!selected || !!selectedProject || !!selectedWorkflow
  const current = selectedWorkflow ?? selectedProject ?? selected
  const CurrentIcon = ICONS[current?.icon ?? 'bot']

  const renderItem = (item: AgentPickerItem, active: boolean, onClick: () => void) => {
    const Icon = ICONS[item.icon ?? 'bot']
    return (
      <button
        key={item.id}
        onClick={onClick}
        title={item.description}
        className={popoverItemClass(active)}
      >
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
          item.icon === 'brain'
            ? 'bg-violet-50 text-violet-500 dark:bg-violet-500/10 dark:text-violet-300'
            : item.icon === 'git'
              ? 'bg-blue-50 text-blue-500 dark:bg-blue-500/10 dark:text-blue-300'
              : 'bg-indigo-50 text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-300'
        }`}>
          <Icon size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={`truncate text-xs font-medium ${active ? 'text-blue-700 dark:text-blue-200' : 'text-gray-800 dark:text-gray-200'}`}>{item.name}</span>
            {item.badge && (
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${BADGE_CLASSES[item.badge] ?? 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'}`}>
                {item.badge}
              </span>
            )}
          </span>
          {item.description && <span className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-gray-400 dark:text-gray-500">{item.description}</span>}
        </span>
        {active && <Check size={13} className="mt-1 shrink-0 text-blue-500 dark:text-blue-300" />}
      </button>
    )
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => {
          if (!open) setQuery('')
          setOpen((v) => !v)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip-owner={open ? '' : undefined}
        className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
          active
            ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
            : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300'
        }`}
        title={open ? undefined : triggerTitle}
      >
        <CurrentIcon size={14} />
        {selectedWorkflow?.name ?? selectedProject?.name ?? selected?.name ?? triggerLabel}
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="menu" className={`absolute bottom-full left-0 z-50 mb-2 w-72 overflow-hidden ${POPOVER_PANEL_CLASS}`}>
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
          <div className="max-h-72 overflow-y-auto p-1.5">
            {/* 项目分组置顶：项目 .github 下的智能体与当前工作最相关 */}
            {onSelectProject && (
              <>
                <div className={POPOVER_SECTION_TITLE_CLASS}>{projectLabel}</div>
                {projectItems.length === 0 ? (
                  <div className={POPOVER_EMPTY_CLASS}>{projectEmpty}</div>
                ) : (
                  visibleProjectItems.map((p) => renderItem(p, p.id === projectValue, () => { onSelectProject(p); setOpen(false) }))
                )}
                <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
              </>
            )}
            <div className={POPOVER_SECTION_TITLE_CLASS}>{agentsGroupLabel}</div>
            {items.length === 0 ? (
              <div className={POPOVER_EMPTY_CLASS}>{agentsEmptyHint}</div>
            ) : (
              visibleItems.map((item) => renderItem(item, item.id === value, () => { onSelect(item); setOpen(false) }))
            )}
            {onSelectWorkflow && (
              <>
                <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
                <div className={POPOVER_SECTION_TITLE_CLASS}>{t('picker.workflowGroup')}</div>
                {workflows.length === 0 ? (
                  <div className={POPOVER_EMPTY_CLASS}>{t('picker.emptyWorkflows')}</div>
                ) : (
                  visibleWorkflows.map((w) => renderItem(w, w.id === workflowValue, () => { onSelectWorkflow(w); setOpen(false) }))
                )}
              </>
            )}
            {query.trim() && visibleItems.length + visibleProjectItems.length + visibleWorkflows.length === 0 && (
              <div className={POPOVER_EMPTY_CLASS}>{t('picker.noMatches')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
