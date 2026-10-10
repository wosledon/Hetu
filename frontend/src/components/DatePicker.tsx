import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'

export interface DatePickerProps {
  /** YYYY-MM-DD，空字符串表示未选择 */
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  /** 自定义触发器样式（紧凑场景传入以覆盖默认大尺寸样式，需自带 flex 布局） */
  triggerClassName?: string
}

const TRIGGER_CLASS =
  'flex w-full items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm outline-none transition-all focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50'

const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const parseISO = (value: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** 日期展示：同年省略年份，跨年补全年份 */
function formatDay(date: Date, today: Date, t: (k: string, o?: Record<string, unknown>) => string): string {
  const base = t('ui:datePicker.dayMonth', { month: date.getMonth() + 1, day: date.getDate() })
  return date.getFullYear() === today.getFullYear() ? base : t('ui:datePicker.yearDayMonth', { year: date.getFullYear(), base })
}

/** 月份日历下拉：替代原生 date 输入，与封装的 Select 视觉一致 */
export default function DatePicker({
  value, onChange, placeholder, disabled, className = '', triggerClassName,
}: DatePickerProps) {
  const { t } = useTranslation()
  const weekdays = t('ui:datePicker.weekdays', { returnObjects: true }) as unknown as string[]
  const [open, setOpen] = useState(false)
  const selected = parseISO(value)
  const [view, setView] = useState(() => selected ?? new Date())
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (open && selected) setView(new Date(selected.getFullYear(), selected.getMonth(), 1))
  }, [open, selected])

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

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, close])

  // 面板定位：与 Select 一致，下方空间不足时向上展开
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({})
  useEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const dropUp = window.innerHeight - rect.bottom < 300 && rect.top > window.innerHeight - rect.bottom
    setPanelStyle({
      position: 'fixed',
      left: rect.left,
      top: dropUp ? undefined : rect.bottom + 4,
      bottom: dropUp ? window.innerHeight - rect.top + 4 : undefined,
    })
  }, [open])

  const today = new Date()
  const year = view.getFullYear()
  const month = view.getMonth()
  const startOffset = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = [
    ...Array.from({ length: startOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const cellClass = (active: boolean) =>
    `flex h-8 items-center justify-center rounded-lg text-[13px] transition-colors ${
      active
        ? 'bg-blue-500 text-white'
        : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/[0.06]'
    }`

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => { if (disabled) return; setOpen((v) => !v) }}
        className={triggerClassName ?? TRIGGER_CLASS}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <CalendarDays size={14} className="shrink-0 text-gray-400" />
          <span className={`truncate ${selected ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}`}>
            {selected ? formatDay(selected, today, t) : placeholder ?? t('ui:datePicker.pickHint')}
          </span>
        </span>
        <ChevronDown size={14} className={`shrink-0 text-gray-400 transition-transform dark:text-gray-500 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          style={panelStyle}
          className="z-[9999] w-[260px] rounded-xl border border-gray-200 bg-white p-3 shadow-lg shadow-black/5 dark:border-white/[0.08] dark:bg-[#1a1d2e] dark:shadow-black/30"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setView(new Date(year, month - 1, 1))}
              className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]"
              aria-label={t('ui:datePicker.prevMonth')}
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-[13px] font-medium text-gray-700 dark:text-gray-200">{t('ui:datePicker.yearMonth', { year, month: month + 1 })}</span>
            <button
              type="button"
              onClick={() => setView(new Date(year, month + 1, 1))}
              className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]"
              aria-label={t('ui:datePicker.nextMonth')}
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7">
            {weekdays.map((w, i) => (
              <span key={i} className="flex h-7 items-center justify-center text-[11px] text-gray-400 dark:text-gray-500">{w}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((date, i) => date ? (
              <button
                key={i}
                type="button"
                onClick={() => { onChange(toISO(date)); close() }}
                className={`${cellClass(selected ? isSameDay(date, selected) : false)} ${
                  isSameDay(date, today) && !(selected && isSameDay(date, selected)) ? 'ring-1 ring-blue-300 dark:ring-blue-500/50' : ''
                }`}
              >
                {date.getDate()}
              </button>
            ) : (
              <span key={i} />
            ))}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 dark:border-white/[0.06]">
            <button
              type="button"
              onClick={() => { const now = new Date(); onChange(toISO(now)); setView(new Date(now.getFullYear(), now.getMonth(), 1)) }}
              className="rounded-lg px-2 py-1 text-[12px] text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/40"
            >
              {t('ui:datePicker.today')}
            </button>
            <button
              type="button"
              onClick={() => { onChange(''); close() }}
              disabled={!selected}
              className="rounded-lg px-2 py-1 text-[12px] text-gray-500 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-white/[0.06]"
            >
              {t('ui:datePicker.clear')}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
