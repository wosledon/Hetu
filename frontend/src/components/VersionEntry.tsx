import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import { useAppVersion } from '../hooks/useAppVersion'
import { useUpdateStore } from '../stores/updateStore'

/**
 * 版本号入口（排在设置上方 / 左侧）：有可用更新时带红色角标，点击弹出更新面板。
 */
export default function VersionEntry({ variant }: { variant: 'top' | 'rail' | 'railList' | 'railIcon' }) {
  const { t } = useTranslation()
  const version = useAppVersion()
  const status = useUpdateStore((s) => s.status)
  const openPanel = useUpdateStore((s) => s.openPanel)
  const hasUpdate = status === 'available' || status === 'downloading' || status === 'installed'
  const label = version ? `v${version}` : '…'
  const title = hasUpdate ? t('settings:update.badge') : t('settings:update.viewVersion')

  if (variant !== 'top') {
    const list = variant === 'railList'
    const iconOnly = variant === 'railIcon'
    return (
      <button
        onClick={openPanel}
        title={iconOnly ? `${label} · ${title}` : title}
        data-rail-item=""
        className={
          list
            ? 'flex w-full shrink-0 items-center justify-center gap-2.5 rounded-lg px-3 py-2 text-[12px] font-medium tabular-nums text-gray-400 transition-all hover:bg-gray-100/80 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-white/[0.06] dark:hover:text-gray-300'
            : iconOnly
              ? 'flex h-10 w-12 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-gray-100/80 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-white/[0.06] dark:hover:text-gray-300'
              : 'flex w-12 shrink-0 flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium text-gray-400 transition-all hover:bg-gray-100/80 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-white/[0.06] dark:hover:text-gray-300'
        }
      >
        {iconOnly ? (
          <span className="relative flex items-center">
            <Info size={18} />
            {hasUpdate && <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-red-500" />}
          </span>
        ) : (
          <span className="flex items-center gap-1 tabular-nums">
            {label}
            {hasUpdate && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />}
          </span>
        )}
      </button>
    )
  }

  return (
    <button
      onClick={openPanel}
      title={title}
      className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium tabular-nums text-gray-400 transition-all hover:bg-gray-100/60 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
    >
      {label}
      {hasUpdate && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />}
    </button>
  )
}
