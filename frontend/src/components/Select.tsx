import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check, Search } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
  disabled?: boolean
  /** 是否启用搜索过滤 */
  searchable?: boolean
  searchPlaceholder?: string
}

const TRIGGER_CLASS =
  'flex w-full items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm outline-none transition-all focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50'

export default function Select({
  value,
  onChange,
  options,
  placeholder,
  className = '',
  disabled,
  searchable = false,
  searchPlaceholder = '搜索...',
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [search, setSearch] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  )

  const filteredOptions = useMemo(() => {
    if (!searchable || !search.trim()) return options
    const q = search.trim().toLowerCase()
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, searchable, search])

  const close = useCallback(() => {
    setOpen(false)
    setActiveIndex(-1)
    setSearch('')
  }, [])

  // Focus search input when opened
  useEffect(() => {
    if (open && searchable) {
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }, [open, searchable])

  // Reset search when closed
  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  // Click outside to close
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        triggerRef.current?.contains(target) ||
        listRef.current?.contains(target)
      )
        return
      close()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, close])

  // Keyboard
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      // 搜索框中的按键不触发选项导航（Enter 除外）
      const inSearch = searchable && document.activeElement === searchRef.current
      if (inSearch && e.key !== 'Enter' && e.key !== 'Escape') return

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          setActiveIndex((prev) => {
            let next = prev + 1
            while (next < filteredOptions.length && filteredOptions[next].disabled) next++
            return next < filteredOptions.length ? next : prev
          })
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          setActiveIndex((prev) => {
            let next = prev - 1
            while (next >= 0 && filteredOptions[next].disabled) next--
            return next >= 0 ? next : prev
          })
          break
        }
        case 'Enter': {
          e.preventDefault()
          if (activeIndex >= 0 && activeIndex < filteredOptions.length) {
            const opt = filteredOptions[activeIndex]
            if (!opt.disabled) {
              onChange(opt.value)
              close()
            }
          }
          break
        }
        case 'Escape':
          e.preventDefault()
          close()
          break
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, activeIndex, filteredOptions, searchable, onChange, close])

  // Scroll active item into view
  useEffect(() => {
    if (!open || activeIndex < 0) return
    const opt = filteredOptions[activeIndex]
    if (!opt) return
    const el = itemRefs.current.get(opt.value)
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, filteredOptions])

  // Reset active index when search changes
  useEffect(() => {
    if (open && searchable) setActiveIndex(-1)
  }, [search, open, searchable])

  // Position dropdown — recompute on open, scroll, and resize so it follows the trigger
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  useEffect(() => {
    if (!open) return

    const update = () => {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      const bottomSpace = window.innerHeight - rect.bottom
      const topSpace = rect.top
      const minH = 160
      const dropUp = bottomSpace < minH && topSpace > bottomSpace

      setDropdownStyle({
        position: 'fixed',
        left: rect.left,
        width: rect.width,
        ...(dropUp
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
      })
    }

    update()

    // 监听窗口尺寸变化
    window.addEventListener('resize', update)
    // 监听所有滚动事件（捕获模式，覆盖模态框内的滚动容器）
    window.addEventListener('scroll', update, true)

    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, search])

  const displayText = selectedOption?.label ?? placeholder ?? ''

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return
          setOpen((prev) => !prev)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
          }
        }}
        className={TRIGGER_CLASS}
      >
        <span
          className={`truncate text-left ${
            selectedOption ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'
          }`}
        >
          {displayText}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-gray-400 transition-transform duration-200 dark:text-gray-500 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={listRef}
            style={dropdownStyle}
            className="z-[9999] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg shadow-black/5 dark:border-white/[0.08] dark:bg-[#1a1d2e] dark:shadow-black/30"
          >
            {searchable && (
              <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 dark:border-white/[0.06]">
                <Search size={14} className="shrink-0 text-gray-400" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400 dark:text-gray-200"
                />
              </div>
            )}
            <div className="max-h-60 overflow-y-auto">
              {filteredOptions.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                  无匹配结果
                </div>
              ) : (
                filteredOptions.map((option) => {
                const isSelected = option.value === value
                const isActive =
                  activeIndex >= 0
                    ? filteredOptions[activeIndex]?.value === option.value
                    : isSelected

                return (
                  <button
                    key={option.value}
                    ref={(el) => {
                      if (el) itemRefs.current.set(option.value, el)
                      else itemRefs.current.delete(option.value)
                    }}
                    type="button"
                    disabled={option.disabled}
                    onClick={() => {
                      if (option.disabled) return
                      onChange(option.value)
                      close()
                    }}
                    onMouseEnter={() => {
                      setActiveIndex(filteredOptions.indexOf(option))
                    }}
                    className={`flex w-full items-center gap-2 px-4 py-2 text-sm text-left transition-colors ${
                      option.disabled
                        ? 'cursor-not-allowed text-gray-300 dark:text-gray-600'
                        : isActive
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
                          : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.04]'
                    }`}
                  >
                    <span className="flex-1 truncate">{option.label}</span>
                    {isSelected && (
                      <Check size={15} className="shrink-0 text-blue-500 dark:text-blue-400" />
                    )}
                  </button>
                )
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
