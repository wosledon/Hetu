import { getCurrentWindow } from '@tauri-apps/api/window'
import { useMemo } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function WindowControls({ maximized, onMaximize }: { maximized: boolean; onMaximize: () => void }) {
  const { t } = useTranslation('nav')
  const currentWindow = useMemo(() => getCurrentWindow(), [])

  const minimize = () => { void currentWindow.minimize().catch((error: unknown) => console.error('Failed to minimize window', error)) }
  const close = () => { void currentWindow.close().catch((error: unknown) => console.error('Failed to close window', error)) }
  const buttonClass = 'flex h-9 w-8 items-center justify-center text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.07] dark:hover:text-gray-100'

  return (
    <div className="flex h-9 shrink-0 items-center">
      <button type="button" aria-label={t('minimize')} title={t('minimize')} className={buttonClass} onClick={minimize}>
        <Minus size={14} />
      </button>
      <button type="button" aria-label={maximized ? t('restore') : t('maximize')} title={maximized ? t('restore') : t('maximize')} className={buttonClass} onClick={onMaximize}>
        {maximized ? <Copy size={12} /> : <Square size={12} />}
      </button>
      <button type="button" aria-label={t('closeWindow')} title={t('closeWindow')} className={`${buttonClass} hover:bg-red-600 hover:text-white dark:hover:bg-red-600`} onClick={close}>
        <X size={14} />
      </button>
    </div>
  )
}
