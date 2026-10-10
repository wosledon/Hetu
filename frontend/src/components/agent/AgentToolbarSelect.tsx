import { useState, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

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
    >
      <button
        onClick={() => setOpen((v) => !v)}
        title={title ?? current?.label}
        className={className}
      >
        {/* 图标跟随当前选项，放在触发器内部，不再单独展示 */}
        {current?.icon && <span className="shrink-0">{current.icon}</span>}
        <span className="truncate">{current?.label ?? t('toolbar.none')}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="shrink-0 opacity-60">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 max-h-72 min-w-44 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
              className={`flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors ${
                opt.value === value
                  ? 'bg-blue-50 dark:bg-blue-900/30'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700/60'
              }`}
            >
              {opt.icon && <span className="mt-0.5 shrink-0">{opt.icon}</span>}
              <span className="min-w-0 flex-1">
                <span className={`block text-[11px] font-medium ${opt.value === value ? 'text-blue-600 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200'}`}>
                  {opt.label}
                </span>
                {opt.description && (
                  <span className="mt-0.5 block text-[10px] leading-snug text-gray-400 dark:text-gray-500">{opt.description}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
