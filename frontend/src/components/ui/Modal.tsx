import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../utils/cn'

export interface ModalProps {
  open: boolean
  onClose: () => void
  /** 面板最大宽度；none=不限制（面板自带宽度时用） */
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'none'
  /** 面板整体滚动（长表单用） */
  scroll?: boolean
  /** 点遮罩 / Escape 是否关闭；表单类弹窗传 false 防止误关 */
  dismissible?: boolean
  /** 无障碍名称 */
  label?: string
  className?: string
  children: ReactNode
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  '2xl': 'max-w-4xl',
  none: '',
} as const

/**
 * 通用弹窗：统一遮罩、圆角面板、亚克力材质、Escape / 点遮罩关闭。
 * 面板内容由调用方组织（标题栏 / 主体 / 底部操作区）。
 */
export default function Modal({ open, onClose, size = 'md', scroll = false, dismissible = true, label, className, children }: ModalProps) {
  useEffect(() => {
    if (!open || !dismissible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, dismissible, onClose])

  if (!open) return null

  // 必须 portal 到 body：调用方可能在 glass 卡片（isolation: isolate）里渲染本组件，
  // 那样 fixed 遮罩会被困在祖先栈上下文里，被后面渲染的兄弟面板（如 Code 会话区）盖住。
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          'w-full rounded-2xl bg-white shadow-2xl glass glass-float dark:bg-gray-800',
          SIZES[size],
          scroll && 'max-h-[85vh] overflow-y-auto',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
