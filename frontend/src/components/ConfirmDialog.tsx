import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, X } from 'lucide-react'
import { ConfirmContext, registerGlobalConfirm, type ConfirmOptions } from './confirm'
import { Button, Modal } from './ui'

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [state, setState] = useState<ConfirmOptions | null>(null)

  useEffect(() => {
    registerGlobalConfirm(setState)
    return () => { registerGlobalConfirm(null) }
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
    <ConfirmContext.Provider value={setState}>
      {children}
      {state && (
        <Modal open onClose={handleCancel} size="sm" className="max-w-sm p-6">

            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/30">
                <AlertTriangle size={20} className="text-red-500" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{state.title || t('ui:confirmDialog.title')}</h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{state.message}</p>
              </div>
              <button onClick={handleCancel} className="shrink-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"><X size={16} /></button>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" tone="gray" className="shrink-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={handleCancel}>{t('common:cancel')}</Button>
              <Button variant="danger" className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700" onClick={handleConfirm}>{t('ui:confirmDialog.delete')}</Button>
            </div>
</Modal>
      )}
    </ConfirmContext.Provider>
  )
}
