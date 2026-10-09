import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Cpu, Search } from 'lucide-react'
import { reasoningEffortLabel, reasoningEffortOptions } from '../../utils/agentReasoning'
import { segmentButtonClass } from '../../utils/styles'

export interface ModelPickerModel {
  id: string
  displayName: string
  providerId: string
  contextWindow?: number
  reasoningMode?: string | null
  reasoningEffort?: string | null
  reasoningEfforts?: string | null
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
/** 胶囊滑动 tab：外层分段容器 + 内层选中态填充 */
const segmentGroupClass =
  'flex flex-wrap items-center gap-0.5 rounded-full bg-gray-100/80 p-0.5 dark:bg-white/[0.06]'
const segmentItemClass = (active: boolean) =>
  `rounded-full px-2 py-0.5 text-[11px] font-medium transition-all ${segmentButtonClass(active)}`

/**
 * 模型 + 推理强度 + 上下文 三合一选择器（对话与 Code 共用）：
 * 左侧按供应商 tab 选模型，右侧对当前（悬停/选中）模型用胶囊选择推理强度与上下文大小；
 * 触发按钮展示为「模型 · 推理强度 · 上下文大小」。
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
  placeholder = '模型',
}: AgentModelPickerProps) {
  // 独立面板：模型列表 / 推理强度 / 上下文大小
  const [menu, setMenu] = useState<'model' | 'effort' | 'context' | null>(null)
  // 手动切换过的供应商 tab；未手动切换时跟随当前模型所在供应商
  const [pickedProvider, setPickedProvider] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // 悬停的模型：模型列表右侧的推理/上下文面板优先跟随它
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const toggleMenu = (kind: 'model' | 'effort' | 'context') => {
    if (menu === kind) {
      setMenu(null)
      return
    }
    if (kind === 'model') {
      setPickedProvider(null)
      setQuery('')
      setHoveredId(null)
    }
    setMenu(kind)
  }

  const current = models.find((m) => m.id === modelId) ?? models.find((m) => m.providerId) ?? models[0]
  // 未显式选择模型时，回退展示的模型同样视作选中
  const effectiveModelId = modelId || current?.id || ''
  const currentEffort = (effort || current?.reasoningEffort || '').trim().toLowerCase()
  const currentCtxK = contextWindow && contextWindow > 0 ? toK(contextWindow) : current?.contextWindow ? toK(current.contextWindow) : undefined

  useEffect(() => {
    if (!menu) return
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setMenu(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [menu])

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

  const flyoutModel = models.find((m) => m.id === hoveredId) ?? current ?? visibleModels[0]
  const flyoutSelected = flyoutModel?.id === effectiveModelId

  // 右侧推理/上下文面板纵向对齐当前（悬停）模型行：以行中心对齐面板中心，并夹在容器内
  const flyoutRef = useRef<HTMLDivElement>(null)
  const modelCardRef = useRef<HTMLDivElement>(null)
  const [flyoutTop, setFlyoutTop] = useState(0)
  const trackFlyout = (row: HTMLElement) => {
    const wrap = flyoutRef.current
    const card = modelCardRef.current
    if (!wrap || !card) return
    const inner = wrap.firstElementChild as HTMLElement | null
    if (!inner) return
    const rowRect = row.getBoundingClientRect()
    const wrapRect = wrap.getBoundingClientRect()
    const centered = rowRect.top - wrapRect.top + rowRect.height / 2 - inner.offsetHeight / 2
    const max = Math.max(0, card.offsetHeight - inner.offsetHeight)
    setFlyoutTop(Math.max(0, Math.min(centered, max)))
  }

  /** 模型可用上下文档位：模型上限 + 不超过上限的 512k/256k/128k */
  const ctxOptions = (model: ModelPickerModel): number[] => {
    const maxK = model.contextWindow && model.contextWindow > 0 ? toK(model.contextWindow) : 128
    const presets = CTX_PRESETS_K.filter((k) => k < maxK)
    return [maxK, ...presets]
  }

  const triggerTitle = [
    current?.displayName ?? placeholder,
    currentEffort ? `${reasoningEffortLabel(currentEffort)}强度` : null,
    currentCtxK ? formatK(currentCtxK) : null,
  ].filter(Boolean).join(' · ')

  /** 推理强度胶囊滑动 tab */
  const effortGroup = (target: ModelPickerModel, selected: boolean) => (
    <div className={segmentGroupClass}>
      {['', ...reasoningEffortOptions(target)].map((l) => (
        <button
          key={l || 'default'}
          onClick={() => {
            if (!selected) onModelChange(target.id)
            onEffortChange(l)
          }}
          className={segmentItemClass(selected ? effort === l : l === '')}
        >
          {l ? `${reasoningEffortLabel(l)}强度` : '默认'}
        </button>
      ))}
    </div>
  )

  /** 上下文大小胶囊滑动 tab */
  const contextGroup = (target: ModelPickerModel, selected: boolean) => (
    <div className={segmentGroupClass}>
      {ctxOptions(target).map((k, idx) => {
        const isMax = idx === 0
        const active = selected && !contextWindow ? isMax : selected && toK(contextWindow ?? 0) === k
        return (
          <button
            key={k}
            onClick={() => {
              if (!selected) onModelChange(target.id)
              onContextWindowChange(isMax ? undefined : k * 1000)
            }}
            title={isMax ? '模型支持的上限' : `限制为 ${formatK(k)}`}
            className={segmentItemClass(active)}
          >
            {formatK(k)}
          </button>
        )
      })}
    </div>
  )

  const triggerSegmentClass = (active: boolean) =>
    `flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors ${
      active
        ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-300'
    }`
  const panelClass =
    'absolute bottom-full left-0 z-50 mb-2 rounded-xl bg-white p-3 shadow-xl ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700'
  const panelTitleClass = 'mb-2 truncate text-[11px] font-medium text-gray-500 dark:text-gray-400'
  const groupTitleClass = 'mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400'

  return (
    <div className="relative" ref={containerRef}>
      <div className="flex items-center gap-0.5">
        <button onClick={() => toggleMenu('model')} title={triggerTitle} className={triggerSegmentClass(menu === 'model')}>
          <Cpu size={14} className="shrink-0" />
          <span className="max-w-40 truncate">{current?.displayName ?? placeholder}</span>
          <ChevronDown size={10} className="shrink-0" />
        </button>

        {currentEffort && (
          <>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <button onClick={() => toggleMenu('effort')} title="推理强度" className={triggerSegmentClass(menu === 'effort')}>
              {reasoningEffortLabel(currentEffort)}强度
            </button>
          </>
        )}

        {currentCtxK && (
          <>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <button onClick={() => toggleMenu('context')} title="上下文大小" className={triggerSegmentClass(menu === 'context')}>
              {formatK(currentCtxK)}
            </button>
          </>
        )}
      </div>

      {menu === 'model' && (
        <div className="absolute bottom-full left-0 z-50 mb-2 flex max-w-[calc(100vw-3rem)] items-start">
          {/* 一张卡片：左侧供应商纵列 + 右侧搜索与模型列表 */}
          <div
            ref={modelCardRef}
            className="flex overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700"
          >
            <div className="flex w-28 shrink-0 flex-col overflow-y-auto border-r border-gray-100 py-1 dark:border-gray-700">
              {tabs.map((p) => {
                const active = !query && activeProvider === p.id
                return (
                  <button
                    key={p.id}
                    onClick={() => { setPickedProvider(p.id); setQuery(''); setHoveredId(null); setFlyoutTop(0) }}
                    title={p.name}
                    className={`flex items-center gap-1.5 px-2.5 py-2 text-left text-[11px] font-medium transition-colors ${
                      active
                        ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300'
                        : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700/40 dark:hover:text-gray-200'
                    }`}
                  >
                    <span className={`h-3.5 w-0.5 shrink-0 rounded-full ${active ? 'bg-indigo-500' : 'bg-transparent'}`} />
                    <span className="truncate">{p.name}</span>
                    <span className="ml-auto shrink-0 text-[10px] tabular-nums text-gray-400">
                      {models.filter((m) => m.providerId === p.id).length}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="flex w-60 shrink-0 flex-col">
              <div className="relative border-b border-gray-100 p-2 dark:border-gray-700">
                <Search size={12} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索模型..."
                  className="w-full rounded-lg border border-gray-200/80 bg-gray-50/80 py-1.5 pl-6 pr-2 text-[12px] outline-none transition-all placeholder:text-gray-400 focus:border-indigo-300 focus:bg-white dark:border-gray-700 dark:bg-gray-900/60 dark:focus:border-indigo-500"
                />
              </div>

              <div className="max-h-80 min-h-56 overflow-y-auto p-1.5">
                {visibleModels.length === 0 && <div className="p-3 text-center text-xs text-gray-500">暂无模型</div>}
                {visibleModels.map((m) => {
                  const selected = m.id === effectiveModelId
                  return (
                    <button
                      key={m.id}
                      onMouseEnter={(e) => { setHoveredId(m.id); trackFlyout(e.currentTarget) }}
                      onFocus={(e) => { setHoveredId(m.id); trackFlyout(e.currentTarget) }}
                      onClick={(e) => {
                        onModelChange(m.id)
                        onEffortChange('')
                        onContextWindowChange(undefined)
                        setHoveredId(m.id)
                        trackFlyout(e.currentTarget)
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                        selected ? 'bg-indigo-50 dark:bg-indigo-900/25' : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'
                      }`}
                    >
                      <span className={`min-w-0 flex-1 truncate text-xs font-medium ${selected ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-800 dark:text-gray-200'}`}>
                        {m.displayName}
                      </span>
                      {selected && <Check size={12} className="shrink-0 text-indigo-500" />}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* 右侧：推理强度 / 上下文，纵向对齐当前模型行 */}
          <div ref={flyoutRef} className="relative ml-2 w-56 shrink-0">
            <div className="absolute inset-x-0 rounded-xl bg-white p-3 shadow-xl ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700" style={{ top: flyoutTop }}>
              {!flyoutModel ? (
                <div className="text-[11px] text-gray-400">选择一个模型后可调整推理强度与上下文</div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <div className={panelTitleClass}>{flyoutModel.displayName}</div>

                  {flyoutModel.reasoningMode === 'native' && (
                    <div>
                      <div className={groupTitleClass}>推理强度</div>
                      {effortGroup(flyoutModel, flyoutSelected)}
                    </div>
                  )}

                  {flyoutModel.reasoningMode === 'tag' && (
                    <div className="text-[10px] text-gray-400">该模型用「深度思考」开关控制推理</div>
                  )}

                  <div>
                    <div className={groupTitleClass}>上下文大小</div>
                    {contextGroup(flyoutModel, flyoutSelected)}
                    <p className="mt-1.5 text-[10px] leading-relaxed text-gray-400">只能向下选择；默认用模型支持的上限。</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {menu === 'effort' && current && (
        <div className={`${panelClass} w-64`}>
          <div className={panelTitleClass}>{current.displayName}</div>
          {current.reasoningMode === 'native' ? (
            <>
              <div className={groupTitleClass}>推理强度</div>
              {effortGroup(current, true)}
            </>
          ) : (
            <div className="text-[10px] text-gray-400">该模型用「深度思考」开关控制推理</div>
          )}
        </div>
      )}

      {menu === 'context' && current && (
        <div className={`${panelClass} w-64`}>
          <div className={panelTitleClass}>{current.displayName}</div>
          <div className={groupTitleClass}>上下文大小</div>
          {contextGroup(current, true)}
          <p className="mt-1.5 text-[10px] leading-relaxed text-gray-400">只能向下选择；默认用模型支持的上限。</p>
        </div>
      )}
    </div>
  )
}
