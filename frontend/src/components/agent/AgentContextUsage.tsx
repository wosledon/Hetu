import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Gauge } from 'lucide-react'
import type { IContextUsage } from '../../types/context'
import { formatTokens } from '../../utils/agentStream'
import { Button } from '../ui'
import { POPOVER_PANEL_CLASS } from '../../utils/styles'

export interface AgentContextUsageProps {
  usage: IContextUsage | null
  /** 重新拉取占用（压缩后 / 新一轮开始） */
  onRefresh?: () => void
  /** 压缩上下文（/compress），压缩中禁用 */
  onCompact?: () => void
  compacting?: boolean
  className?: string
}

/** 分块配色：系统提示 / 历史 / 摘要 */
const PART_COLORS: Record<string, string> = {
  system: 'bg-slate-400',
  history: 'bg-blue-500',
  summary: 'bg-violet-500',
}

function ratioTone(ratio: number): { stroke: string; text: string } {
  if (ratio >= 0.9) return { stroke: 'text-rose-500', text: 'text-rose-600 dark:text-rose-400' }
  if (ratio >= 0.7) return { stroke: 'text-amber-500', text: 'text-amber-600 dark:text-amber-400' }
  return { stroke: 'text-blue-500', text: 'text-gray-600 dark:text-gray-300' }
}

/**
 * 会话信息：圆形进度条 + 占比，鼠标移入或点击展开明细（窗口 / 已用 / 各分块）。
 * 对话页与编码会话共用，放在输入框右下角。
 */
export default function AgentContextUsage({ usage, onRefresh, onCompact, compacting = false, className }: AgentContextUsageProps) {
  const { t } = useTranslation('agent')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  // 触发按钮与面板之间有一段间隙，延迟关闭让指针能移到面板上
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => setOpen(false), 400)
  }

  useEffect(() => () => cancelClose(), [])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (open) onRefresh?.()
  }, [open, onRefresh])

  const ratio = usage ? Math.min(1, Math.max(0, usage.ratio)) : 0
  const percent = Math.round(ratio * 100)
  const tone = ratioTone(ratio)
  const radius = 8
  const circumference = 2 * Math.PI * radius

  return (
    <div
      ref={ref}
      className={`relative flex shrink-0 items-center ${className ?? ''}`}
      onMouseEnter={() => { cancelClose(); setOpen(true); onRefresh?.() }}
      onMouseLeave={scheduleClose}
    >
      <Button variant="ghost" tone="gray" className="flex h-[27px] items-center gap-1 rounded-lg px-1.5 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50" onClick={() => { setOpen(true); onRefresh?.() }}
        title={open ? undefined : t('contextUsage.trigger')}
        aria-label={t('contextUsage.trigger')}
        data-tooltip-owner={open ? '' : undefined}>
        <svg width="20" height="20" viewBox="0 0 20 20" className="shrink-0 -rotate-90">
          <circle cx="10" cy="10" r={radius} fill="none" strokeWidth="3.5" className="stroke-gray-200 dark:stroke-gray-700" />
          <circle
            cx="10"
            cy="10"
            r={radius}
            fill="none"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={`${circumference}`}
            strokeDashoffset={`${circumference * (1 - ratio)}`}
            className={`stroke-current transition-all ${tone.stroke}`}
          />
        </svg>
        <span className={tone.text}>{usage ? `${percent}%` : '—'}</span>
      </Button>

      {open && (
        <div className={`absolute bottom-full right-0 z-50 mb-2 w-80 max-w-[calc(100vw-2rem)] p-3.5 ${POPOVER_PANEL_CLASS}`}>
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-50 dark:bg-white/[0.05]">
              <Gauge size={14} className={tone.stroke} />
            </span>
            <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">{t('contextUsage.title')}</span>
            <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-gray-500 dark:bg-white/[0.06] dark:text-gray-300">
              {usage ? `${percent}%` : t('contextUsage.notCounted')}
            </span>
          </div>

          {!usage ? (
            <div className="text-[11px] text-gray-400">{t('common:empty')}</div>
          ) : (
            <>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-gray-50/70 px-3 py-2 dark:bg-white/[0.035]">
                  <div className="text-[10px] text-gray-400">{t('contextUsage.window')}</div>
                  <div className="mt-0.5 text-xs font-semibold tabular-nums text-gray-800 dark:text-gray-100">{formatTokens(usage.window)}</div>
                </div>
                <div className="rounded-xl bg-gray-50/70 px-3 py-2 dark:bg-white/[0.035]">
                  <div className="text-[10px] text-gray-400">{t('contextUsage.used')}</div>
                  <div className="mt-0.5 text-xs font-semibold tabular-nums text-gray-800 dark:text-gray-100">{formatTokens(usage.used)}</div>
                </div>
              </div>

              <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                {usage.parts.filter((p) => p.tokens > 0).map((p) => (
                  <div
                    key={p.key}
                    className={PART_COLORS[p.key] ?? 'bg-gray-400'}
                    style={{ width: `${usage.used > 0 ? (p.tokens / usage.used) * 100 : 0}%` }}
                  />
                ))}
              </div>

              <div className="flex flex-col gap-2">
                {usage.parts.map((p) => (
                  <div key={p.key} className="flex items-center gap-2 text-[11px]">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${PART_COLORS[p.key] ?? 'bg-gray-400'}`} />
                    <span className="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300">{p.label}</span>
                    <span className="shrink-0 tabular-nums text-gray-500 dark:text-gray-400">{formatTokens(p.tokens)}</span>
                    <span className="w-9 shrink-0 text-right tabular-nums text-gray-400">
                      {usage.used > 0 ? `${Math.round((p.tokens / usage.used) * 100)}%` : '0%'}
                    </span>
                  </div>
                ))}
              </div>

              {usage.hasSummary && (
                <p className="mt-2 rounded-lg bg-violet-50 px-2 py-1 text-[10px] leading-relaxed text-violet-700 dark:bg-violet-900/20 dark:text-violet-300">
                  {t('contextUsage.summary', { n: usage.summarizedMessages })}
                </p>
              )}
              <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
                {t('contextUsage.hint')}
              </p>

              {(onCompact || onRefresh) && (
                <div className="mt-3 border-t border-gray-100 pt-3 dark:border-white/[0.06]">
                  {onCompact && (
                    <Button variant="primary" tone="violet" className="w-full rounded-lg bg-violet-500 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-violet-600 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700" onClick={onCompact}
                      disabled={compacting}>
                      {compacting ? t('contextUsage.compacting') : t('contextUsage.compact')}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
