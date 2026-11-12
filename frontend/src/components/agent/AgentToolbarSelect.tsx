import { useState, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
import { POPOVER_PANEL_CLASS, popoverItemClass } from '../../utils/styles'

export interface AgentToolbarSelectOption {
  value: string
  label: string
  /** 选项图标（与触发器前面的图标同一套） */
  icon?: ReactNode
  /** 副标题：一句话说明该项含义/影响 */
  description?: string
}

export interface AgentToolbarSelectProps {
  value: string
  onChange: (value: string) => void
  options: AgentToolbarSelectOption[]
  title?: string
  className?: string
}

/**
 * 工具栏统一样式的下拉选择器。对话页与编码会话共用，
 * 展开菜单为统一风格（原为编码会话内部组件）。
 */
export default function AgentToolbarSelect({
  value,
  onChange,
  options,
  title,
  className = 'flex h-[26px] max-w-[140px] shrink-0 items-center justify-between gap-1 rounded-md px-1.5 text-[11px] text-gray-600 outline-none transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/50',
}: AgentToolbarSelectProps) {
  const { t } = useTranslation('agent')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  return (
    <div
      ref={ref}
      className="relative"
      onBlur={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false)
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        title={open ? undefined : (title ?? current?.label)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip-owner={open ? '' : undefined}
        className={className}
      >
        {/* 图标跟随当前选项，放在触发器内部，不再单独展示 */}
        {current?.icon && <span className="shrink-0">{current.icon}</span>}
        <span className="truncate">{current?.label ?? t('toolbar.none')}</span>
        <ChevronDown size={11} className={`shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="menu" className={`absolute bottom-full left-0 z-50 mb-2 max-h-72 min-w-52 max-w-[calc(100vw-2rem)] overflow-y-auto p-1.5 ${POPOVER_PANEL_CLASS}`}>
          {options.map((opt) => {
            const active = opt.value === value
            return (
              <button
                key={opt.value}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={popoverItemClass(active)}
              >
                {opt.icon && <span className="mt-0.5 shrink-0">{opt.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className={`block text-xs font-medium ${active ? 'text-blue-700 dark:text-blue-200' : 'text-gray-700 dark:text-gray-200'}`}>
                    {opt.label}
                  </span>
                  {opt.description && (
                    <span className="mt-0.5 block text-[11px] leading-4 text-gray-400 dark:text-gray-500">{opt.description}</span>
                  )}
                </span>
                {active && <Check size={13} className="mt-0.5 shrink-0 text-blue-500 dark:text-blue-300" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
