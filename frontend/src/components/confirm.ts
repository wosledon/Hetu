import { createContext, useContext } from 'react'

export interface ConfirmOptions {
  title?: string
  message: string
  onConfirm: () => void
  onCancel?: () => void
}

type Confirm = (options: ConfirmOptions) => void

let globalConfirm: Confirm | null = null

/// 由 ConfirmProvider 注册弹窗能力，使非组件模块也能调用 confirm()。
export function registerGlobalConfirm(fn: Confirm | null): void {
  globalConfirm = fn
}

export function confirm(optionsOrMsg: ConfirmOptions | string): boolean {
  if (typeof optionsOrMsg === 'string') {
    globalConfirm?.({ message: optionsOrMsg, onConfirm: () => {} })
    return false // 旧代码 if(confirm('msg')) 编译通过，但需迁移到回调模式
  }
  globalConfirm?.(optionsOrMsg)
  return false
}

export const ConfirmContext = createContext<Confirm | null>(null)

export function useConfirm(): Confirm {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx
}
