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
}

const MIN_ITEMS = 2
/** 相邻刻度中心的间距（px）：均匀紧凑排列，稀疏会话下也不会拉得很开 */
const MARK_STEP = 12

function previewText(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`_~[\]()!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 会话左侧的消息导轨（参考 Codex）：每条用户消息一个短刻度，贴着居中消息列的
 * 左缘均匀紧凑排列；点击跳到对应消息，滚动时高亮当前所在的那一轮。
 */
export default function ConversationRail({ items, scrollRef }: ConversationRailProps) {
  const { t } = useTranslation('chat')
  const [marks, setMarks] = useState<RailAnchor[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  /** 导轨水平位置（px）：贴住居中消息列的左缘，列窄于 max-w 时退到消息区左缘 */
  const [railLeft, setRailLeft] = useState(8)
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
      const positions = new Map<string, number>()
      container.querySelectorAll<HTMLElement>('[data-message-anchor]').forEach((el) => {
        const id = el.dataset.messageAnchor
        if (id) positions.set(id, el.getBoundingClientRect().top - origin)
      })
      const next: RailAnchor[] = []
      for (const item of items) {
        const top = positions.get(item.id)
        if (top === undefined) continue
        next.push({ id: item.id, content: item.content, top })
      }
      const prev = anchorsRef.current
      const unchanged = prev.length === next.length
        && next.every((mark, index) => mark.id === prev[index].id && Math.abs(mark.top - prev[index].top) < 0.5)
      if (!unchanged) {
        anchorsRef.current = next
        setMarks(next)
      }
      // 水平位置跟随居中消息列（滚动容器第一个子元素）的左缘，窗口缩放时同步
      const column = container.firstElementChild
      const containerLeft = container.getBoundingClientRect().left
      const columnLeft = column ? column.getBoundingClientRect().left : containerLeft
      const nextLeft = Math.max(2, columnLeft - containerLeft - 26)
      setRailLeft((prevLeft) => (Math.abs(prevLeft - nextLeft) < 0.5 ? prevLeft : nextLeft))
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

  const count = marks.length
  const lastIndex = Math.max(count - 1, 1)

  return (
    <nav
      className="pointer-events-none absolute top-1/2 z-10 w-4 max-h-[min(60vh,420px)] -translate-y-1/2 select-none opacity-70 transition-opacity hover:opacity-100"
      style={{ left: railLeft, height: Math.max(count, 1) * MARK_STEP }}
      aria-label={t('messageArea.railLabel')}
    >
      {marks.map((mark, index) => {
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
            className="group pointer-events-auto absolute left-1/2 flex h-3 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            style={{ top: `${count <= 1 ? 50 : (index / lastIndex) * 100}%` }}
          >
            <span
              className={`rounded-full transition-all duration-200 ${
                active
                  ? 'h-[3px] w-4 bg-gray-700 dark:bg-gray-200'
                  : 'h-[2px] w-2.5 bg-gray-300 group-hover:w-4 group-hover:bg-gray-400 dark:bg-gray-600 dark:group-hover:bg-gray-500'
              }`}
            />
            {hoveredId === mark.id && (
              <div className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 w-64 -translate-y-1/2 rounded-xl border border-gray-200/80 bg-white/95 p-2.5 shadow-xl backdrop-blur dark:border-gray-700/80 dark:bg-gray-900/95">
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
