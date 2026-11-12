import {
  Children,
  cloneElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../utils/cn'
import { useUIStore, type TooltipSidePref, type TooltipStyle } from '../../stores/uiStore'

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

export type { TooltipSidePref, TooltipStyle }

/** 气泡共用的定位与排版，具体外观按设置里的样式切换 */
const BUBBLE_BASE =
  'pointer-events-none fixed z-[100000] w-max max-w-[280px] break-words font-normal transition-opacity duration-100'

/** 三种气泡样式：卡片（毛玻璃）、实底、描边 */
const BUBBLE_STYLES: Record<TooltipStyle, string> = {
  card: 'rounded-lg border border-gray-200/80 bg-white px-2.5 py-1.5 text-[12px] leading-snug text-gray-700 shadow-lg glass glass-float dark:border-white/[0.08] dark:bg-gray-800 dark:text-gray-100',
  solid: 'rounded-md bg-gray-900 px-2 py-1 text-[11.5px] leading-snug text-white shadow-md dark:bg-gray-100 dark:text-gray-900',
  outline: 'rounded-md border border-gray-300/80 bg-white/70 px-2.5 py-1 text-[12px] leading-snug text-gray-600 shadow-sm backdrop-blur-sm dark:border-white/15 dark:bg-gray-900/70 dark:text-gray-200',
}

const GAP = 8
const EDGE = 8
/** 悬停多久后出现：略快于原生 title，又不会鼠标掠过时闪一片 */
const SHOW_DELAY = 400
/** 左侧窄导轨的判定：图标栏里的元素默认朝右弹，避免遮住上下相邻项 */
const RAIL_MAX_LEFT = 96

const clamp = (value: number, max: number) => Math.min(Math.max(value, EDGE), Math.max(EDGE, max))

/** 把「自动」解析成具体方向：贴左导轨向右，其余向上 */
const resolveSide = (anchor: DOMRect, pref: TooltipSidePref): TooltipSide =>
  pref === 'auto' ? (anchor.left < RAIL_MAX_LEFT ? 'right' : 'top') : pref

interface TooltipBubbleProps {
  content: ReactNode
  /** 触发元素在视口中的位置（fixed 定位，滚动/展开动画后需重新取） */
  anchor: DOMRect
  side: TooltipSide
}

/** 量出自身尺寸后再定位：贴边时自动翻转方向并夹在视口内 */
function TooltipBubble({ content, anchor, side }: TooltipBubbleProps) {
  const ref = useRef<HTMLDivElement>(null)
  const bubbleStyle = useUIStore((state) => state.tooltipStyle)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let placement = side
    if (placement === 'top' && anchor.top - GAP - height < EDGE) placement = 'bottom'
    else if (placement === 'bottom' && anchor.bottom + GAP + height > vh - EDGE) placement = 'top'
    else if (placement === 'left' && anchor.left - GAP - width < EDGE) placement = 'right'
    else if (placement === 'right' && anchor.right + GAP + width > vw - EDGE) placement = 'left'

    const centered = anchor.left + anchor.width / 2 - width / 2
    const left = placement === 'left' || placement === 'right'
      ? (placement === 'left' ? anchor.left - GAP - width : anchor.right + GAP)
      : centered
    const top = placement === 'top' || placement === 'bottom'
      ? (placement === 'top' ? anchor.top - GAP - height : anchor.bottom + GAP)
      : anchor.top + anchor.height / 2 - height / 2
    setPos({ left: clamp(left, vw - width - EDGE), top: clamp(top, vh - height - EDGE) })
  }, [content, anchor, side])

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, opacity: pos ? 1 : 0 }}
      className={cn(BUBBLE_BASE, BUBBLE_STYLES[bubbleStyle])}
    >
      {content}
    </div>,
    document.body,
  )
}

type ElementHandlers = {
  title?: string
  'data-tooltip-owner'?: string
  onPointerEnter?: (event: React.PointerEvent<HTMLElement>) => void
  onPointerLeave?: (event: React.PointerEvent<HTMLElement>) => void
  onFocus?: (event: React.FocusEvent<HTMLElement>) => void
  onBlur?: (event: React.FocusEvent<HTMLElement>) => void
}

export interface TooltipProps {
  content: ReactNode
  /** 触发元素：克隆后接管 title 与悬停/聚焦事件 */
  children: ReactElement
  /** 弹出方向，默认跟随设置（auto 时贴左导轨向右、其余向上） */
  side?: TooltipSidePref
  delay?: number
  disabled?: boolean
}

/**
 * 显式提示：把任意元素包成自定义气泡（替代原生 title）。
 * 大部分站点内的 title 由 `<TooltipProvider />` 统一接管，这里用于需要富内容/指定方向的场景。
 */
export function Tooltip({ content, children, side = 'auto', delay = SHOW_DELAY, disabled }: TooltipProps) {
  const [target, setTarget] = useState<{ el: HTMLElement; wait: number } | null>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)

  // 延迟用 effect 里的定时器表达：ref 只在事件里读会触发「渲染期访问 ref」检查
  useEffect(() => {
    if (!target) return
    const id = window.setTimeout(() => {
      if (target.el.isConnected) setAnchor(target.el.getBoundingClientRect())
    }, target.wait)
    return () => window.clearTimeout(id)
  }, [target])

  const child = Children.only(children) as ReactElement<ElementHandlers>
  const handlers = child.props

  const hide = () => {
    setTarget(null)
    setAnchor(null)
  }

  return (
    <>
      {cloneElement(child, {
        title: undefined,
        // 标记后全局 provider 不再插手，避免同一次悬停弹两个气泡
        'data-tooltip-owner': '',
        onPointerEnter: (event) => { handlers.onPointerEnter?.(event); setTarget({ el: event.currentTarget, wait: delay }) },
        onPointerLeave: (event) => { handlers.onPointerLeave?.(event); hide() },
        onFocus: (event) => { handlers.onFocus?.(event); setTarget({ el: event.currentTarget, wait: 0 }) },
        onBlur: (event) => { handlers.onBlur?.(event); hide() },
      })}
      {!disabled && content && anchor && (
        <TooltipBubble content={content} anchor={anchor} side={resolveSide(anchor, side)} />
      )}
    </>
  )
}

/**
 * 全局接管原生 `title`：鼠标移入时把 title 转存为 data-tooltip 并摘掉属性，
 * 浏览器就不再弹灰底原生提示，改由自绘气泡显示。
 * 只在真 DOM 层操作，因此无需改动任何调用点（组件上的 title prop 不受影响）。
 */
export function TooltipProvider() {
  const [tip, setTip] = useState<{ content: string; anchor: DOMRect; side: TooltipSide } | null>(null)

  useEffect(() => {
    let timer: number | null = null
    let active: HTMLElement | null = null

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
    }
    const hide = () => {
      clearTimer()
      active = null
      setTip(null)
    }

    /** 摘掉原生 title 并转存到 data-tooltip；title 也是无障碍名称的兜底来源，需补 aria-label */
    const upgrade = (el: HTMLElement) => {
      const title = el.getAttribute('title')
      const text = (title ?? el.getAttribute('data-tooltip') ?? '').trim()
      if (title !== null) {
        if (text) el.setAttribute('data-tooltip', text)
        el.removeAttribute('title')
        if (text && !(el.textContent ?? '').trim() && !el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) {
          el.setAttribute('aria-label', text)
        }
      }
      return text
    }

    const show = (el: HTMLElement, delay: number) => {
      if (active === el) return
      clearTimer()
      active = null
      const content = upgrade(el)
      if (!content) {
        setTip(null)
        return
      }
      active = el
      // 换目标时先收起上一个，避免从旧气泡滑到新位置
      setTip(null)
      timer = window.setTimeout(() => {
        if (!el.isConnected) return
        const anchor = el.getBoundingClientRect()
        // 方向偏好每次悬停时现读：设置里切换后无需重新挂载监听器
        setTip({ content, anchor, side: resolveSide(anchor, useUIStore.getState().tooltipSide) })
      }, delay)
    }

    const resolve = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null
      // 显式 <Tooltip> 内的元素自己管气泡，不再走全局升级
      const el = target.closest<HTMLElement>('[title], [data-tooltip]')
      return el && !el.closest('[data-tooltip-owner]') ? el : null
    }

    const onPointerOver = (event: PointerEvent) => {
      const next = resolve(event.target)
      if (!next) {
        if (active) hide()
        return
      }
      if (next === active) return
      const delay = Number(next.dataset.tooltipDelay ?? SHOW_DELAY)
      show(next, Number.isFinite(delay) ? Math.max(0, delay) : SHOW_DELAY)
    }

    const onPointerOut = (event: PointerEvent) => {
      if (!active) return
      // 在同一元素内部（移到子节点）不收起
      if (event.relatedTarget instanceof Node && active.contains(event.relatedTarget)) return
      hide()
    }

    const onFocusIn = (event: FocusEvent) => {
      const el = resolve(event.target)
      if (el) show(el, 0)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }

    document.addEventListener('pointerover', onPointerOver, true)
    document.addEventListener('pointerout', onPointerOut, true)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('pointerover', onPointerOver, true)
      document.removeEventListener('pointerout', onPointerOut, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('blur', hide)
      clearTimer()
    }
  }, [])

  return tip ? <TooltipBubble content={tip.content} anchor={tip.anchor} side={tip.side} /> : null
}
