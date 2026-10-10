import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppWindow, BookOpen, Code, GitBranch, Layers, MessageSquare, RefreshCw, ShieldCheck, Star } from 'lucide-react'
import { systemService } from '../services/systemService'
import { updateService } from '../services/updateService'
import { useUpdateStore } from '../stores/updateStore'
import { isTauri } from '../utils/tauri'

const ABOUT_FEATURES = [
  { icon: BookOpen, labelKey: 'about.features.notes.label', descKey: 'about.features.notes.desc' },
  { icon: MessageSquare, labelKey: 'about.features.chat.label', descKey: 'about.features.chat.desc' },
  { icon: Code, labelKey: 'about.features.code.label', descKey: 'about.features.code.desc' },
  { icon: GitBranch, labelKey: 'about.features.workflows.label', descKey: 'about.features.workflows.desc' },
  { icon: Layers, labelKey: 'about.features.skills.label', descKey: 'about.features.skills.desc' },
  { icon: AppWindow, labelKey: 'about.features.apps.label', descKey: 'about.features.apps.desc' },
]

const ABOUT_STACK = [
  { labelKey: 'about.stack.backend.label', valueKey: 'about.stack.backend.value' },
  { labelKey: 'about.stack.database.label', valueKey: 'about.stack.database.value' },
  { labelKey: 'about.stack.frontend.label', valueKey: 'about.stack.frontend.value' },
  { labelKey: 'about.stack.desktop.label', valueKey: 'about.stack.desktop.value' },
  { labelKey: 'about.stack.vector.label', valueKey: 'about.stack.vector.value' },
]

/** 设置页「关于」：产品定位、核心能力、技术栈与运行环境 */
export default function AboutSection({ appName }: { appName: string }) {
  const { t } = useTranslation('settings')
  const { status, info, downloaded, total, error, check, install, restart } = useUpdateStore()
  const [version, setVersion] = useState<string | null>(null)
  const percent = total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null
  const runtime = useMemo(() => ({
    apiBase: `${window.location.protocol}//${window.location.host}`,
    isDesktop: isTauri(),
  }), [])

  // 版本号启动时从后端读取（与桌面壳 tauri.conf.json 同源）
  useEffect(() => {
    let alive = true
    systemService.getVersion()
      .then((info) => { if (alive) setVersion(info?.version ?? null) })
      .catch(() => { /* 读取失败时仅不展示版本号 */ })
    return () => { alive = false }
  }, [])

  return (
    <section className="space-y-8">
      {/* 产品标识 */}
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-3xl border border-gray-100 bg-gray-50/80 shadow-sm dark:border-white/20 dark:bg-white">
          <img
            src="/brand.png"
            alt=""
            width={92}
            height={92}
            draggable={false}
            className="h-[92px] w-[92px] select-none object-contain"
          />
        </div>
        <div className="min-w-0">
          <h2 className="flex items-center gap-2.5 text-xl font-bold text-gray-900 dark:text-gray-100">
            {appName}
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
              {version ? `v${version}` : '…'}
            </span>
          </h2>
          <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
            {t('about.tagline')}
          </p>
        </div>
      </div>

      {/* 产品简介 */}
      <div className="space-y-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
        <p>
          {t('about.introA', { name: appName })}<strong className="font-medium text-gray-800 dark:text-gray-200">{t('about.introKnowledge')}</strong>{t('about.introAnd')}<strong className="font-medium text-gray-800 dark:text-gray-200">{t('about.introChat')}</strong>{t('about.introRest')}
        </p>
        <p>
          {t('about.codeIntro')}
        </p>
      </div>

      {/* 核心能力 */}
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">{t('about.featuresTitle')}</h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {ABOUT_FEATURES.map((f) => {
            const Icon = f.icon
            return (
              <div key={f.labelKey} className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-blue-500 shadow-sm dark:bg-white/[0.06] dark:text-blue-400">
                  <Icon size={15} />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-gray-800 dark:text-gray-200">{t(f.labelKey)}</div>
                  <div className="mt-0.5 text-[11px] leading-snug text-gray-400">{t(f.descKey)}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 技术栈 */}
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">{t('about.stackTitle')}</h3>
        <dl className="divide-y divide-gray-100 rounded-xl border border-gray-100 dark:divide-white/[0.06] dark:border-white/[0.06]">
          {ABOUT_STACK.map((row) => (
            <div key={row.labelKey} className="flex items-baseline gap-4 px-4 py-2.5">
              <dt className="w-20 shrink-0 text-[12px] font-medium text-gray-500 dark:text-gray-400">{t(row.labelKey)}</dt>
              <dd className="min-w-0 flex-1 text-[13px] text-gray-700 dark:text-gray-200">{t(row.valueKey)}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* 运行环境 */}
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">{t('about.runtimeTitle')}</h3>
        <dl className="divide-y divide-gray-100 rounded-xl border border-gray-100 dark:divide-white/[0.06] dark:border-white/[0.06]">
          <div className="flex items-baseline gap-4 px-4 py-2.5">
            <dt className="w-20 shrink-0 text-[12px] font-medium text-gray-500 dark:text-gray-400">{t('about.runtimeMode')}</dt>
            <dd className="text-[13px] text-gray-700 dark:text-gray-200">{runtime.isDesktop ? t('about.modeDesktop') : t('about.modeBrowser')}</dd>
          </div>
          <div className="flex items-baseline gap-4 px-4 py-2.5">
            <dt className="w-20 shrink-0 text-[12px] font-medium text-gray-500 dark:text-gray-400">{t('about.serviceAddress')}</dt>
            <dd className="min-w-0 flex-1 truncate font-mono text-[12px] text-gray-700 dark:text-gray-200">{runtime.apiBase}</dd>
          </div>
        </dl>
      </div>

      {/* 软件更新（桌面壳内可用） */}
      {updateService.supported() && (
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">{t('update.title')}</h3>
          <div className="rounded-xl border border-gray-100 p-4 dark:border-white/[0.06]">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-gray-700 dark:text-gray-200">
                  {t('update.current', { version: version ? `v${version}` : '…' })}
                </div>
                <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">
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
                              ? t('update.failedWith', { error: error ?? '' })
                              : t('update.hint')}
                </p>
              </div>

              {status === 'available' && (
                <button
                  onClick={() => void install()}
                  className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-blue-700"
                >
                  {t('update.installNow')}
                </button>
              )}
              {status === 'installed' && (
                <button
                  onClick={() => void restart()}
                  className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-blue-700"
                >
                  {t('update.restart')}
                </button>
              )}
              {(status === 'idle' || status === 'up-to-date' || status === 'error') && (
                <button
                  onClick={() => void check()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3.5 py-1.5 text-[12px] font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/[0.04]"
                >
                  <RefreshCw size={12} />
                  {t('update.check')}
                </button>
              )}
            </div>

            {status === 'downloading' && (
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
                <div className="h-full rounded-full bg-blue-500 transition-[width] duration-300" style={{ width: `${percent ?? 8}%` }} />
              </div>
            )}

            {status === 'available' && info?.notes && (
              <details className="mt-3">
                <summary className="cursor-pointer text-[12px] text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                  {t('update.releaseNotes')}
                </summary>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-600 dark:bg-white/[0.03] dark:text-gray-300">
                  {info.notes}
                </pre>
              </details>
            )}

            <p className="mt-3 text-[11px] text-gray-400 dark:text-gray-500">{t('update.sourceHint')}</p>
          </div>
        </div>
      )}

      {/* 隐私与开源 */}
      <div className="space-y-2.5 rounded-xl bg-blue-50/70 p-4 dark:bg-blue-950/20">
        <p className="flex items-start gap-2 text-[12px] leading-relaxed text-blue-800 dark:text-blue-200">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" />
          <span>
            {t('about.privacy')}
          </span>
        </p>
        <button
          onClick={() => window.open('https://github.com/wosledon/Hetu', '_blank', 'noopener')}
          className="flex items-center gap-1.5 text-[12px] font-medium text-blue-700 transition-colors hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
        >
          <Star size={13} />
          {t('about.viewSource')}
        </button>
      </div>
    </section>
  )
}
