import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'

export interface ConversationRailItem {
  id: string
  content: string
}

interface ConversationRailProps {
  /** 当前 DOM 中可跳转的用户消息（少于 2 条时不显示导轨） */
  items: ConversationRailItem[]
  /** 消息列表的滚动容器 */
  scrollRef: RefObject<HTMLDivElement | null>
}

interface RailAnchor {
  id: string
  content: string
  top: number
  percent: number
}

const MIN_ITEMS = 2

function previewText(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`_~[\]()!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 会话右侧的消息导轨（参考 Codex）：每条用户消息一个圆点，按其在内容中的实际
 * 滚动位置定位，点击跳到对应消息，滚动时高亮当前所在的那一轮。
 */
export default function ConversationRail({ items, scrollRef }: ConversationRailProps) {
  const { t } = useTranslation('chat')
  const [marks, setMarks] = useState<RailAnchor[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const anchorsRef = useRef<RailAnchor[]>([])
  const frameRef = useRef(0)

  const updateActive = useCallback(() => {
    const container = scrollRef.current
    if (!container) return
    const probe = container.scrollTop + Math.min(container.clientHeight * 0.3, 160)
    let current: string | null = null
    for (const anchor of anchorsRef.current) {
      if (anchor.top <= probe) current = anchor.id
    }
    setActiveId((prev) => (prev === current ? prev : current))
  }, [scrollRef])

  const measure = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      const container = scrollRef.current
      if (!container) return
      const origin = container.getBoundingClientRect().top - container.scrollTop
      const maxScroll = Math.max(container.scrollHeight - container.clientHeight, 1)
      const positions = new Map<string, number>()
      container.querySelectorAll<HTMLElement>('[data-message-anchor]').forEach((el) => {
        const id = el.dataset.messageAnchor
        if (id) positions.set(id, el.getBoundingClientRect().top - origin)
      })
      const next: RailAnchor[] = []
      for (const item of items) {
        const top = positions.get(item.id)
        if (top === undefined) continue
        next.push({ id: item.id, content: item.content, top, percent: Math.min(98, Math.max(2, (top / maxScroll) * 100)) })
      }
      const prev = anchorsRef.current
      const unchanged = prev.length === next.length
        && next.every((mark, index) => mark.id === prev[index].id && Math.abs(mark.top - prev[index].top) < 0.5)
      if (!unchanged) {
        anchorsRef.current = next
        setMarks(next)
      }
      updateActive()
    })
  }, [items, scrollRef, updateActive])

  useLayoutEffect(() => {
    measure()
  }, [measure])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(updateActive)
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    const observer = new ResizeObserver(() => measure())
    observer.observe(container)
    if (container.firstElementChild instanceof HTMLElement) observer.observe(container.firstElementChild)
    return () => {
      container.removeEventListener('scroll', onScroll)
      observer.disconnect()
      cancelAnimationFrame(frame)
      cancelAnimationFrame(frameRef.current)
    }
  }, [measure, scrollRef, updateActive])

  if (items.length < MIN_ITEMS) return null

  return (
    <nav
      className="pointer-events-none absolute right-4 top-1/2 z-10 h-[min(60vh,420px)] w-4 -translate-y-1/2 select-none opacity-70 transition-opacity hover:opacity-100"
      aria-label={t('messageArea.railLabel')}
    >
      {marks.map((mark) => {
        const active = mark.id === activeId
        const snippet = previewText(mark.content)
        const jumpLabel = snippet
          ? `${t('messageArea.railJumpTo')}: ${snippet.slice(0, 24)}`
          : t('messageArea.railJumpTo')
        return (
          <button
            key={mark.id}
            type="button"
            aria-label={jumpLabel}
            aria-current={active ? 'true' : undefined}
            onClick={() => {
              const anchor = scrollRef.current?.querySelector<HTMLElement>(`[data-message-anchor="${mark.id}"]`)
              const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
              anchor?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
            }}
            onMouseEnter={() => setHoveredId(mark.id)}
            onMouseLeave={() => setHoveredId((prev) => (prev === mark.id ? null : prev))}
            className="group pointer-events-auto absolute left-1/2 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            style={{ top: `${mark.percent}%` }}
          >
            <span
              className={`rounded-full transition-all duration-200 ${
                active
                  ? 'h-[3px] w-4 bg-gray-700 dark:bg-gray-200'
                  : 'h-[2px] w-2.5 bg-gray-300 group-hover:w-4 group-hover:bg-gray-400 dark:bg-gray-600 dark:group-hover:bg-gray-500'
              }`}
            />
            {hoveredId === mark.id && (
              <div className="pointer-events-none absolute right-full top-1/2 z-30 mr-2 w-64 -translate-y-1/2 rounded-xl border border-gray-200/80 bg-white/95 p-2.5 shadow-xl backdrop-blur dark:border-gray-700/80 dark:bg-gray-900/95">
                <div className="mb-0.5 text-[10px] font-medium text-blue-500 dark:text-blue-400">
                  {t('messageArea.railYou')}
                </div>
                <p className="line-clamp-3 text-[11px] leading-4 text-gray-600 dark:text-gray-300">
                  {snippet || '…'}
                </p>
              </div>
            )}
          </button>
        )
      })}
    </nav>
  )
}
