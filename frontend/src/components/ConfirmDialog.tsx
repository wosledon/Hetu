import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { AlertTriangle, X } from 'lucide-react'

interface ConfirmOptions {
  title?: string
  message: string
  onConfirm: () => void
  onCancel?: () => void
}

let _globalConfirm: ((opts: ConfirmOptions) => void) | null = null

export function confirm(optionsOrMsg: ConfirmOptions | string): boolean {
  if (typeof optionsOrMsg === 'string') {
    _globalConfirm?.({ message: optionsOrMsg, onConfirm: () => {} })
    return false // 旧代码 if(confirm('msg')) 编译通过，但需迁移到回调模式
  }
  _globalConfirm?.(optionsOrMsg)
  return false
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => void
}

const ConfirmContext = createContext<ConfirmContextType | null>(null)

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx.confirm
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmOptions | null>(null)

  useEffect(() => {
    _globalConfirm = setState
    return () => { _globalConfirm = null }
  }, [])

  const handleCancel = () => {
    state?.onCancel?.()
    setState(null)
  }

  const handleConfirm = () => {
    state?.onConfirm()
    setState(null)
  }

  return (
    <ConfirmContext.Provider value={{ confirm: setState }}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={handleCancel}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-800" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/30">
                <AlertTriangle size={20} className="text-red-500" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{state.title || '确认操作'}</h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{state.message}</p>
              </div>
              <button onClick={handleCancel} className="shrink-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"><X size={16} /></button>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={handleCancel} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700">取消</button>
              <button onClick={handleConfirm} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">确认删除</button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
