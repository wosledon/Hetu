import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check, Search, X } from 'lucide-react'

export interface MultiSelectOption {
  value: string
  label: string
  /** 次要说明（如描述、来源） */
  hint?: string
  disabled?: boolean
  /** 分组名（同组选项在面板中聚合展示） */
  group?: string
}

interface MultiSelectProps {
  values: string[]
  onChange: (values: string[]) => void
  options: MultiSelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  /** 触发器自定义样式 */
  triggerClassName?: string
  /** 已选徽标最多展示几个，超出折叠为 +N */
  maxChips?: number
}

const TRIGGER_CLASS =
  'flex w-full min-h-[38px] items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-left outline-none transition-all focus:border-rose-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700'

/**
 * 可搜索的多选下拉：选项多时通过搜索 + 分组 + 全选快速勾选，
 * 触发器以徽标展示已选项。用于智能体的子智能体 / 技能等多选场景。
 */
export default function MultiSelect({
  values,
  onChange,
  options,
  placeholder = '请选择...',
  searchPlaceholder = '搜索...',
  emptyText = '无可选项',
  triggerClassName,
  maxChips = 4,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selectedOptions = useMemo(
    () => values.map((v) => options.find((o) => o.value === v)).filter((o): o is MultiSelectOption => !!o),
    [values, options],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q),
    )
  }, [options, search])

  const groups = useMemo(() => {
    const map = new Map<string, MultiSelectOption[]>()
    for (const o of filtered) {
      const key = o.group ?? ''
      const list = map.get(key)
      if (list) list.push(o)
      else map.set(key, [o])
    }
    return [...map.entries()]
  }, [filtered])

  const close = useCallback(() => {
    setOpen(false)
    setSearch('')
  }, [])

  useEffect(() => {
    if (open) requestAnimationFrame(() => searchRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      close()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, close])

  // 面板定位：跟随触发器，空间不足时向上展开
  const [style, setStyle] = useState<React.CSSProperties>({})
  useEffect(() => {
    if (!open) return
    const update = () => {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      const dropUp = window.innerHeight - rect.bottom < 220 && rect.top > window.innerHeight - rect.bottom
      setStyle({
        position: 'fixed',
        left: rect.left,
        width: Math.max(rect.width, 260),
        ...(dropUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  const toggle = (value: string) => {
    if (values.includes(value)) onChange(values.filter((v) => v !== value))
    else onChange([...values, value])
  }

  const setGroup = (groupOptions: MultiSelectOption[], select: boolean) => {
    const ids = groupOptions.filter((o) => !o.disabled).map((o) => o.value)
    if (select) onChange([...new Set([...values, ...ids])])
    else onChange(values.filter((v) => !ids.includes(v)))
  }

  const allFilteredIds = filtered.filter((o) => !o.disabled).map((o) => o.value)
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => values.includes(id))

  const visibleChips = selectedOptions.slice(0, maxChips)
  const hiddenCount = selectedOptions.length - visibleChips.length

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className={triggerClassName ?? TRIGGER_CLASS}
      >
        {selectedOptions.length === 0 ? (
          <span className="px-1 text-sm text-gray-400 dark:text-gray-500">{placeholder}</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1">
            {visibleChips.map((o) => (
              <span
                key={o.value}
                className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
              >
                {o.label}
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => { e.stopPropagation(); toggle(o.value) }}
                  className="rounded-full p-0.5 hover:bg-rose-200 dark:hover:bg-rose-800/40"
                >
                  <X size={9} />
                </span>
              </span>
            ))}
            {hiddenCount > 0 && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500 dark:bg-gray-600 dark:text-gray-300">
                +{hiddenCount}
              </span>
            )}
          </span>
        )}
        <ChevronDown
          size={14}
          className={`ml-auto shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          style={style}
          className="z-[9999] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg shadow-black/5 dark:border-white/[0.08] dark:bg-[#1a1d2e]"
        >
          <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 dark:border-white/[0.06]">
            <Search size={14} className="shrink-0 text-gray-400" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') close() }}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400 dark:text-gray-200"
            />
            <button
              onClick={() => setGroup(filtered, !allSelected)}
              className="shrink-0 text-[11px] text-gray-400 hover:text-rose-500"
            >
              {allSelected ? '清空' : '全选'}
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500">{emptyText}</div>
            )}
            {groups.map(([group, groupOptions]) => (
              <div key={group || '__default'}>
                {group && (
                  <div className="flex items-center justify-between px-3 pb-1 pt-1.5">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400">{group}</span>
                    <button
                      onClick={() => {
                        const ids = groupOptions.filter((o) => !o.disabled).map((o) => o.value)
                        const allIn = ids.length > 0 && ids.every((id) => values.includes(id))
                        setGroup(groupOptions, !allIn)
                      }}
                      className="text-[10px] text-gray-400 hover:text-rose-500"
                    >
                      {groupOptions.every((o) => values.includes(o.value)) ? '取消' : '全选'}
                    </button>
                  </div>
                )}
                {groupOptions.map((o) => {
                  const checked = values.includes(o.value)
                  return (
                    <button
                      key={o.value}
                      type="button"
                      disabled={o.disabled}
                      onClick={() => toggle(o.value)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                        o.disabled
                          ? 'cursor-not-allowed opacity-50'
                          : checked ? 'bg-rose-50 dark:bg-rose-500/10' : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                      }`}
                    >
                      <span
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                          checked
                            ? 'border-rose-500 bg-rose-500 text-white'
                            : 'border-gray-300 dark:border-gray-500'
                        }`}
                      >
                        {checked && <Check size={10} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-gray-700 dark:text-gray-200">{o.label}</span>
                        {o.hint && <span className="block truncate text-[10px] text-gray-400">{o.hint}</span>}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
