import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** 弹性缓动：切换时轻微过冲（用户明确要求弹性切换） */
const EASE = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
const DURATION = 400

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
 * AppLayout 随路由整体重挂载，滑块靠这份缓存从旧位置动画到新位置，
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
  const pillRef = useRef<HTMLSpanElement>(null)
  const [rect, setRect] = useState<PillRect | null>(null)
  const rectRef = useRef<PillRect | null>(null)
  // 布局变化（选中项没变）时自增：换 key 重挂载滑块元素，新元素没有旧值，
  // 自然不会从量到的旧布局位置过渡过来（看起来乱飞）
  const [snapKey, setSnapKey] = useState(0)
  const initializedRef = useRef(false)
  const lastValueRef = useRef<string | null>(null)
  // 跨路由重挂载时的滑入动画：元素始终渲染在新位置，用 WAAPI 从旧位置演过来。
  // 不能用「先渲染旧位置、两帧后再设新位置」：那几帧里激活项已是新项而滑块
  // 还在旧项，菜单会明显闪一下。
  const slideInRef = useRef<{ from: PillRect; to: PillRect } | null>(null)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const items = Array.from(el.querySelectorAll<HTMLElement>('[data-pill-key]'))
    const active = items.find((it) => it.dataset.pillKey === value)
    const base = items[0]
    if (!active || !base || base.offsetWidth === 0) {
      setRect(null)
      rectRef.current = null
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
    const valueChanged = lastValueRef.current !== null && lastValueRef.current !== value
    lastValueRef.current = value
    const trackKey = trackId ?? items.map((it) => it.dataset.pillKey).join('|')
    if (!initializedRef.current) {
      initializedRef.current = true
      const prev = lastRects.get(trackKey)
      if (prev && !sameRect(prev, next)) {
        lastRects.set(trackKey, next)
        slideInRef.current = { from: prev, to: next }
        rectRef.current = next
        setRect(next)
        return
      }
    }
    lastRects.set(trackKey, next)
    const current = rectRef.current
    if (current && sameRect(current, next)) return
    if (valueChanged) {
      // 选中项切换：走 CSS 过渡，弹性滑动
      rectRef.current = next
      setRect(next)
      return
    }
    // 选中项没变而位置变了：是项自己挪了地方（导轨紧凑/展开切换、「最近访问」增删），
    // 直接吸附。若也走过渡，滑块会从量到的旧布局位置演过来，看起来乱飞；
    // 尚未播放的滑入动画目标也已失效，一并作废。
    slideInRef.current = null
    setSnapKey((k) => k + 1)
    rectRef.current = next
    setRect(next)
  }, [value, orientation, trackId])

  // 挂载即在首帧前测好位置（无闪现）；有滑入动画时等滑块元素渲染出来再播放
  useLayoutEffect(() => {
    measure()
    const el = pillRef.current
    const slide = slideInRef.current
    if (slide && el) {
      slideInRef.current = null
      el.animate(
        [
          { transform: `translate(${slide.from.x}px, ${slide.from.y}px)`, width: `${slide.from.w}px`, height: `${slide.from.h}px` },
          { transform: `translate(${slide.to.x}px, ${slide.to.y}px)`, width: `${slide.to.w}px`, height: `${slide.to.h}px` },
        ],
        { duration: DURATION, easing: EASE },
      )
    }
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    for (const item of el.querySelectorAll<HTMLElement>('[data-pill-key]')) observer.observe(item)
    return () => observer.disconnect()
  }, [measure])

  return (
    <div ref={ref} className={`relative ${className}`}>
      {rect && (
        <span
          key={snapKey}
          ref={pillRef}
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
