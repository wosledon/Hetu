import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw, RotateCw, X } from 'lucide-react'
import ThemedMarkdown from './ThemedMarkdown'
import { useUpdateStore } from '../stores/updateStore'
import { updateService } from '../services/updateService'
import { useAppVersion } from '../hooks/useAppVersion'
import { useReleaseNotes } from '../hooks/useReleaseNotes'
import { openRepo } from '../utils/repo'
import { isTauriAclError } from '../utils/tauri'

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 发布说明里的 GitHub 长链接压成短标签（PR 链接 → #91，compare 链接 → v0.3.0...v0.3.1），
 * 链接本身保留，点开仍然跳 GitHub。
 */
function compactLinks(markdown: string): string {
  return markdown
    .replace(
      /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g,
      (_m, repo: string, num: string) => `[#${num}](https://github.com/${repo}/pull/${num})`,
    )
    .replace(
      /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/compare\/([^\s)]+)/g,
      (_m, repo: string, range: string) => `[${range}](https://github.com/${repo}/compare/${range})`,
    )
    .replace(
      /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/g,
      (_m, repo: string, num: string) => `[#${num}](https://github.com/${repo}/issues/${num})`,
    )
}

/** 发布说明是 Markdown：正常渲染（链接压缩成短标签）；链接一律用系统浏览器打开，避免 WebView 跳走 */
function NotesBlock({ markdown }: { markdown: string }) {
  return (
    <div
      className="text-[13px] leading-relaxed text-gray-600 dark:text-gray-300"
      onClick={(e) => {
        const anchor = (e.target as HTMLElement).closest('a')
        const href = anchor?.getAttribute('href')
        if (!href) return
        e.preventDefault()
        window.open(href, '_blank', 'noopener')
      }}
    >
      <ThemedMarkdown source={compactLinks(markdown)} />
    </div>
  )
}

/**
 * 更新面板：点版本号打开，展示更新说明并可主动更新。
 * 仅桌面壳可用（浏览器里打开时提示不可用）。
 */
export default function UpdatePanel() {
  const { t } = useTranslation('settings')
  const { panelOpen, closePanel, status, info, downloaded, total, error, check, install, restart } = useUpdateStore()
  const supported = updateService.supported()
  const percent = total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null
  const errorText = isTauriAclError(error) ? t('update.notAvailable') : (error ?? '')
  const version = useAppVersion()
  // 没有可用更新时，展示「本版本更新内容」（按版本号从 GitHub Release 取，带缓存）
  // 注意：hook 必须在任何 early return 之前调用，面板关闭时传 null 让它什么都不做
  const showCurrentNotes = status !== 'available' && status !== 'downloading' && status !== 'installed'
  const { notes: currentNotes, loading: notesLoading } = useReleaseNotes(showCurrentNotes && panelOpen ? version : null)

  useEffect(() => {
    if (!panelOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePanel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen, closePanel])

  if (!panelOpen) return null

  const currentVersion = info?.currentVersion ?? version

  return createPortal(
    <>
      <div className="fixed inset-0 z-[99998] bg-black/40 backdrop-blur-sm" onClick={closePanel} />
      <div className="fixed left-1/2 top-1/2 z-[99999] flex max-h-[88vh] w-[min(94vw,46rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
            {status === 'available' ? <Download size={18} /> : status === 'installed' ? <CheckCircle2 size={18} /> : <RefreshCw size={18} />}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('update.title')}</h3>
            <p className="mt-0.5 text-[12px] text-gray-500 dark:text-gray-400">
              {currentVersion ? t('update.current', { version: `v${currentVersion}` }) : t('update.checking')}
            </p>
          </div>
          <button onClick={closePanel} className="shrink-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]">
            <X size={16} />
          </button>
        </div>

        {!supported && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
            {t('update.desktopOnly')}
          </p>
        )}

        {supported && (
          <>
            <div className="min-h-0 flex-1 overflow-auto pr-1">
            <div className="rounded-xl border border-gray-100 px-4 py-3 dark:border-white/[0.06]">
              <p className="text-[13px] font-medium text-gray-700 dark:text-gray-200">
                {status === 'available' && info
                  ? t('update.found', { version: `v${info.version}` })
                  : status === 'downloading'
                    ? t('update.downloading', { percent: percent ?? '…' })
                    : status === 'installed'
                      ? t('update.installed', { version: `v${info?.version ?? ''}` })
                      : status === 'checking'
                        ? t('update.checking')
                        : status === 'up-to-date'
                          ? t('update.upToDate')
                          : status === 'error'
                            ? t('update.failedWith', { error: errorText })
                            : t('update.hint')}
              </p>

              {status === 'downloading' && (
                <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
                  <div className="h-full rounded-full bg-blue-500 transition-[width] duration-300" style={{ width: `${percent ?? 8}%` }} />
                </div>
              )}
              {status === 'downloading' && total ? (
                <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">{formatSize(downloaded)} / {formatSize(total)}</p>
              ) : null}
              {status === 'error' && error && !isTauriAclError(error) && (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-300">
                  <AlertCircle size={12} className="mt-0.5 shrink-0" />
                  <span className="break-all">{errorText}</span>
                </p>
              )}
            </div>

            {status === 'available' && info?.notes && (
              <div className="mt-4">
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-gray-400">{t('update.releaseNotes')}</p>
                <NotesBlock markdown={info.notes} />
              </div>
            )}

            {showCurrentNotes && (
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{t('update.currentNotes')}</p>
                  <button
                    onClick={openRepo}
                    className="shrink-0 text-[11px] text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200"
                  >
                    {t('update.viewOnGitHub')}
                  </button>
                </div>
                {notesLoading ? (
                  <p className="text-[12px] text-gray-400 dark:text-gray-500">{t('common:loading')}</p>
                ) : currentNotes ? (
                  <NotesBlock markdown={currentNotes.body} />
                ) : (
                  <p className="text-[12px] text-gray-400 dark:text-gray-500">{t('update.currentNotesEmpty')}</p>
                )}
              </div>
            )}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              {(status === 'idle' || status === 'up-to-date' || status === 'error') && (
                <button
                  onClick={() => void check()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3.5 py-1.5 text-[12px] font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/[0.04]"
                >
                  <RefreshCw size={12} />
                  {t('update.check')}
                </button>
              )}
              {status === 'available' && (
                <button
                  onClick={() => void install()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-blue-700"
                >
                  <Download size={12} />
                  {t('update.installNow')}
                </button>
              )}
              {status === 'downloading' && (
                <span className="inline-flex items-center gap-1.5 text-[12px] text-gray-500 dark:text-gray-400">
                  <Loader2 size={12} className="animate-spin" />
                  {t('update.downloading', { percent: percent ?? '…' })}
                </span>
              )}
              {status === 'installed' && (
                <button
                  onClick={() => void restart()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-blue-700"
                >
                  <RotateCw size={12} />
                  {t('update.restart')}
                </button>
              )}
            </div>

            <p className="mt-3 text-[11px] text-gray-400 dark:text-gray-500">{t('update.sourceHint')}</p>
          </>
        )}
      </div>
    </>,
    document.body,
  )
}

