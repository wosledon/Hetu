import { useTranslation } from 'react-i18next'
import { Download, Loader2, RefreshCw, RotateCw } from 'lucide-react'
import { useUpdateStore } from '../stores/updateStore'
import { updateService } from '../services/updateService'

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 顶部更新横幅：只在桌面壳内、且检测到新版本（或正在下载/待重启）时出现。
 * 完整信息与手动检测在「设置 → 关于」。
 */
export default function UpdateBanner() {
  const { t } = useTranslation('settings')
  const { status, info, downloaded, total, error, dismissed, install, restart, dismiss } = useUpdateStore()

  if (!updateService.supported() || dismissed) return null
  if (status !== 'available' && status !== 'downloading' && status !== 'installed' && status !== 'error') return null

  const percent = total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-blue-100 bg-blue-50/80 px-4 py-2 text-[13px] text-blue-900 dark:border-blue-500/20 dark:bg-blue-950/40 dark:text-blue-100">
      {status === 'downloading' ? <Loader2 size={14} className="shrink-0 animate-spin" /> : <Download size={14} className="shrink-0" />}

      <span className="font-medium">
        {status === 'installed'
          ? t('update.installed', { version: info?.version ?? '' })
          : status === 'available'
            ? t('update.available', { version: info?.version ?? '' })
            : status === 'downloading'
              ? t('update.downloading', { percent: percent ?? '…' })
              : t('update.failed')}
      </span>

      {status === 'downloading' && (
        <div className="h-1 w-40 overflow-hidden rounded-full bg-blue-200/70 dark:bg-blue-900/60">
          <div className="h-full rounded-full bg-blue-500 transition-[width] duration-300" style={{ width: `${percent ?? 8}%` }} />
        </div>
      )}
      {status === 'downloading' && total ? (
        <span className="text-[11px] text-blue-700/80 dark:text-blue-200/70">{formatSize(downloaded)} / {formatSize(total)}</span>
      ) : null}

      {status === 'error' && error ? (
        <span className="truncate text-[11px] text-red-600 dark:text-red-300" title={error}>{error}</span>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {status === 'available' && (
          <button
            onClick={() => void install()}
            className="rounded-lg bg-blue-600 px-3 py-1 text-[12px] font-medium text-white transition-colors hover:bg-blue-700"
          >
            {t('update.installNow')}
          </button>
        )}
        {status === 'installed' && (
          <button
            onClick={() => void restart()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1 text-[12px] font-medium text-white transition-colors hover:bg-blue-700"
          >
            <RotateCw size={12} />
            {t('update.restart')}
          </button>
        )}
        {(status === 'available' || status === 'downloading') && (
          <button
            onClick={() => void useUpdateStore.getState().check()}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-blue-800/80 transition-colors hover:bg-blue-100/70 dark:text-blue-100/80 dark:hover:bg-blue-900/40"
            title={t('update.check')}
          >
            <RefreshCw size={12} />
          </button>
        )}
        <button
          onClick={dismiss}
          className="rounded-lg px-2 py-1 text-[12px] text-blue-800/70 transition-colors hover:bg-blue-100/70 dark:text-blue-100/70 dark:hover:bg-blue-900/40"
        >
          {t('update.later')}
        </button>
      </div>
    </div>
  )
}
