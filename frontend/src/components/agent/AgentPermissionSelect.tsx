import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ClipboardList, Eye, ShieldCheck, ShieldOff, Sparkles } from 'lucide-react'
import { useAgentPermissionModes } from '../../hooks/useAgentPermissionModes'
import { POPOVER_PANEL_CLASS } from '../../utils/styles'

export interface AgentPermissionSelectProps {
  value: string
  onChange: (value: string) => void
  className?: string
}

interface ModeVisual {
  Icon: typeof ShieldCheck
  /** 触发器图标颜色 */
  iconColor: string
  /** 选项里的图标胶囊 */
  iconBox: string
  /** 当前档位行的高亮 */
  activeRow: string
  /** 当前档位勾选颜色 */
  check: string
  /** 当前档位左侧强调条 */
  accent: string
}

/** 图标与配色属于前端展示层；名称与说明由后端 /api/agent/permission-modes 下发 */
const MODE_VISUALS: Record<string, ModeVisual> = {
  plan: {
    Icon: ClipboardList,
    iconColor: 'text-sky-500 dark:text-sky-400',
    iconBox: 'bg-sky-50 text-sky-600 ring-sky-500/15 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20',
    activeRow: 'bg-sky-50/70 ring-1 ring-inset ring-sky-500/15 dark:bg-sky-500/[0.08] dark:ring-sky-400/20',
    check: 'text-sky-500 dark:text-sky-300',
    accent: 'bg-sky-400',
  },
  readonly: {
    Icon: Eye,
    iconColor: 'text-slate-400 dark:text-slate-400',
    iconBox: 'bg-slate-100 text-slate-500 ring-slate-500/10 dark:bg-white/[0.06] dark:text-slate-300 dark:ring-white/10',
    activeRow: 'bg-slate-100/70 ring-1 ring-inset ring-slate-500/15 dark:bg-white/[0.06] dark:ring-white/10',
    check: 'text-slate-500 dark:text-slate-300',
    accent: 'bg-slate-400',
  },
  ask: {
    Icon: ShieldCheck,
    iconColor: 'text-amber-500 dark:text-amber-400',
    iconBox: 'bg-amber-50 text-amber-600 ring-amber-500/15 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
    activeRow: 'bg-amber-50/70 ring-1 ring-inset ring-amber-500/20 dark:bg-amber-500/[0.08] dark:ring-amber-400/20',
    check: 'text-amber-500 dark:text-amber-300',
    accent: 'bg-amber-400',
  },
  auto: {
    Icon: Sparkles,
    iconColor: 'text-emerald-500 dark:text-emerald-400',
    iconBox: 'bg-emerald-50 text-emerald-600 ring-emerald-500/15 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20',
    activeRow: 'bg-emerald-50/70 ring-1 ring-inset ring-emerald-500/20 dark:bg-emerald-500/[0.08] dark:ring-emerald-400/20',
    check: 'text-emerald-500 dark:text-emerald-300',
    accent: 'bg-emerald-400',
  },
  bypass: {
    Icon: ShieldOff,
    iconColor: 'text-rose-500 dark:text-rose-400',
    iconBox: 'bg-rose-50 text-rose-600 ring-rose-500/15 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20',
    activeRow: 'bg-rose-50/70 ring-1 ring-inset ring-rose-500/20 dark:bg-rose-500/[0.08] dark:ring-rose-400/20',
    check: 'text-rose-500 dark:text-rose-300',
    accent: 'bg-rose-400',
  },
}

const FALLBACK_VISUAL = MODE_VISUALS.ask

/**
 * 权限模式选择器。对话框式面板：顶部说明当前档位与生效方式，
 * 下方五档各带图标、名称与影响说明；名称/说明来自后端，前端只负责展示。
 */
export default function AgentPermissionSelect({ value, onChange, className }: AgentPermissionSelectProps) {
  const { t } = useTranslation('agent')
  const { data: modes = [] } = useAgentPermissionModes()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const current = modes.find((m) => m.value === value)
  const currentVisual = MODE_VISUALS[value] ?? FALLBACK_VISUAL
  const CurrentIcon = currentVisual.Icon
  // 首次加载时先用原始值占位，避免工具栏短暂显示“无”
  const options = modes.length > 0 ? modes : [{ value, label: value, description: '' }]

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node)) setOpen(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false)
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={open ? undefined : t('permission.title', { label: current?.label ?? value })}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip-owner={open ? '' : undefined}
        className={`flex h-[26px] max-w-[150px] shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-gray-600 outline-none transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/50 ${className ?? ''}`}
      >
        <CurrentIcon size={13} className={`shrink-0 ${currentVisual.iconColor}`} />
        <span className="truncate font-medium">{current?.label ?? value}</span>
        <ChevronDown size={11} className={`shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className={`absolute bottom-full right-0 z-50 mb-2 w-[320px] max-w-[calc(100vw-2rem)] origin-bottom-right overflow-hidden ${POPOVER_PANEL_CLASS}`}
        >
          <div className="border-b border-gray-100 px-3.5 pb-2.5 pt-3 dark:border-white/[0.06]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-100">
                {t('permission.panelTitle')}
              </span>
              <span className="max-w-[140px] truncate rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                {current?.label ?? value}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-gray-400 dark:text-gray-500">
              {t('permission.panelHint')}
            </p>
          </div>

          <div
            role="menu"
            aria-label={t('permission.panelTitle')}
            className="max-h-[min(56vh,344px)] overflow-y-auto p-1.5"
          >
            {options.map((opt) => {
              const visual = MODE_VISUALS[opt.value] ?? FALLBACK_VISUAL
              const Icon = visual.Icon
              const active = opt.value === value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    onChange(opt.value)
                    setOpen(false)
                  }}
                  className={`group relative flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                    active ? visual.activeRow : 'hover:bg-gray-50 dark:hover:bg-white/[0.045]'
                  }`}
                >
                  {active && (
                    <span className={`absolute inset-y-2 left-0 w-[3px] rounded-r-full ${visual.accent}`} />
                  )}
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${visual.iconBox}`}
                  >
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-gray-700 dark:text-gray-100">
                      {opt.label}
                    </span>
                    {opt.description && (
                      <span className="mt-0.5 block text-[11px] leading-4 text-gray-400 dark:text-gray-500">
                        {opt.description}
                      </span>
                    )}
                  </span>
                  <span className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center ${active ? visual.check : ''}`}>
                    {active ? (
                      <Check size={13} strokeWidth={2.5} />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-gray-200 dark:bg-gray-700" />
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}