import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** 弹性缓动：切换时轻微过冲（用户明确要求弹性切换） */
const EASE = 'cubic-bezier(0.34, 1.56, 0.64, 1)'

interface SlidingPillProps {
  /** 当前激活项的 data-pill-key */
  value: string
  orientation?: 'horizontal' | 'vertical'
  /** 原容器样式（组件会自动补 relative） */
  className?: string
  /** 滑块完整外观（圆角/背景/阴影），整体覆盖默认白卡 */
  pillClassName?: string
  /**
   * 轨道稳定标识：跨路由/重挂载复用滑块位置缓存的 key。
   * 默认用各项 data-pill-key 拼接，但轨道内容会动态变化时（如导航栏的
   * 「最近访问」项、固定项随紧凑态增减）必须显式传入，否则缓存 key
   * 一变就找不到上一次的位置，滑块会直接蹦到新位置而没有滑动动画。
   */
  trackId?: string
  children: ReactNode
}

const DEFAULT_PILL_CLASS = 'rounded-full bg-white shadow-sm dark:bg-white/10'

interface PillRect {
  x: number
  y: number
  w: number
  h: number
}

const sameRect = (a: PillRect, b: PillRect) =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

/**
 * 各轨道上一次的滑块位置（模块级，跨挂载存活）。
 * AppLayout 随路由整体重挂载，滑块靠这份缓存先落在旧位置再过渡到新位置，
 * 否则切路由时滑块只是凭空出现在新位置，看不到滑动动画。
 */
const lastRects = new Map<string, PillRect>()

/**
 * 分段控件 / 导航菜单的滑块容器：白色凸起滑块跟随激活项弹性滑动。
 * 选项元素需带 `data-pill-key="<key>"` 且自身 `relative`（否则会被滑块盖住），
 * 激活态的背景色应交给滑块，按钮只保留文字变色。
 */
export default function SlidingPill({
  value,
  orientation = 'horizontal',
  className = '',
  pillClassName = '',
  trackId,
  children,
}: SlidingPillProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<PillRect | null>(null)
  const initializedRef = useRef(false)
  const pendingRef = useRef(false)

  const measure = useCallback(() => {
    if (pendingRef.current) return
    const el = ref.current
    if (!el) return
    const items = Array.from(el.querySelectorAll<HTMLElement>('[data-pill-key]'))
    const active = items.find((it) => it.dataset.pillKey === value)
    const base = items[0]
    if (!active || !base || base.offsetWidth === 0) {
      setRect(null)
      return
    }
    const next: PillRect = {
      x: active.offsetLeft,
      y: active.offsetTop,
      // 横向随激活项变宽（纵向保轨道高），纵向随激活项变高（横向保轨道宽）；
      // 用真实尺寸而非 scale()，否则圆角会被拉成椭圆
      w: orientation === 'horizontal' ? active.offsetWidth : base.offsetWidth,
      h: orientation === 'vertical' ? active.offsetHeight : base.offsetHeight,
    }
    const trackKey = trackId ?? items.map((it) => it.dataset.pillKey).join('|')
    if (!initializedRef.current) {
      initializedRef.current = true
      const prev = lastRects.get(trackKey)
      if (prev && !sameRect(prev, next)) {
        // 首帧先落在上一次激活项的位置，渲染两帧后再切到当前位置以触发过渡
        pendingRef.current = true
        setRect(prev)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            pendingRef.current = false
            lastRects.set(trackKey, next)
            setRect(next)
          })
        })
        return
      }
    }
    lastRects.set(trackKey, next)
    setRect((prevRect) => (prevRect && sameRect(prevRect, next) ? prevRect : next))
  }, [value, orientation, trackId])

  // 挂载即在首帧前测好位置（无闪现），尺寸变化由 ResizeObserver 跟随
  useLayoutEffect(() => {
    measure()
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    for (const item of el.querySelectorAll<HTMLElement>('[data-pill-key]')) observer.observe(item)
    // 不在这里取消首帧动画的 rAF：StrictMode 会先跑一次 setup→cleanup 再 setup，
    // 取消会把过渡链掐死导致滑块停在旧位置；rAF 回调晚到的 setState 对已卸载组件是空操作
    return () => observer.disconnect()
  }, [measure])

  return (
    <div ref={ref} className={`relative ${className}`}>
      {rect && (
        <span
          aria-hidden
          className={`pointer-events-none absolute left-0 top-0 ${pillClassName || DEFAULT_PILL_CLASS}`}
          style={{
            width: rect.w,
            height: rect.h,
            transform: `translate(${rect.x}px, ${rect.y}px)`,
            // width/height 只作用于这个绝对定位元素本身，与位移同缓动保持同步
            transition: `transform 0.4s ${EASE}, width 0.4s ${EASE}, height 0.4s ${EASE}`,
          }}
        />
      )}
      {children}
    </div>
  )
}
