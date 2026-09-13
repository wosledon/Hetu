import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

type DismissRef = RefObject<HTMLElement | null>

interface DismissOptions {
  /// 按 Esc 是否触发关闭，默认 true。
  escapeKey?: boolean
}

/// enabled 为 true 时监听指针按下与（可选）Esc：命中的 ref 之外或按下 Esc 时调用 onDismiss。
/// onDismiss 与 refs 通过 ref 转发，调用方无需 memo 化。
export function useDismissOnOutside(
  enabled: boolean,
  onDismiss: () => void,
  refs: DismissRef[],
  options?: DismissOptions,
) {
  const escapeKey = options?.escapeKey ?? true
  const latest = useRef({ onDismiss, refs })
  useEffect(() => {
    latest.current = { onDismiss, refs }
  })

  useEffect(() => {
    if (!enabled) return

    const handlePointerDown = (e: MouseEvent) => {
      const { onDismiss: dismiss, refs: targets } = latest.current
      if (targets.some((target) => target.current?.contains(e.target as Node))) return
      dismiss()
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') latest.current.onDismiss()
    }

    document.addEventListener('mousedown', handlePointerDown)
    if (escapeKey) document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [enabled, escapeKey])
}
