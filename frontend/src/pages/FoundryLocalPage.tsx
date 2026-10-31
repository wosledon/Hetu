import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Boxes, Check, Cpu, Download, FolderOpen, HardDrive, Loader2, Play, RotateCcw,
  Search, Square, Trash2, TriangleAlert, X,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { Button, Card, PageContainer, SearchInput } from '../components/ui'
import { foundryLocalService, type FoundryLocalDownloadProgress, type FoundryLocalModel } from '../services/foundryLocalService'
import { confirm } from '../components/confirm'

/** 下载中的任务：alias -> 最新进度 */
type DownloadMap = Record<string, FoundryLocalDownloadProgress>

/** 体积格式化：模型动辄几 GB */
function formatSize(mb?: number): string {
  if (!mb || mb <= 0) return '—'
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
}

export default function FoundryLocalPage() {
  const { t } = useTranslation('foundry')
  const queryClient = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [cachedOnly, setCachedOnly] = useState(false)
  const [downloads, setDownloads] = useState<DownloadMap>({})
  const [dirDraft, setDirDraft] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const statusQuery = useQuery({
    queryKey: ['foundryLocal', 'status'],
    queryFn: foundryLocalService.getStatus,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  })
  const status = statusQuery.data

  const modelsQuery = useQuery({
    queryKey: ['foundryLocal', 'models', cachedOnly],
    queryFn: () => foundryLocalService.getModels(cachedOnly),
    enabled: status?.supported === true,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['foundryLocal'] })
  }

  const runAction = async (action: () => Promise<unknown>, successKey: string) => {
    setMessage(null)
    try {
      await action()
      setMessage(t(successKey))
      invalidate()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const downloadMutation = useMutation({
    mutationFn: async (alias: string) => {
      await foundryLocalService.download(alias, (progress) => {
        setDownloads((prev) => ({ ...prev, [alias]: progress }))
      })
    },
    onSuccess: (_data, alias) => {
      invalidate()
      // 进度条多留一秒，让用户看到 100% 再消失
      window.setTimeout(() => {
        setDownloads((prev) => {
          const next = { ...prev }
          delete next[alias]
          return next
        })
      }, 1200)
    },
    onError: (error: Error, alias) => {
      setMessage(error.message)
      setDownloads((prev) => {
        const next = { ...prev }
        delete next[alias]
        return next
      })
      invalidate()
    },
  })

  const registerMutation = useMutation({
    mutationFn: (model: FoundryLocalModel) =>
      foundryLocalService.register(model.alias, 'chat').then(() =>
        // 注册完顺手刷新大模型列表，设置页立刻能看到
        queryClient.invalidateQueries({ queryKey: ['aiModels'] }),
      ),
    onSuccess: () => {
      setMessage(t('registerDone'))
      invalidate()
    },
    onError: (error: Error) => setMessage(error.message),
  })

  const dirMutation = useMutation({
    mutationFn: (path: string | null) => foundryLocalService.setModelDir(path),
    onSuccess: (applied) => {
      setDirDraft(null)
      setMessage(t('modelDirApplied', { path: applied }))
      invalidate()
    },
    onError: (error: Error) => setMessage(error.message),
  })

  const models = useMemo(() => {
    const list = modelsQuery.data ?? []
    const kw = keyword.trim().toLowerCase()
    if (!kw) return list
    return list.filter((m) =>
      [m.alias, m.displayName, m.publisher, m.modelType].some((v) => v?.toLowerCase().includes(kw)),
    )
  }, [modelsQuery.data, keyword])

  const unsupported = status && !status.supported
  const modelDir = dirDraft ?? status?.pendingModelDir ?? status?.modelDir ?? ''

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <PageContainer>
          <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-sm shadow-cyan-500/20">
                <Boxes size={20} className="text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
              </div>
            </div>
          </div>

          {/* 平台不支持：整页置灰，但仍保留手动填 endpoint 的说明 */}
          {unsupported ? (
            <Card className="flex flex-col items-center gap-3 py-14 text-center">
              <TriangleAlert size={32} className="text-amber-500" />
              <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">{t('unsupportedTitle')}</h2>
              <p className="max-w-xl text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                {status?.unsupportedReason}
              </p>
            </Card>
          ) : (
            <div className="space-y-5">
              {/* 运行状态 */}
              <Card padded={false} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
                <StatusDot ok={status?.running === true} label={t('status.running')} offLabel={t('status.stopped')} />
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wider text-gray-400">{t('status.endpoint')}</div>
                  <div className="truncate text-[13px] font-medium text-gray-700 dark:text-gray-200">
                    {status?.endpoint ?? '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-gray-400">{t('status.loaded')}</div>
                  <div className="text-[13px] font-medium tabular-nums text-gray-700 dark:text-gray-200">
                    {status?.loadedCount ?? 0}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-gray-400">{t('status.cached')}</div>
                  <div className="text-[13px] font-medium tabular-nums text-gray-700 dark:text-gray-200">
                    {status?.cachedCount ?? 0}
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    disabled={status?.running === true}
                    onClick={() => void runAction(foundryLocalService.startService, 'serviceStarted')}
                  >
                    <Play size={13} /> {t('action.startService')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    disabled={status?.running !== true}
                    onClick={() => void runAction(foundryLocalService.stopService, 'serviceStopped')}
                  >
                    <Square size={13} /> {t('action.stopService')}
                  </Button>
                </div>
              </Card>

              {/* 模型保存路径 */}
              <Card padded={false} className="px-5 py-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[280px] flex-1">
                    <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-gray-400">
                      <HardDrive size={11} className="mr-1 inline" />
                      {t('modelDir.label')}
                    </label>
                    <input
                      value={modelDir}
                      onChange={(e) => setDirDraft(e.target.value)}
                      placeholder={status?.defaultModelDir}
                      spellCheck={false}
                      className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-[13px] outline-none transition-all focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200"
                    />
                    <p className="mt-1.5 text-[11px] text-gray-400">{t('modelDir.hint')}</p>
                    {status?.restartRequired && (
                      <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                        <RotateCcw size={11} />
                        {t('modelDir.restartHint')}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    disabled={dirMutation.isPending || dirDraft === null || dirDraft === (status?.pendingModelDir ?? status?.modelDir)}
                    onClick={() => dirMutation.mutate(dirDraft)}
                  >
                    {dirMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    {t('modelDir.save')}
                  </Button>
                  <Button
                    variant="ghost"
                    tone="gray"
                    size="sm"
                    className="gap-1.5"
                    disabled={dirMutation.isPending}
                    onClick={() => dirMutation.mutate(null)}
                    title={t('modelDir.reset')}
                  >
                    <RotateCcw size={13} /> {t('modelDir.reset')}
                  </Button>
                </div>
              </Card>

              {message && (
                <div className="flex items-start gap-2 rounded-xl border border-cyan-200/70 bg-cyan-50/60 px-4 py-2.5 text-[12px] text-cyan-800 dark:border-cyan-500/20 dark:bg-cyan-950/20 dark:text-cyan-200">
                  <span className="min-w-0 flex-1 break-words">{message}</span>
                  <button onClick={() => setMessage(null)} className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100">
                    <X size={12} />
                  </button>
                </div>
              )}

              {/* 模型目录 */}
              <Card padded={false}>
                <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-5 py-3 dark:border-white/[0.06]">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                    <Cpu size={15} className="text-cyan-500" />
                    {t('catalog.title')}
                  </h2>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => setCachedOnly((v) => !v)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        cachedOnly
                          ? 'border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-500/40 dark:bg-cyan-950/40 dark:text-cyan-200'
                          : 'border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-white/10 dark:text-gray-400'
                      }`}
                    >
                      {t('catalog.cachedOnly')}
                    </button>
                    <div className="w-52">
                      <SearchInput
                        tone="cyan"
                        size="sm"
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        placeholder={t('catalog.search')}
                      />
                    </div>
                  </div>
                </div>

                {modelsQuery.isLoading ? (
                  <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
                    <Loader2 size={16} className="animate-spin" /> {t('catalog.loading')}
                  </div>
                ) : models.length === 0 ? (
                  <div className="py-16 text-center text-sm text-gray-400">{t('catalog.empty')}</div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
                    {models.map((model) => {
                      const progress = downloads[model.alias]
                      const downloading = downloadMutation.isPending && downloadMutation.variables === model.alias
                      return (
                        <div key={model.alias} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                          <div className="min-w-[180px] flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-[13px] font-medium text-gray-800 dark:text-gray-100">
                                {model.displayName ?? model.alias}
                              </span>
                              {model.isCached && <Badge tone="emerald">{t('badge.cached')}</Badge>}
                              {model.isLoaded && <Badge tone="blue">{t('badge.loaded')}</Badge>}
                              {model.isRegistered && <Badge tone="violet">{t('badge.registered')}</Badge>}
                            </div>
                            <div className="mt-0.5 truncate text-[11px] text-gray-400">
                              {[model.publisher, model.modelType, model.task].filter(Boolean).join(' · ')}
                              {model.contextLength ? ` · ${Math.round(model.contextLength / 1024)}k ctx` : ''}
                              {` · ${formatSize(model.fileSizeMb)}`}
                            </div>
                          </div>

                          {downloading && progress && (
                            <div className="w-40">
                              <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06]">
                                <div
                                  className="h-full rounded-full bg-cyan-500 transition-all"
                                  style={{ width: `${Math.round((progress.progress ?? 0) * 100)}%` }}
                                />
                              </div>
                              <div className="mt-1 text-[10px] tabular-nums text-gray-400">
                                {Math.round((progress.progress ?? 0) * 100)}%
                              </div>
                            </div>
                          )}

                          <div className="flex shrink-0 items-center gap-1.5">
                            {!model.isCached && (
                              <Button
                                variant="secondary"
                                size="sm"
                                className="gap-1.5"
                                disabled={downloadMutation.isPending}
                                onClick={() => downloadMutation.mutate(model.alias)}
                              >
                                <Download size={13} /> {t('action.download')}
                              </Button>
                            )}
                            {model.isCached && !model.isLoaded && (
                              <Button
                                variant="secondary"
                                size="sm"
                                className="gap-1.5"
                                onClick={() => void runAction(() => foundryLocalService.load(model.alias), 'loaded')}
                              >
                                <Play size={13} /> {t('action.load')}
                              </Button>
                            )}
                            {model.isLoaded && (
                              <Button
                                variant="ghost"
                                tone="gray"
                                size="sm"
                                className="gap-1.5"
                                onClick={() => void runAction(() => foundryLocalService.unload(model.alias), 'unloaded')}
                              >
                                <Square size={13} /> {t('action.unload')}
                              </Button>
                            )}
                            {model.isCached && !model.isRegistered && (
                              <Button
                                variant="secondary"
                                size="sm"
                                className="gap-1.5"
                                disabled={registerMutation.isPending}
                                onClick={() => registerMutation.mutate(model)}
                                title={t('action.registerHint')}
                              >
                                <FolderOpen size={13} /> {t('action.register')}
                              </Button>
                            )}
                            {model.isCached && (
                              <button
                                onClick={() => {
                                  void confirm({
                                    title: t('action.remove'),
                                    message: t('action.removeConfirm', { name: model.displayName ?? model.alias }),
                                    onConfirm: () => void runAction(
                                      () => foundryLocalService.remove(model.alias),
                                      'removed',
                                    ),
                                  })
                                }}
                                title={t('action.remove')}
                                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Card>

              <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
                <Search size={11} />
                {t('catalog.footnote')}
              </p>
            </div>
          )}
        </PageContainer>
      }
    />
  )
}

function StatusDot({ ok, label, offLabel }: { ok: boolean; label: string; offLabel: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
      <span className="text-[13px] font-medium text-gray-700 dark:text-gray-200">{ok ? label : offLabel}</span>
    </div>
  )
}

const BADGE_TONES: Record<string, string> = {
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300',
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300',
}

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ${BADGE_TONES[tone] ?? BADGE_TONES.blue}`}>
      {children}
    </span>
  )
}
