import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Minimize2 } from 'lucide-react'
import type { IWhiteboardScene } from '../../types/whiteboard'
import WhiteboardCanvas from './WhiteboardCanvas'
import { DEFAULT_STYLE, fitViewport } from '../../utils/whiteboard'
import { IconButton } from '../ui'

const NOOP = () => {}

interface WhiteboardPresentationProps {
  boardName: string
  /** 当前画板在列表中的位置（1 起） */
  boardIndex: number
  boardCount: number
  scene: IWhiteboardScene
  onExit: () => void
  onPrev: () => void
  onNext: () => void
}

/** 演示模式：全屏只读展示当前画板，可在多张画板间切换 */
export default function WhiteboardPresentation({
  boardName, boardIndex, boardCount, scene, onExit, onPrev, onNext,
}: WhiteboardPresentationProps) {
  const { t } = useTranslation('whiteboard')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 960, height: 600 })

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExit()
      if (event.key === 'ArrowLeft') onPrev()
      if (event.key === 'ArrowRight') onNext()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onExit, onPrev, onNext])

  const viewport = useMemo(
    () => fitViewport(scene.elements, size.width, size.height, 64),
    [scene.elements, size.width, size.height],
  )

  return (
    <div ref={containerRef} className="fixed inset-0 z-[90] bg-gray-950">
      <WhiteboardCanvas
        readOnly
        scene={{ elements: scene.elements, viewport }}
        tool="pan"
        style={DEFAULT_STYLE}
        snap={false}
        onSceneChange={NOOP}
      />
      <div className="pointer-events-none absolute right-5 top-4 text-xs text-white/40">
        Esc {t('exitPresent')} · ← → {t('switchBoard')}
      </div>
      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black/60 px-4 py-2 text-sm text-white shadow-lg backdrop-blur">
        <IconButton label={t('prevBoard')} size="sm" disabled={boardIndex <= 1} onClick={onPrev}>
          <ChevronLeft size={16} />
        </IconButton>
        <span className="max-w-[40vw] truncate font-medium">{boardName}</span>
        <span className="tabular-nums text-white/50">{boardIndex}/{boardCount}</span>
        <IconButton label={t('nextBoard')} size="sm" disabled={boardIndex >= boardCount} onClick={onNext}>
          <ChevronRight size={16} />
        </IconButton>
        <span className="h-4 w-px bg-white/20" />
        <IconButton label={t('exitPresent')} size="sm" onClick={onExit}>
          <Minimize2 size={16} />
        </IconButton>
      </div>
    </div>
  )
}
