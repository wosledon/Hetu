import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Boxes, Check, CircleSlash, Cpu, Download, FolderOpen, HardDrive, Loader2, Play, RotateCcw,
  Search, Square, Trash2, TriangleAlert, X,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { Button, Card, Input, PageContainer, SearchInput } from '../components/ui'
import Select from '../components/Select'
import {
  foundryLocalService,
  type FoundryLocalDownloadProgress,
  type FoundryLocalEp,
  type FoundryLocalModel,
} from '../services/foundryLocalService'
import { confirm } from '../components/confirm'

/** 下载中的任务：alias -> 最新进度 */
type DownloadMap = Record<string, FoundryLocalDownloadProgress>

/** 体积格式化：模型动辄几 GB */
function formatSize(mb?: number): string {
  if (!mb || mb <= 0) return '—'
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
}

/** 目录里的 task 是英文枚举值，转成界面文案；未知值原样显示 */
const TASK_LABELS: Record<string, [string, string]> = {
  'chat-completion': ['filter.taskChat', 'filter.taskChatEn'],
  'vision-language-chat': ['filter.taskVision', 'filter.taskVisionEn'],
  'automatic-speech-recognition': ['filter.taskSpeech', 'filter.taskSpeechEn'],
  embeddings: ['filter.taskEmbedding', 'filter.taskEmbeddingEn'],
}

const MODALITY_LABELS: Record<string, [string, string]> = {
  text: ['filter.modalityText', 'filter.modalityTextEn'],
  image: ['filter.modalityImage', 'filter.modalityImageEn'],
  audio: ['filter.modalityAudio', 'filter.modalityAudioEn'],
}

type TFunc = (key: string) => string

/** 执行提供程序名 → 简短说明；未知的只显示设备类型 */
const EP_LABELS: Record<string, [string, string]> = {
  CPUExecutionProvider: ['ep.cpu', 'ep.cpuEn'],
  CudaExecutionProvider: ['ep.cuda', 'ep.cudaEn'],
  MIGraphXExecutionProvider: ['ep.migraphx', 'ep.migraphxEn'],
  WebGpuExecutionProvider: ['ep.webgpu', 'ep.webgpuEn'],
  QnnExecutionProvider: ['ep.qnn', 'ep.qnnEn'],
  DmlExecutionProvider: ['ep.dml', 'ep.dmlEn'],
}

function epLabel(name: string, t: TFunc): string {
  const key = EP_LABELS[name]
  return key ? t(key[0]) : ''
}

/** 筛选下拉的紧凑触发器：一行放五六个，不能占用通用 Select 默认的大尺寸 */
const SELECT_TRIGGER =
  'flex w-full items-center justify-between gap-1.5 rounded-lg border border-gray-200 bg-gray-50/70 px-2.5 py-1.5 text-[12px] outline-none transition-all hover:border-gray-300 focus:border-cyan-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-white/[0.16] dark:focus:border-cyan-500'

function taskLabel(value: string, t: TFunc): string {
  const key = TASK_LABELS[value]
  return key ? t(key[0]) : value
}

function modalityLabel(value: string, t: TFunc): string {
  const key = MODALITY_LABELS[value]
  return key ? t(key[0]) : value
}

export default function FoundryLocalPage() {
  const { t } = useTranslation('foundry')
  const queryClient = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [cachedOnly, setCachedOnly] = useState(false)
  const [taskFilter, setTaskFilter] = useState<string | null>(null)
  const [modalityFilter, setModalityFilter] = useState<string | null>(null)
  const [deviceFilter, setDeviceFilter] = useState<string | null>(null)
  const [toolsOnly, setToolsOnly] = useState(false)
  const [sortBy, setSortBy] = useState<'name' | 'sizeDesc' | 'sizeAsc' | 'ctxDesc'>('name')
  const [downloads, setDownloads] = useState<DownloadMap>({})
  const [epProgress, setEpProgress] = useState<FoundryLocalDownloadProgress | null>(null)
  const [epJustFinished, setEpJustFinished] = useState(false)
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
      foundryLocalService.register(model.id, 'chat').then(() =>
        // 注册完顺手刷新大模型列表，设置页立刻能看到
        queryClient.invalidateQueries({ queryKey: ['aiModels'] }),
      ),
    onSuccess: () => {
      setMessage(t('registerDone'))
      invalidate()
    },
    onError: (error: Error) => setMessage(error.message),
  })

  const epMutation = useMutation({
    mutationFn: (eps?: string[]) =>
      foundryLocalService.downloadExecutionProviders((progress) => setEpProgress(progress), undefined, eps),
    onSuccess: () => {
      setEpProgress(null)
      setEpJustFinished(true)
      invalidate()
    },
    onError: (error: Error) => {
      setEpProgress(null)
      setMessage(error.message)
    },
  })

  const eps = useMemo(() => status?.executionProviders ?? [], [status?.executionProviders])
  const unregisteredEps = useMemo(() => eps.filter((e) => !e.isRegistered), [eps])
  const dirMutation = useMutation({    mutationFn: (path: string | null) => foundryLocalService.setModelDir(path),
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
    const filtered = list.filter((m) => {
      if (kw && ![m.alias, m.displayName, m.publisher, m.modelType].some((v) => v?.toLowerCase().includes(kw))) return false
      if (taskFilter && m.task !== taskFilter) return false
      if (modalityFilter && !(m.inputModalities?.split(',').map((s) => s.trim()) ?? []).includes(modalityFilter)) return false
      if (deviceFilter && m.deviceType !== deviceFilter) return false
      if (toolsOnly && !m.supportsToolCalling) return false
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
      case 'ctxDesc':
        sorted.sort((a, b) => (b.contextLength ?? 0) - (a.contextLength ?? 0))
        break
      default:
        sorted.sort((a, b) => (a.displayName ?? a.alias).localeCompare(b.displayName ?? b.alias))
    }
    // 已下载的始终排在最前，方便直接找到能用的
    return sorted.sort((a, b) => Number(b.isCached) - Number(a.isCached))
  }, [modelsQuery.data, keyword, taskFilter, modalityFilter, deviceFilter, toolsOnly, sortBy])

  // 筛选项从数据里长出来：目录变了选项自动跟着变，不写死
  const facets = useMemo(() => {
    const list = modelsQuery.data ?? []
    const countBy = (pick: (m: FoundryLocalModel) => string | undefined) => {
      const map = new Map<string, number>()
      for (const m of list) {
        for (const v of (pick(m) ?? '').split(',').map((s) => s.trim())) {
          if (v) map.set(v, (map.get(v) ?? 0) + 1)
        }
      }
      return [...map.entries()].sort((a, b) => b[1] - a[1])
    }
    return {
      tasks: countBy((m) => m.task),
      modalities: countBy((m) => m.inputModalities),
      devices: countBy((m) => m.deviceType),
      tools: list.filter((m) => m.supportsToolCalling).length,
      total: list.length,
    }
  }, [modelsQuery.data])

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
                  <div className="text-[11px] text-gray-400">{t('status.endpoint')}</div>
                  <div className="truncate text-[13px] font-medium text-gray-700 dark:text-gray-200">
                    {status?.endpoint ?? '—'}
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

              {/* 执行提供程序：决定目录里会出现哪些设备的模型 */}
              {eps.length > 0 && (
                <Card padded={false} className="px-5 py-4">
                  <div className="mb-2.5 flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-gray-700 dark:text-gray-200">
                      <Cpu size={13} className="text-gray-400" />
                      {t('ep.title')}
                    </h3>
                    {unregisteredEps.length > 0 && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 shrink-0 gap-1.5"
                        disabled={epMutation.isPending}
                        onClick={() => epMutation.mutate(unregisteredEps.map((e) => e.name))}
                        title={t('ep.downloadHint')}
                      >
                        {epMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                        {t('ep.download')}
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {eps.map((ep) => (
                      <span
                        key={ep.name}
                        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                          ep.isRegistered
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : 'border-gray-200 text-gray-400 dark:border-white/10 dark:text-gray-500'
                        }`}
                      >
                        {ep.isRegistered ? <Check size={11} /> : <CircleSlash size={11} />}
                        {ep.deviceType}
                        <span className="opacity-60">{epLabel(ep.name, t)}</span>
                        {/* 未注册的可以只注册这一个：一把梭「全部」会由运行时挑，未必是你要的那个 */}
                        {!ep.isRegistered && (
                          <button
                            onClick={() => epMutation.mutate([ep.name])}
                            disabled={epMutation.isPending}
                            title={t('ep.registerOne', { ep: epLabel(ep.name, t) || ep.name })}
                            className="ml-0.5 flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] text-cyan-600 transition-colors hover:bg-cyan-50 disabled:opacity-50 dark:text-cyan-300 dark:hover:bg-cyan-500/10"
                          >
                            {epMutation.isPending && epMutation.variables?.[0] === ep.name
                              ? <Loader2 size={10} className="animate-spin" />
                              : <Download size={10} />}
                            {t('ep.register')}
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                  {epMutation.isPending && epProgress && (
                    <div className="mt-2.5">
                      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06]">
                        <div
                          className="h-full rounded-full bg-cyan-500 transition-all"
                          style={{ width: `${Math.min(100, Math.round(epProgress.progress ?? 0))}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <p className="mt-2 text-[11px] leading-relaxed text-gray-400">{t('ep.hint')}</p>
                  {epJustFinished && (
                    <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                      <Check size={11} />
                      {t('ep.registeredHint')}
                    </p>
                  )}
                </Card>
              )}

              {/* 模型保存路径：标题行 + 输入与保存紧挨着的一组 + 通栏说明 */}
              <Card padded={false} className="px-5 py-4">
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-gray-700 dark:text-gray-200">
                    <HardDrive size={13} className="text-gray-400" />
                    {t('modelDir.label')}
                  </h3>
                  <button
                    onClick={() => dirMutation.mutate(null)}
                    disabled={dirMutation.isPending}
                    title={t('modelDir.reset')}
                    className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-white/[0.06] dark:hover:text-gray-300"
                  >
                    <RotateCcw size={11} /> {t('modelDir.reset')}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    tone="cyan"
                    size="sm"
                    glass
                    value={modelDir}
                    onChange={(e) => setDirDraft(e.target.value)}
                    placeholder={status?.defaultModelDir}
                    spellCheck={false}
                    className="h-8 min-w-0 flex-1"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5"
                    disabled={dirMutation.isPending || dirDraft === null || dirDraft === (status?.pendingModelDir ?? status?.modelDir)}
                    onClick={() => dirMutation.mutate(dirDraft)}
                  >
                    {dirMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    {t('modelDir.save')}
                  </Button>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-gray-400">{t('modelDir.hint')}</p>
                {status?.restartRequired && (
                  <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                    <RotateCcw size={11} />
                    {t('modelDir.restartHint')}
                  </p>
                )}
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
                    value={taskFilter ?? ''}
                    onChange={(v) => setTaskFilter(v || null)}
                    options={[
                      { value: '', label: `${t('filter.task')}：${t('filter.all')}` },
                      ...facets.tasks.map(([value, count]) => ({
                        value,
                        label: `${taskLabel(value, t)} · ${count}`,
                      })),
                    ]}
                    triggerClassName={SELECT_TRIGGER}
                  />
                  <Select
                    className="w-32"
                    value={modalityFilter ?? ''}
                    onChange={(v) => setModalityFilter(v || null)}
                    options={[
                      { value: '', label: `${t('filter.modality')}：${t('filter.all')}` },
                      ...facets.modalities.map(([value, count]) => ({
                        value,
                        label: `${modalityLabel(value, t)} · ${count}`,
                      })),
                    ]}
                    triggerClassName={SELECT_TRIGGER}
                  />
                  <Select
                    className="w-28"
                    value={deviceFilter ?? ''}
                    onChange={(v) => setDeviceFilter(v || null)}
                    options={[
                      { value: '', label: `${t('filter.device')}：${t('filter.all')}` },
                      ...facets.devices.map(([value, count]) => ({
                        value,
                        label: `${value} · ${count}`,
                      })),
                    ]}
                    triggerClassName={SELECT_TRIGGER}
                  />
                  <Select
                    className="w-32"
                    value={toolsOnly ? 'tools' : ''}
                    onChange={(v) => setToolsOnly(v === 'tools')}
                    options={[
                      { value: '', label: `${t('filter.capability')}：${t('filter.all')}` },
                      { value: 'tools', label: `${t('filter.toolCalling')} · ${facets.tools}` },
                    ]}
                    triggerClassName={SELECT_TRIGGER}
                  />
                  <Select
                    className="w-32"
                    value={cachedOnly ? 'cached' : ''}
                    onChange={(v) => setCachedOnly(v === 'cached')}
                    options={[
                      { value: '', label: `${t('filter.state')}：${t('filter.all')}` },
                      { value: 'cached', label: t('catalog.cachedOnly') },
                    ]}
                    triggerClassName={SELECT_TRIGGER}
                  />
                  <Select
                    className="ml-auto w-36"
                    value={sortBy}
                    onChange={(v) => setSortBy(v as typeof sortBy)}
                    options={[
                      { value: 'name', label: t('sort.name') },
                      { value: 'sizeDesc', label: t('sort.sizeDesc') },
                      { value: 'sizeAsc', label: t('sort.sizeAsc') },
                      { value: 'ctxDesc', label: t('sort.ctxDesc') },
                    ]}
                    triggerClassName={SELECT_TRIGGER}
                  />
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
                              {[model.publisher, model.modelType, model.task].filter(Boolean).join(' · ')}
                              {model.contextLength ? ` · ${Math.round(model.contextLength / 1024)}k ctx` : ''}
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
                                {Math.min(100, Math.round(progress.progress ?? 0))}%
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
                              model.executionProviderRegistered ? (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="gap-1.5"
                                  onClick={() => void runAction(() => foundryLocalService.load(model.id), 'loaded')}
                                >
                                  <Play size={13} /> {t('action.load')}
                                </Button>
                              ) : epAvailableFor(model.executionProvider, eps) ? (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="gap-1.5"
                                  disabled={epMutation.isPending}
                                  onClick={() => epMutation.mutate([epNameFor(model.executionProvider)])}
                                  title={t('row.epMissingHint', { ep: model.executionProvider })}
                                >
                                  {epMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                                  {t('row.registerEp', { ep: model.executionProvider })}
                                </Button>
                              ) : (
                                /* 本机压根没这个 EP（如 AMD 机器上的 CUDA）：给结论，别让用户白点 */
                                <span
                                  className="flex items-center gap-1 text-[11px] text-gray-400"
                                  title={t('row.epUnavailableHint', { ep: model.executionProvider })}
                                >
                                  <CircleSlash size={11} />
                                  {t('row.epUnavailable', { ep: model.executionProvider })}
                                </span>
                              )
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

/** 设备徽底色：GPU/NPU 用同色系淡底，CPU 走中性灰 */const DEVICE_BADGE: Record<string, string> = {
  GPU: 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-950/40 dark:text-cyan-300',
  NPU: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-950/40 dark:text-violet-300',
  CPU: 'border-gray-200 bg-gray-50 text-gray-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-400',
}

function deviceBadgeClass(device?: string): string {
  return DEVICE_BADGE[device ?? ''] ?? DEVICE_BADGE.CPU
}

/** 归一化 EP 名（CPU / CUDA / WebGPU）→ SDK 原始 EP 名，用于按名注册 */
function epNameFor(executionProvider?: string): string {
  if (!executionProvider) return 'CUDAExecutionProvider'
  return executionProvider.endsWith('ExecutionProvider')
    ? executionProvider
    : `${executionProvider}ExecutionProvider`
}

/** 本机是否找得到该 EP：DiscoverEps 列不出来（如 AMD 机器上的 CUDA）就注册也没用 */
function epAvailableFor(executionProvider: string | undefined, available: FoundryLocalEp[]): boolean {
  if (!executionProvider) return false
  const target = executionProvider.replace(/ExecutionProvider$/i, '').toLowerCase()
  return available.some((ep) => ep.name.replace(/ExecutionProvider$/i, '').toLowerCase() === target)
}
