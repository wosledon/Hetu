import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Cpu } from 'lucide-react'
import { reasoningEffortDefault, reasoningEffortLabel, reasoningEffortOptions } from '../../utils/agentReasoning'
import { POPOVER_EMPTY_CLASS, POPOVER_PANEL_CLASS } from '../../utils/styles'
import { SearchInput, SurfaceButton, Slider } from '../ui'

export interface ModelPickerModel {
  id: string
  displayName: string
  providerId: string
  contextWindow?: number
  reasoningMode?: string | null
  reasoningEffort?: string | null
  reasoningEfforts?: string | null
  /** 该用途的默认模型：未显式选择时展示它，而不是列表第一个 */
  isDefault?: boolean
}

export interface ModelPickerProvider {
  id: string
  name: string
}

interface AgentModelPickerProps {
  models: ModelPickerModel[]
  providers: ModelPickerProvider[]
  modelId: string
  onModelChange: (id: string) => void
  /** 会话级推理强度（'' = 模型默认），仅 native 模型可调 */
  effort: string
  onEffortChange: (value: string) => void
  /** 会话级上下文上限（token），空 = 模型支持的上限 */
  contextWindow?: number
  onContextWindowChange: (value?: number) => void
  /** 触发按钮文案前缀（默认「模型」） */
  placeholder?: string
}

/** 上下文档位：只提供 512k / 256k / 128k 三档（均需不超过模型上限），外加「模型最大」一档 */
const CTX_PRESETS_K = [512, 256, 128]

const toK = (tokens: number) => Math.round(tokens / 1000)
/** 1000k 及以上显示为 1m / 1.5m ... */
const formatK = (k: number) => (k >= 1000 ? `${+(k / 1000).toFixed(k % 1000 === 0 ? 0 : 1)}m` : `${k}k`)

interface EnclosedSliderProps {
  labels: string[]
  index: number
  onChange: (index: number) => void
  ariaLabel: string
  tone: 'violet' | 'blue'
  className?: string
}

const SLIDER_TONES = {
  violet: {
    fill: 'from-emerald-500 via-teal-500 to-sky-600',
    focusRing: 'focus-within:ring-emerald-400/25',
  },
  blue: {
    fill: 'from-sky-500 via-blue-500 to-violet-600',
    focusRing: 'focus-within:ring-blue-400/25',
  },
} as const

const SLIDER_STARS = [
  { top: 20, size: 4.0, delay: -0.2, duration: 3.2 },
  { top: 60, size: 3.0, delay: -1.1, duration: 3.8 },
  { top: 34, size: 5.0, delay: -2.3, duration: 3.0 },
  { top: 68, size: 3.0, delay: -0.7, duration: 4.2 },
  { top: 26, size: 3.5, delay: -3.0, duration: 3.5 },
  { top: 54, size: 4.5, delay: -1.7, duration: 3.9 },
  { top: 42, size: 3.0, delay: -2.7, duration: 3.1 },
  { top: 66, size: 3.5, delay: -0.4, duration: 3.6 },
  { top: 30, size: 2.5, delay: -2.0, duration: 3.3 },
  { top: 48, size: 5.0, delay: -1.4, duration: 3.7 },
  { top: 72, size: 2.5, delay: -2.9, duration: 3.4 },
  { top: 38, size: 4.0, delay: -0.9, duration: 4.0 },
]

/**
 * 包裹式档位滑条：胶囊轨道包住整条滑条，白色圆形滑块落在当前档位。
 * 已选强度用绿→蓝渐变填充，轨道内有星光闪烁与自右向左的流光；档位越高流光越快。
 */
function EnclosedSlider({ labels, index, onChange, ariaLabel, tone, className }: EnclosedSliderProps) {
  const palette = SLIDER_TONES[tone]
  const count = Math.max(1, labels.length)
  const active = Math.min(Math.max(0, index), count - 1)
  const pct = count > 1 ? (active / (count - 1)) * 100 : 100
  // 滑块左边缘在 [0, 轨道宽-滑块宽] 之间移动：两端外沿贴住轨道，不越界
  const thumbLeft = `calc((100% - 32px) * ${pct / 100})`
  // 星星自右向左流动；档位越高，流动越快
  const starSpeedFactor = Math.max(0.55, 1.15 - (pct / 100) * 0.55)

  return (
    <div className={`relative mx-1 mt-2 h-9 select-none rounded-full bg-gray-200/70 ring-1 ring-inset ring-black/5 transition-shadow dark:bg-white/10 dark:ring-white/10 ${palette.focusRing} focus-within:ring-2 ${className ?? ''}`}>
      <div
        className={`absolute inset-y-0 left-0 overflow-hidden rounded-full bg-gradient-to-r ${palette.fill} transition-[width] duration-200`}
        style={{ width: `calc(32px + (100% - 32px) * ${pct / 100})` }}
      >
        {SLIDER_STARS.map((s, i) => (
          <span
            key={i}
            className="slider-star"
            style={{
              top: `${s.top}%`,
              width: s.size,
              height: s.size,
              animationDelay: `${s.delay}s`,
              animationDuration: `${Math.max(1.2, s.duration * starSpeedFactor)}s`,
            }}
          />
        ))}
      </div>
      <span
        className="absolute top-1/2 h-8 w-8 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_10px_rgba(15,23,42,0.28)] ring-1 ring-black/5 transition-[left] duration-200 dark:bg-gray-50 dark:ring-white/10"
        style={{ left: thumbLeft }}
      />
      <Slider
        min={0}
        max={Math.max(0, count - 1)}
        step={1}
        value={active}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel}
        aria-valuetext={labels[active]}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  )
}

/**
 * 模型选择器（对话与 Code 共用）：触发按钮展示模型 + 强度 + 上下文；
 * 弹窗左侧按供应商筛选模型，右侧对当前模型调推理强度（拖拽条）与上下文窗口。
 */
export default function AgentModelPicker({
  models,
  providers,
  modelId,
  onModelChange,
  effort,
  onEffortChange,
  contextWindow,
  onContextWindowChange,
  placeholder,
}: AgentModelPickerProps) {
  const { t } = useTranslation('agent')
  const modelLabel = placeholder ?? t('modelPicker.model')
  const [open, setOpen] = useState(false)
  // 手动切换过的供应商 tab；未手动切换时跟随当前模型所在供应商
  const [pickedProvider, setPickedProvider] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const current = models.find((m) => m.id === modelId) ?? models.find((m) => m.isDefault) ?? models.find((m) => m.providerId) ?? models[0]
  // 未显式选择模型时，回退展示的模型同样视作选中
  const effectiveModelId = modelId || current?.id || ''
  const currentEffort = current?.reasoningMode === 'native'
    ? (effort || current.reasoningEffort || reasoningEffortDefault(current)).trim().toLowerCase()
    : ''
  const currentCtxK = contextWindow && contextWindow > 0 ? toK(contextWindow) : current?.contextWindow ? toK(current.contextWindow) : undefined
  const currentProvider = providers.find((p) => p.id === current?.providerId)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  /** 供应商 tab：仅有模型的供应商，保持 providers 顺序 */
  const tabs = useMemo(
    () => providers.filter((p) => models.some((m) => m.providerId === p.id)),
    [providers, models],
  )
  const activeProvider = pickedProvider ?? current?.providerId ?? tabs[0]?.id ?? ''
  const visibleModels = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q) return models.filter((m) => m.displayName.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
    return models.filter((m) => m.providerId === activeProvider)
  }, [models, activeProvider, query])

  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? ''

  /** 模型可用上下文档位：模型上限 + 不超过上限的 512k/256k/128k */
  const ctxOptions = (model: ModelPickerModel): number[] => {
    const maxK = model.contextWindow && model.contextWindow > 0 ? toK(model.contextWindow) : 128
    const presets = CTX_PRESETS_K.filter((k) => k < maxK)
    return [maxK, ...presets]
  }

  // 强度：模型可用档位（默认档直接落到模型默认强度）；上下文：从小到大的滑条，最右侧 = 模型上限
  const effortValues = reasoningEffortOptions(current)
  const effortIndex = Math.max(0, effortValues.indexOf(currentEffort))
  const effortLabels = effortValues.map((v) => reasoningEffortLabel(v))
  const ctxValuesK = current ? [...ctxOptions(current)].reverse() : []
  const ctxIndex = ctxValuesK.length === 0
    ? 0
    : (() => {
        if (!contextWindow) return ctxValuesK.length - 1
        const found = ctxValuesK.indexOf(toK(contextWindow))
        return found >= 0 ? found : ctxValuesK.length - 1
      })()
  const ctxLabels = ctxValuesK.map((k) => formatK(k))

  const triggerTitle = [
    current?.displayName ?? modelLabel,
    currentEffort ? t('reasoning.effortLevel', { label: reasoningEffortLabel(currentEffort) }) : null,
    currentCtxK ? formatK(currentCtxK) : null,
  ].filter(Boolean).join(' · ')

  const toggleOpen = () => {
    if (!open) {
      setQuery('')
      setPickedProvider(null)
    }
    setOpen((v) => !v)
  }

  return (
    <div className="relative" ref={containerRef}>
      <SurfaceButton
        type="button"
        onClick={toggleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={open ? undefined : triggerTitle}
        data-tooltip-owner={open ? '' : undefined}
        className={`flex h-[26px] max-w-[240px] items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-colors ${
          open
            ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700/50 dark:hover:text-gray-200'
        }`}
      >
        <Cpu size={13} className="shrink-0 text-indigo-500 dark:text-indigo-300" />
        <span className="truncate">{current?.displayName ?? modelLabel}</span>
        {currentEffort && (
          <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
            {reasoningEffortLabel(currentEffort)}
          </span>
        )}
        {currentCtxK && <span className="shrink-0 text-[9px] tabular-nums text-gray-400 dark:text-gray-500">{formatK(currentCtxK)}</span>}
        <ChevronDown size={10} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </SurfaceButton>

      {open && (
        <div
          className={`absolute bottom-full right-0 z-50 mb-2 w-[560px] max-w-[calc(100vw-2rem)] overflow-hidden ${POPOVER_PANEL_CLASS}`}
        >
          <div className="border-b border-gray-100 px-3.5 pb-2.5 pt-3 dark:border-white/[0.06]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-100">{t('modelPicker.title')}</span>
              <span className="max-w-[220px] truncate rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                {current?.displayName ?? modelLabel}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-gray-400 dark:text-gray-500">{t('modelPicker.subtitle')}</p>
          </div>

          {tabs.length > 1 && (
            <div className="flex gap-1 overflow-x-auto border-b border-gray-100 px-2.5 py-2 dark:border-white/[0.06]">
              {tabs.map((p) => {
                const active = !query.trim() && activeProvider === p.id
                const count = models.filter((m) => m.providerId === p.id).length
                return (
                  <SurfaceButton
                    key={p.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setPickedProvider(p.id)
                      setQuery('')
                    }}
                    className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      active
                        ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                        : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.05]'
                    }`}
                  >
                    {p.name}
                    <span className={`rounded-full px-1.5 text-[9px] tabular-nums ${
                      active
                        ? 'bg-indigo-200/70 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200'
                        : 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'
                    }`}>
                      {count}
                    </span>
                  </SurfaceButton>
                )
              })}
            </div>
          )}

          <div className="border-b border-gray-100 p-2 dark:border-white/[0.06]">
            <SearchInput
              tone="indigo"
              size="sm"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('modelPicker.search')}
              className="w-full"
            />
          </div>

          <div className="flex min-h-0">
            <div className="w-[46%] min-w-0 border-r border-gray-100 dark:border-white/[0.06]">
              <div className="max-h-[min(46vh,300px)] overflow-y-auto p-1.5">
                {visibleModels.length === 0 && <div className={POPOVER_EMPTY_CLASS}>{t('modelPicker.empty')}</div>}
                {visibleModels.map((m) => {
                  const selected = m.id === effectiveModelId
                  return (
                    <SurfaceButton
                      key={m.id}
                      type="button"
                      onClick={() => {
                        onModelChange(m.id)
                        onEffortChange('')
                        onContextWindowChange(undefined)
                      }}
                      className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors ${
                        selected
                          ? 'bg-indigo-50/70 ring-1 ring-inset ring-indigo-500/15 dark:bg-indigo-500/[0.08] dark:ring-indigo-400/20'
                          : 'hover:bg-gray-50 dark:hover:bg-white/[0.045]'
                      }`}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-500/15 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-400/20">
                        <Cpu size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-xs font-medium ${selected ? 'text-indigo-700 dark:text-indigo-200' : 'text-gray-800 dark:text-gray-100'}`}>
                          {m.displayName}
                        </span>
                        {query.trim().length > 0 && (
                          <span className="mt-0.5 block truncate text-[10px] text-gray-400 dark:text-gray-500">{providerName(m.providerId)}</span>
                        )}
                      </span>
                      {selected && <Check size={13} className="shrink-0 text-indigo-500 dark:text-indigo-300" />}
                    </SurfaceButton>
                  )
                })}
              </div>
            </div>

            <div className="w-[54%] min-w-0 p-3">
              {current ? (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-gray-800 dark:text-gray-100">{current.displayName}</div>
                      <div className="mt-0.5 truncate text-[10px] text-gray-400 dark:text-gray-500">
                        {currentProvider?.name}
                        {current.contextWindow ? ` · ${formatK(toK(current.contextWindow))}` : ''}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                      {t('modelPicker.current')}
                    </span>
                  </div>

                  {current.reasoningMode === 'native' && (
                    <div className="mt-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                          {t('reasoning.effort')}
                        </span>
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
                          {reasoningEffortLabel(currentEffort)}
                        </span>
                      </div>
                      <EnclosedSlider
                        className="mt-2"
                        tone="violet"
                        ariaLabel={t('reasoning.effort')}
                        labels={effortLabels}
                        index={effortIndex}
                        onChange={(i) => onEffortChange(effortValues[i] ?? '')}
                      />
                    </div>
                  )}

                  {current.reasoningMode === 'tag' && (
                    <div className="mt-4 rounded-xl bg-gray-50 px-2.5 py-2 text-[10px] leading-4 text-gray-400 dark:bg-white/[0.04] dark:text-gray-500">
                      {t('reasoning.tagHint')}
                    </div>
                  )}

                  <div className="mt-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                        {t('modelPicker.context')}
                      </span>
                      <span className="text-[10px] tabular-nums text-gray-400 dark:text-gray-500">
                        {currentCtxK ? formatK(currentCtxK) : '—'}
                      </span>
                    </div>
                    <div className="mt-2">
                      {ctxValuesK.length > 1 ? (
                        <EnclosedSlider
                          tone="blue"
                          ariaLabel={t('modelPicker.context')}
                          labels={ctxLabels}
                          index={ctxIndex}
                          onChange={(i) => onContextWindowChange(i === ctxValuesK.length - 1 ? undefined : ctxValuesK[i] * 1000)}
                        />
                      ) : (
                        <div className="rounded-2xl border border-gray-200/80 bg-[var(--region-card-soft)] px-3 py-2 text-[11px] font-medium text-gray-500 dark:border-white/10 dark:text-gray-400">
                          {ctxLabels[0] ?? '—'}
                        </div>
                      )}
                    </div>
                    <p className="mt-1.5 text-[10px] leading-relaxed text-gray-400 dark:text-gray-500">{t('modelPicker.contextHint')}</p>
                  </div>
                </>
              ) : (
                <div className="text-[11px] text-gray-400 dark:text-gray-500">{t('modelPicker.pickModelHint')}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}