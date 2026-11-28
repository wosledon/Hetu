import { Fragment, useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Check } from 'lucide-react'
import { SearchInput, SurfaceButton } from './ui'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  /** 选项左侧装饰（状态圆点 / 类型图标），选中后同样显示在触发器里 */
  icon?: ReactNode
  /** 选项第二行说明，同时参与搜索 */
  description?: string
  /** 分组标题：相邻的同组选项自动渲染分组头 */
  group?: string
}

export interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
  disabled?: boolean
  /** 触发按钮的无障碍名称（紧凑触发器没有可见 label 时必填） */
  ariaLabel?: string
  /** 是否启用搜索过滤 */
  searchable?: boolean
  searchPlaceholder?: string
  /** 自定义触发器样式（紧凑场景传入以覆盖默认大尺寸样式） */
  triggerClassName?: string
  /** 展开面板用紧凑行高与小字号（属性栏等窄场景） */
  dense?: boolean
}

const TRIGGER_CLASS =
  'flex w-full items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50/50 glass px-4 py-2.5 text-sm outline-none transition-all focus:border-blue-400 focus:bg-white/70 focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50'

export default function Select({
  value,
  onChange,
  options,
  placeholder,
  className = '',
  disabled,
  searchable = false,
  searchPlaceholder,
  triggerClassName,
  ariaLabel,
  dense = false,
}: SelectProps) {
  const { t } = useTranslation()
  const searchHint = searchPlaceholder ?? t('ui:searchPlaceholder')
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
    return options.filter((o) => `${o.label} ${o.description ?? ''}`.toLowerCase().includes(q))
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

      // 紧凑模式：面板按内容收缩并右对齐触发器（属性栏里的窄下拉），不再拉满触发器宽度
      const panelMax = Math.min(dense ? 220 : 320, window.innerWidth - 16)
      setDropdownStyle({
        position: 'fixed',
        ...(dense
          ? { right: Math.max(8, window.innerWidth - rect.right), width: 'max-content', minWidth: 140, maxWidth: panelMax }
          : { left: Math.min(rect.left, window.innerWidth - panelMax - 8), width: Math.max(rect.width, 180) }),
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
  }, [open, search, dense])

  const displayText = selectedOption?.label ?? placeholder ?? ''

  return (
    <div className={`relative ${className}`}>
      <SurfaceButton
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => {
          if (disabled) return
          if (open) close()
          else setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
          }
        }}
        className={triggerClassName ?? TRIGGER_CLASS}
      >
        <span
          className={`flex min-w-0 items-center gap-2 ${
            selectedOption ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'
          }`}
        >
          {selectedOption?.icon && <span className="flex shrink-0 items-center">{selectedOption.icon}</span>}
          <span className="truncate text-left">{displayText}</span>
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-gray-400 transition-transform duration-200 dark:text-gray-500 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </SurfaceButton>

      {open &&
        createPortal(
          <div
            ref={listRef}
            style={dropdownStyle}
            className="animate-popover z-[9999] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg shadow-black/5 glass glass-float dark:border-white/[0.08] dark:bg-[#1a1d2e] dark:shadow-black/30"
          >
            {searchable && (
              <div className={`flex items-center gap-2 border-b border-gray-100 dark:border-white/[0.06] ${dense ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
                <SearchInput
                  ref={searchRef}
                  size="sm"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setActiveIndex(-1) }}
                  placeholder={searchHint}
                  className="w-full dark:text-gray-200"
                />
              </div>
            )}
            <div className={`overflow-y-auto ${dense ? 'max-h-52' : 'max-h-60'}`}>
              {filteredOptions.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                  {t('ui:noMatch')}
                </div>
              ) : (
                filteredOptions.map((option, index) => {
                const isSelected = option.value === value
                const isActive =
                  activeIndex >= 0
                    ? filteredOptions[activeIndex]?.value === option.value
                    : isSelected
                const showGroup = option.group !== undefined && filteredOptions[index - 1]?.group !== option.group

                return (
                  <Fragment key={option.value}>
                    {showGroup && (
                      <div className={`px-2.5 font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 ${dense ? 'pb-0.5 pt-1.5 text-[10px]' : 'pb-1 pt-2 text-[10px]'}`}>
                        {option.group}
                      </div>
                    )}
                    <SurfaceButton
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
                      className={`flex w-full items-start gap-2.5 px-3 text-left transition-colors ${dense ? 'py-1 text-[12px]' : 'py-2 text-sm'} ${
                        option.disabled
                          ? 'cursor-not-allowed text-gray-300 dark:text-gray-600'
                          : isActive
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
                            : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.04]'
                      }`}
                    >
                      {option.icon && <span className="mt-0.5 flex shrink-0 items-center">{option.icon}</span>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{option.label}</span>
                        {option.description && (
                          <span className={`mt-0.5 block truncate leading-tight text-gray-400 dark:text-gray-500 ${dense ? 'text-[10px]' : 'text-[11px]'}`}>
                            {option.description}
                          </span>
                        )}
                      </span>
                      {isSelected && (
                        <Check size={dense ? 13 : 15} className="mt-0.5 shrink-0 text-blue-500 dark:text-blue-400" />
                      )}
                    </SurfaceButton>
                  </Fragment>
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
