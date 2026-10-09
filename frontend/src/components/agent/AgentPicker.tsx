import { useEffect, useRef, useState } from 'react'
import { Bot, Brain, Check, ChevronDown, GitBranch } from 'lucide-react'

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
  title = '智能体 / 工作流',
  placeholder = '智能体',
  groupLabel = '智能体',
  projectGroupLabel = '项目',
  emptyHint = '暂无智能体',
  projectEmptyHint = '当前项目未定义 .github 智能体',
}: AgentPickerProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

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
        className={`w-full rounded-lg px-3 py-1.5 text-left ${active ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}
      >
        <div className="flex items-center gap-2">
          <Icon size={12} className={`shrink-0 ${item.icon === 'brain' ? 'text-violet-400' : item.icon === 'git' ? 'text-blue-500' : 'text-indigo-400'}`} />
          <span className={`text-xs font-medium ${active ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-800 dark:text-gray-200'}`}>{item.name}</span>
          {item.badge && (
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${BADGE_CLASSES[item.badge] ?? 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'}`}>
              {item.badge}
            </span>
          )}
          {active && <Check size={12} className="ml-auto shrink-0 text-indigo-500" />}
        </div>
      </button>
    )
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
          active
            ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
            : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300'
        }`}
        title={title}
      >
        <CurrentIcon size={14} />
        {selectedWorkflow?.name ?? selectedProject?.name ?? selected?.name ?? placeholder}
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-56 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">
          <div className="max-h-72 overflow-y-auto p-1.5">
            {/* 项目分组置顶：项目 .github 下的智能体与当前工作最相关 */}
            {onSelectProject && (
              <>
                <div className="mb-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{projectGroupLabel}</div>
                {projectItems.length === 0 ? (
                  <div className="p-3 text-center text-xs text-gray-500">{projectEmptyHint}</div>
                ) : (
                  projectItems.map((p) => renderItem(p, p.id === projectValue, () => { onSelectProject(p); setOpen(false) }))
                )}
                <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
              </>
            )}
            <div className="mb-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{groupLabel}</div>
            {items.length === 0 ? (
              <div className="p-3 text-center text-xs text-gray-500">{emptyHint}</div>
            ) : (
              items.map((item) => renderItem(item, item.id === value, () => { onSelect(item); setOpen(false) }))
            )}
            {onSelectWorkflow && (
              <>
                <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
                <div className="mb-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">工作流</div>
                {workflows.length === 0 ? (
                  <div className="p-3 text-center text-xs text-gray-500">暂无工作流</div>
                ) : (
                  workflows.map((w) => renderItem(w, w.id === workflowValue, () => { onSelectWorkflow(w); setOpen(false) }))
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
