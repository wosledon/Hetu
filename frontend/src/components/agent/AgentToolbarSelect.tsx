import { useState, useRef } from 'react'

export interface AgentToolbarSelectOption {
  value: string
  label: string
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
        <span className="truncate">{current?.label ?? '未选择'}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="shrink-0 opacity-60">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 max-h-64 min-w-32 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
              className={`block w-full px-3 py-1.5 text-left text-[11px] transition-colors ${
                opt.value === value
                  ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300'
                  : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/60'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
