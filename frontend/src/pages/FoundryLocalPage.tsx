import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Boxes, Check, Copy, Cpu, Download, FolderOpen, HardDrive, Loader2, Play, RotateCcw,
  Search, Square, Terminal, Trash2, TriangleAlert, X,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { Button, Card, Input, PageContainer, SearchInput } from '../components/ui'
import Select from '../components/Select'
import { confirm } from '../components/confirm'
import {
  foundryLocalService,
  type FoundryLocalDownloadProgress,
  type FoundryLocalModel,
} from '../services/foundryLocalService'

/** 下载中的任务：变体 Id -> 最新进度 */
type DownloadMap = Record<string, FoundryLocalDownloadProgress>

/** 安装命令：winget 是 Windows 上最省事的途径 */
const INSTALL_COMMAND = 'winget install Microsoft.FoundryLocal'

/** 体积格式化：模型动辄几 GB */
function formatSize(mb?: number): string {
  if (!mb || mb <= 0) return '—'
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
}

/** 字节数格式化：内存/磁盘 */
function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—'
  const gb = bytes / (1024 * 1024 * 1024)
  return gb >= 1 ? `${gb.toFixed(0)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`
}

/** 目录里的 task 是英文枚举值，转成界面文案；未知值原样显示 */
const TASK_LABELS: Record<string, [string, string]> = {
  Chat: ['catalog.taskChat', 'catalog.taskChatEn'],
  Multimodal: ['catalog.taskVision', 'catalog.taskVisionEn'],
  Speech: ['catalog.taskAsr', 'catalog.taskAsrEn'],
  Embedding: ['catalog.taskEmbedding', 'catalog.taskEmbeddingEn'],
}

/** 筛选下拉的紧凑触发器：一行放五六个，不能占用通用 Select 默认的大尺寸 */
const SELECT_TRIGGER =
  'flex w-full items-center justify-between gap-1.5 rounded-lg border border-gray-200 bg-gray-50/70 px-2.5 py-1.5 text-[12px] outline-none transition-all hover:border-gray-300 focus:border-cyan-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-white/[0.16] dark:focus:border-cyan-500'

export default function FoundryLocalPage() {
  const { t } = useTranslation('foundry')
  const queryClient = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [cachedOnly, setCachedOnly] = useState(false)
  const [taskFilter, setTaskFilter] = useState<string | null>(null)
  const [deviceFilter, setDeviceFilter] = useState<string | null>(null)
  const [loadedOnly, setLoadedOnly] = useState(false)
  const [sortBy, setSortBy] = useState<'name' | 'sizeDesc' | 'sizeAsc'>('name')
  const [downloads, setDownloads] = useState<DownloadMap>({})
  const [dirDraft, setDirDraft] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const statusQuery = useQuery({
    queryKey: ['foundryLocal', 'status'],
    queryFn: foundryLocalService.getStatus,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  })
  const status = statusQuery.data

  // CLI 没装时整页只展示安装引导，不该再去拉目录
  const cliReady = status?.cliInstalled === true && status?.supported === true

  const modelsQuery = useQuery({
    queryKey: ['foundryLocal', 'models', cachedOnly],
    queryFn: () => foundryLocalService.getModels(cachedOnly),
    enabled: cliReady,
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
    mutationFn: async (variantId: string) => {
      await foundryLocalService.download(variantId, (progress) => {
        setDownloads((prev) => ({ ...prev, [variantId]: progress }))
      })
    },
    onSuccess: (_data, variantId) => {
      invalidate()
      // 进度条多留一秒，让用户看到 100% 再消失
      window.setTimeout(() => {
        setDownloads((prev) => {
          const next = { ...prev }
          delete next[variantId]
          return next
        })
      }, 1000)
    },
    onError: (error: Error, variantId) => {
      setDownloads((prev) => ({ ...prev, [variantId]: { alias: variantId, state: 'failed', error: error.message } }))
    },
  })

  const registerMutation = useMutation({
    mutationFn: (model: FoundryLocalModel) => foundryLocalService.register(model.id, 'chat'),
    onSuccess: () => {
      setMessage(t('registerDone'))
      invalidate()
    },
    onError: (error: Error) => setMessage(error.message),
  })

  const dirMutation = useMutation({
    mutationFn: (path: string | null) => foundryLocalService.setCacheDir(path),
    onSuccess: (applied) => {
      setDirDraft(null)
      setMessage(t('cacheDirSaved', { path: applied }))
      invalidate()
    },
    onError: (error: Error) => setMessage(error.message),
  })

  const serviceMutation = useMutation({
    mutationFn: (op: 'start' | 'stop' | 'restart') => {
      if (op === 'start') return foundryLocalService.startService()
      if (op === 'stop') return foundryLocalService.stopService()
      return foundryLocalService.restartService()
    },
    onSuccess: (_d, op) => {
      setMessage(t(op === 'restart' ? 'serviceRestarted' : op === 'start' ? 'serviceStarted' : 'serviceStopped'))
      invalidate()
    },
    onError: (error: Error) => setMessage(error.message),
  })

  const models = useMemo(() => {
    const list = modelsQuery.data ?? []
    const kw = keyword.trim().toLowerCase()
    const filtered = list.filter((m) => {
      if (kw && ![m.alias, m.displayName, m.publisher, m.id].some((v) => v?.toLowerCase().includes(kw))) return false
      if (taskFilter && m.task !== taskFilter) return false
      if (deviceFilter && m.deviceType !== deviceFilter) return false
      if (loadedOnly && !m.isLoaded) return false
      return true
    })
    const sorted = [...filtered]
    switch (sortBy) {
      case 'sizeDesc':
        sorted.sort((a, b) => (b.fileSizeMb ?? 0) - (a.fileSizeMb ?? 0))
        break
      case 'sizeAsc':
        sorted.sort((a, b) => (a.fileSizeMb ?? 0) - (b.fileSizeMb ?? 0))
        break
      default:
        sorted.sort((a, b) => (a.displayName ?? a.alias).localeCompare(b.displayName ?? b.alias))
    }
    // 已下载的始终排在最前，方便直接找到能用的
    return sorted.sort((a, b) => Number(b.isCached) - Number(a.isCached))
  }, [modelsQuery.data, keyword, taskFilter, deviceFilter, loadedOnly, sortBy])

  // 筛选项从数据里长出来：目录变了选项自动跟着变，不写死
  const facets = useMemo(() => {
    const list = modelsQuery.data ?? []
    const countBy = (pick: (m: FoundryLocalModel) => string | undefined) => {
      const map = new Map<string, number>()
      for (const m of list) {
        const v = pick(m)
        if (v) map.set(v, (map.get(v) ?? 0) + 1)
      }
      return [...map.entries()].sort((a, b) => b[1] - a[1])
    }
    return {
      tasks: countBy((m) => m.task),
      devices: countBy((m) => m.deviceType),
      total: list.length,
    }
  }, [modelsQuery.data])

  const cacheDir = dirDraft ?? status?.cacheDir ?? ''

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

          {message && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-cyan-200/70 bg-cyan-50/60 px-4 py-2.5 text-[12px] text-cyan-800 dark:border-cyan-500/20 dark:bg-cyan-950/20 dark:text-cyan-200">
              <span className="min-w-0 flex-1 break-words">{message}</span>
              <button onClick={() => setMessage(null)} className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100">
                <X size={12} />
              </button>
            </div>
          )}

          {/* CLI 没装：整页只做安装引导，不展示任何管理界面 */}
          {!cliReady ? (
            <InstallGuide status={status} copied={copied} onCopy={() => setCopied(true)} />
          ) : (
            <div className="space-y-5">
              {/* 运行状态 */}
              <Card padded={false} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
                <StatusDot ok={status?.running === true} label={t('status.running')} offLabel={t('status.stopped')} />
                <div className="min-w-0">
                  <div className="text-[11px] text-gray-400">{t('status.endpoint')}</div>
                  <div className="truncate text-[13px] font-medium text-gray-700 dark:text-gray-200">
                    {status?.endpoint ?? '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-400">{t('status.cliVersion')}</div>
                  <div className="text-[13px] font-medium text-gray-700 dark:text-gray-200">
                    {status?.cliVersion ?? '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-400">{t('status.loaded')}</div>
                  <div className="text-[13px] font-medium tabular-nums text-gray-700 dark:text-gray-200">
                    {status?.loadedCount ?? 0}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-gray-400">{t('status.cached')}</div>
                  <div className="text-[13px] font-medium tabular-nums text-gray-700 dark:text-gray-200">
                    {status?.cachedCount ?? 0}
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    disabled={status?.running === true || serviceMutation.isPending}
                    onClick={() => serviceMutation.mutate('start')}
                  >
                    <Play size={13} /> {t('status.start')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    disabled={status?.running !== true || serviceMutation.isPending}
                    onClick={() => serviceMutation.mutate('stop')}
                  >
                    <Square size={13} /> {t('status.stop')}
                  </Button>
                  <Button
                    variant="ghost"
                    tone="gray"
                    size="sm"
                    className="gap-1.5"
                    disabled={serviceMutation.isPending}
                    onClick={() => serviceMutation.mutate('restart')}
                  >
                    <RotateCcw size={13} /> {t('status.restart')}
                  </Button>
                </div>
              </Card>

              {/* CLI 自己报的警告（如某个 EP 注册失败）原样透出，用户得知道 */}
              {status && status.warnings.length > 0 && (
                <Card padded={false} className="px-5 py-3.5">
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-amber-700 dark:text-amber-300">
                    <TriangleAlert size={13} /> {t('status.warnings')}
                  </h3>
                  <ul className="space-y-1 text-[11px] leading-relaxed text-amber-700/80 dark:text-amber-300/80">
                    {status.warnings.map((w) => <li key={w} className="break-words">{w}</li>)}
                  </ul>
                </Card>
              )}

              {/* 本机硬件 + 缓存路径 */}
              <div className="grid gap-5 lg:grid-cols-2">
                <Card padded={false} className="px-5 py-4">
                  <h3 className="mb-2.5 flex items-center gap-1.5 text-[13px] font-medium text-gray-700 dark:text-gray-200">
                    <Cpu size={13} className="text-gray-400" /> {t('status.hardware')}
                  </h3>
                  <dl className="space-y-1.5 text-[12px]">
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-gray-400">CPU</dt>
                      <dd className="min-w-0 break-words text-gray-700 dark:text-gray-200">{status?.cpu ?? '—'}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-gray-400">GPU</dt>
                      <dd className="min-w-0 break-words text-gray-700 dark:text-gray-200">
                        {status && status.gpus.length > 0
                          ? status.gpus.map((g) => g.videoMemoryBytes ? `${g.name} · ${formatBytes(g.videoMemoryBytes)}` : g.name).join(' · ')
                          : t('status.noGpu')}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-gray-400">NPU</dt>
                      <dd className="min-w-0 break-words text-gray-700 dark:text-gray-200">
                        {status && status.npus.length > 0
                          ? status.npus.map((n) => n.name).join(' · ')
                          : '—'}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-gray-400">{t('status.memory')}</dt>
                      <dd className="text-gray-700 tabular-nums dark:text-gray-200">{formatBytes(status?.availableMemoryBytes)}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-gray-400">{t('status.disk')}</dt>
                      <dd className="text-gray-700 tabular-nums dark:text-gray-200">{formatBytes(status?.diskFreeBytes)}</dd>
                    </div>
                  </dl>
                </Card>

                <Card padded={false} className="px-5 py-4">
                  <div className="mb-2.5 flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-gray-700 dark:text-gray-200">
                      <HardDrive size={13} className="text-gray-400" /> {t('cacheDir.label')}
                    </h3>
                    <button
                      onClick={() => dirMutation.mutate(null)}
                      disabled={dirMutation.isPending}
                      title={t('cacheDir.reset')}
                      className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-white/[0.06] dark:hover:text-gray-300"
                    >
                      <RotateCcw size={11} /> {t('cacheDir.reset')}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      tone="cyan"
                      size="sm"
                      glass
                      value={cacheDir}
                      onChange={(e) => setDirDraft(e.target.value)}
                      spellCheck={false}
                      className="h-8 min-w-0 flex-1"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-8 shrink-0 gap-1.5"
                      disabled={dirMutation.isPending || dirDraft === null || dirDraft === status?.cacheDir}
                      onClick={() => dirMutation.mutate(dirDraft)}
                    >
                      {dirMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      {t('cacheDir.save')}
                    </Button>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-gray-400">{t('cacheDir.hint')}</p>
                </Card>
              </div>

              {/* 模型目录 */}
              <Card padded={false}>
                <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-5 py-3 dark:border-white/[0.06]">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                    <Cpu size={15} className="text-cyan-500" />
                    {t('catalog.title')}
                    <span className="text-[11px] font-normal tabular-nums text-gray-400">
                      {models.length}/{facets.total}
                    </span>
                  </h2>
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

                {/* 筛选：一律用通用 Select 收进下拉，平铺的 chip 视觉噪音太大 */}
                <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-2.5 dark:border-white/[0.06]">
                  <Select
                    className="w-32"
                    triggerClassName={SELECT_TRIGGER}
                    value={taskFilter ?? ''}
                    onChange={(v) => setTaskFilter(v || null)}
                    options={[
                      { value: '', label: `${t('filter.task')}：${t('filter.all')}` },
                      ...facets.tasks.map(([value, count]) => ({
                        value,
                        label: `${taskLabel(value, t)} (${count})`,
                      })),
                    ]}
                  />
                  <Select
                    className="w-32"
                    triggerClassName={SELECT_TRIGGER}
                    value={deviceFilter ?? ''}
                    onChange={(v) => setDeviceFilter(v || null)}
                    options={[
                      { value: '', label: `${t('filter.device')}：${t('filter.all')}` },
                      ...facets.devices.map(([value, count]) => ({ value, label: `${value} (${count})` })),
                    ]}
                  />
                  <Select
                    className="w-32"
                    triggerClassName={SELECT_TRIGGER}
                    value={loadedOnly ? 'loaded' : ''}
                    onChange={(v) => setLoadedOnly(v === 'loaded')}
                    options={[
                      { value: '', label: `${t('filter.state')}：${t('filter.all')}` },
                      { value: 'loaded', label: t('filter.loaded') },
                    ]}
                  />
                  <Select
                    className="w-32"
                    triggerClassName={SELECT_TRIGGER}
                    value={cachedOnly ? 'cached' : ''}
                    onChange={(v) => setCachedOnly(v === 'cached')}
                    options={[
                      { value: '', label: `${t('catalog.cachedOnly')}：${t('filter.all')}` },
                      { value: 'cached', label: t('filter.cached') },
                    ]}
                  />
                  <Select
                    className="w-36"
                    triggerClassName={SELECT_TRIGGER}
                    value={sortBy}
                    onChange={(v) => setSortBy(v as typeof sortBy)}
                    options={[
                      { value: 'name', label: `${t('sort.label')}：${t('sort.name')}` },
                      { value: 'sizeDesc', label: `${t('sort.label')}：${t('sort.sizeDesc')}` },
                      { value: 'sizeAsc', label: `${t('sort.label')}：${t('sort.sizeAsc')}` },
                    ]}
                  />
                </div>

                {modelsQuery.isLoading ? (
                  <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
                    <Loader2 size={15} className="animate-spin" /> {t('catalog.loading')}
                  </div>
                ) : models.length === 0 ? (
                  <div className="py-16 text-center text-sm text-gray-400">{t('catalog.empty')}</div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
                    {models.map((model) => {
                      const progress = downloads[model.id]
                      const downloading = downloadMutation.isPending && downloadMutation.variables === model.id
                      return (
                        <div key={model.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                          <div className="min-w-[220px] flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-[13px] font-medium text-gray-800 dark:text-gray-100">
                                {model.displayName ?? model.alias}
                              </span>
                              <span className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium ${deviceBadgeClass(model.deviceType)}`}>
                                {model.deviceType ?? '—'}
                              </span>
                              {model.isCached && <Badge tone="emerald">{t('badge.cached')}</Badge>}
                              {model.isLoaded && <Badge tone="blue">{t('badge.loaded')}</Badge>}
                              {model.isRegistered && <Badge tone="violet">{t('badge.registered')}</Badge>}
                            </div>
                            <div className="mt-0.5 truncate text-[11px] text-gray-400">
                              {[model.publisher, model.task, model.executionProvider].filter(Boolean).join(' · ')}
                              {` · ${formatSize(model.fileSizeMb)}`}
                              {model.deviceVariants.length > 1 && ` · ${t('row.deviceVariants')}: ${model.deviceVariants.join(' / ')}`}
                            </div>
                          </div>

                          {downloading && progress && (
                            <div className="w-40">
                              <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06]">
                                <div
                                  className="h-full rounded-full bg-cyan-500 transition-all"
                                  style={{ width: `${Math.min(100, Math.round(progress.progress ?? 0))}%` }}
                                />
                              </div>
                              <div className="mt-1 text-[10px] tabular-nums text-gray-400">
                                {progress.progress != null ? `${Math.min(100, Math.round(progress.progress))}%` : t('action.downloading')}
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
                                onClick={() => downloadMutation.mutate(model.id)}
                              >
                                <Download size={13} /> {t('action.download')}
                              </Button>
                            )}
                            {model.isCached && !model.isLoaded && (
                              <Button
                                variant="secondary"
                                size="sm"
                                className="gap-1.5"
                                disabled={serviceMutation.isPending}
                                title={t('row.loadErrorHint')}
                                onClick={() => void runAction(() => foundryLocalService.load(model.id), 'loaded')}
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
                                onClick={() => void runAction(() => foundryLocalService.unload(model.id), 'unloaded')}
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
                                    message: t('action.removeConfirm', {
                                      name: `${model.displayName ?? model.alias} (${model.deviceType ?? '—'})`,
                                    }),
                                    onConfirm: () => void runAction(
                                      () => foundryLocalService.remove(model.id),
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

/** CLI 未安装时的引导卡：给命令、给文档、说明白 Hetu 为什么不再自带运行时 */
function InstallGuide({
  status,
  copied,
  onCopy,
}: {
  status?: { unsupportedReason?: string }
  copied: boolean
  onCopy: () => void
}) {
  const { t } = useTranslation('foundry')
  return (
    <Card className="flex flex-col gap-5 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-50 dark:bg-cyan-950/40">
          <Terminal size={24} className="text-cyan-500" />
        </div>
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">{t('install.title')}</h2>
        <p className="max-w-xl text-sm leading-relaxed text-gray-500 dark:text-gray-400">{t('install.lead')}</p>
        {status?.unsupportedReason && (
          <p className="max-w-xl text-[12px] leading-relaxed text-amber-600 dark:text-amber-400">
            {status.unsupportedReason}
          </p>
        )}
      </div>

      <div className="mx-auto w-full max-w-xl space-y-2">
        <div className="text-[12px] font-medium text-gray-600 dark:text-gray-300">{t('install.step1')}</div>
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-2.5 dark:border-white/[0.08] dark:bg-white/[0.03]">
          <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-gray-700 dark:text-gray-200">
            {INSTALL_COMMAND}
          </code>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(INSTALL_COMMAND).then(() => onCopy())
            }}
            title={t('install.copy')}
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
          >
            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            {copied ? t('install.copied') : t('install.copy')}
          </button>
        </div>
        <div className="flex items-center gap-3 text-[12px] text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1.5">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 text-[10px] font-semibold text-gray-600 dark:bg-white/10 dark:text-gray-300">2</span>
            {t('install.step2')}
          </span>
          <a
            href="https://learn.microsoft.com/windows/ai/foundry-local/get-started"
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto flex items-center gap-1 text-cyan-600 hover:underline dark:text-cyan-400"
          >
            {t('install.docs')}
          </a>
        </div>
      </div>

      <div className="mx-auto w-full max-w-xl rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
        <div className="mb-1.5 text-[12px] font-medium text-gray-600 dark:text-gray-300">{t('install.notes')}</div>
        <ul className="space-y-1 text-[11px] leading-relaxed text-gray-400">
          <li>· {t('install.note1')}</li>
          <li>· {t('install.note2')}</li>
          <li>· {t('install.note3')}</li>
        </ul>
      </div>
    </Card>
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

/** 设备徽底色：GPU/NPU 用同色系淡底，CPU 走中性灰 */
const DEVICE_BADGE: Record<string, string> = {
  GPU: 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-950/40 dark:text-cyan-300',
  NPU: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-950/40 dark:text-violet-300',
  CPU: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-400',
}

function deviceBadgeClass(device?: string): string {
  return DEVICE_BADGE[device ?? ''] ?? DEVICE_BADGE.CPU
}

function taskLabel(value: string, t: (key: string) => string): string {
  const key = TASK_LABELS[value]
  return key ? t(key[0]) : value
}
