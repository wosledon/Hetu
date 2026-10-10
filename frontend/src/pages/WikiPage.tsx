import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle, BookText, Check, Cpu, Download, FolderInput, Loader2, RefreshCw, Server, Trash2, X,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import ThemedMarkdown from '../components/ThemedMarkdown'
import { projectService } from '../services/projectService'
import { wikiService } from '../services/wikiService'
import { aiModelService } from '../services/aiProviderService'
import { useConfirm } from '../components/confirm'
import i18n from '../i18n'
import { formatDate } from '../utils/locale'
import type { IAiModel } from '../types'
import type { IManagedProject } from '../types/project'
import type { IWikiSet, IWikiSetPage, IWikiGenerationJob } from '../types/wiki'

const POLL_INTERVAL = 2000
const IDLE_POLL_INTERVAL = 15000

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMins = Math.floor((now.getTime() - date.getTime()) / 60000)
  if (diffMins < 1) return i18n.t('common:justNow')
  if (diffMins < 60) return i18n.t('common:minutesAgo', { count: diffMins })
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return i18n.t('common:hoursAgo', { count: diffHours })
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return i18n.t('common:daysAgo', { count: diffDays })
  return formatDate(date)
}

export default function WikiPage() {
  const { t } = useTranslation('knowledge')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [searchParams, setSearchParams] = useSearchParams()
  const projectParam = searchParams.get('project')
  const autoGenerate = searchParams.get('generate') === '1'

  const [selectedSetId, setSelectedSetId] = useState<string | null>(null)
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [chosenModelId, setChosenModelId] = useState<string | undefined>(undefined)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const autoGenerateHandled = useRef(false)

  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: projectService.getAll,
  })

  const { data: sets = [], isLoading: setsLoading } = useQuery({
    queryKey: ['wiki', 'sets'],
    queryFn: () => wikiService.getSets(),
  })

  const { data: allDocs = [] } = useQuery({
    queryKey: ['wiki', 'all'],
    queryFn: () => wikiService.getAll(),
  })

  const { data: models = [] } = useQuery({
    queryKey: ['ai-models'],
    queryFn: aiModelService.getAll,
    staleTime: 60 * 1000,
  })

  // 进行中的任务：轮询进度；任务结束后刷新文档列表
  const { data: jobs = [] } = useQuery({
    queryKey: ['wiki', 'jobs'],
    queryFn: () => wikiService.getJobs(projectParam ?? undefined),
    // 有进行中任务时高频轮询，否则低频兜底（捕捉其他入口发起的生成）
    refetchInterval: (query) => {
      const list = query.state.data as IWikiGenerationJob[] | undefined
      const running = list?.some((j) => j.status === 0 || j.status === 1)
      return running ? POLL_INTERVAL : IDLE_POLL_INTERVAL
    },
  })

  const activeJob = useMemo(
    () => jobs.find((j) => j.status === 0 || j.status === 1) ?? null,
    [jobs],
  )
  const lastRunningJobId = useRef<string | null>(null)

  useEffect(() => {
    const runningId = activeJob?.id ?? null
    // 任务从进行中消失：刷新文档与套件（不依赖 setState，避免级联渲染）
    if (lastRunningJobId.current && !runningId) {
      queryClient.invalidateQueries({ queryKey: ['wiki'] })
    }
    lastRunningJobId.current = runningId
    // 生成完成后自动跳到最新一套： selectedSetId 仅在用户显式选择时设置
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    if (activeJob?.setId) setSelectedSetId(activeJob.setId)
  }, [activeJob, queryClient])

  const orderedProjects = useMemo(
    () =>
      [...projects].sort(
        (a, b) =>
          Number(b.isPinned) - Number(a.isPinned) ||
          a.sortOrder - b.sortOrder ||
          a.name.localeCompare(b.name),
      ),
    [projects],
  )

  const selectedProject = useMemo(
    () => orderedProjects.find((p) => p.id === projectParam) ?? null,
    [orderedProjects, projectParam],
  )

  const visibleSets = useMemo(
    () => (projectParam ? sets.filter((s) => s.projectId === projectParam) : sets),
    [sets, projectParam],
  )

  const selectedSet = visibleSets.find((s) => s.setId === selectedSetId) ?? visibleSets[0] ?? null
  const pagesOfSet = useMemo(
    () =>
      allDocs
        .filter((d) => d.setId === selectedSet?.setId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [allDocs, selectedSet],
  )
  const selectedDoc = pagesOfSet.find((p) => p.id === selectedDocId) ?? pagesOfSet[0] ?? null

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text })
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 2600)
  }

  const invalidateWiki = () => {
    queryClient.invalidateQueries({ queryKey: ['wiki'] })
  }

  const generateMutation = useMutation({
    mutationFn: (projectId: string) => wikiService.generate(projectId, chosenModelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wiki', 'jobs'] })
      showToast(true, t('wiki.queued'))
    },
    onError: (e: Error) => showToast(false, e.message || t('wiki.queueFailed')),
  })

  const regenerateMutation = useMutation({
    mutationFn: (id: string) => wikiService.regenerate(id),
    onSuccess: (doc) => {
      setSelectedDocId(doc.id)
      invalidateWiki()
      showToast(true, t('wiki.pageUpdated'))
    },
    onError: (e: Error) => showToast(false, e.message || t('wiki.regenerateFailed')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => wikiService.delete(id),
    onSuccess: () => {
      setSelectedDocId(null)
      invalidateWiki()
      showToast(true, t('wiki.deleted'))
    },
    onError: (e: Error) => showToast(false, e.message || t('common:deleteFailed')),
  })

  const deleteSetMutation = useMutation({
    mutationFn: (setId: string) => wikiService.deleteSet(setId),
    onSuccess: () => {
      setSelectedSetId(null)
      setSelectedDocId(null)
      invalidateWiki()
      showToast(true, t('wiki.setDeleted'))
    },
    onError: (e: Error) => showToast(false, e.message || t('common:deleteFailed')),
  })

  const exportMutation = useMutation({
    mutationFn: (setId: string) => wikiService.exportSet(setId),
    onSuccess: (blob, setId) => {
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `wiki-${setId}.zip`
      link.click()
      URL.revokeObjectURL(url)
      showToast(true, t('wiki.downloadStarted'))
    },
    onError: (e: Error) => showToast(false, e.message || t('wiki.exportFailed')),
  })

  // 从项目页带 generate=1 跳转进来：自动入队一次生成，并清掉 URL 参数
  useEffect(() => {
    if (!autoGenerate || autoGenerateHandled.current || !projectParam) return
    autoGenerateHandled.current = true
    const params = new URLSearchParams(searchParams)
    params.delete('generate')
    setSearchParams(params, { replace: true })
    generateMutation.mutate(projectParam)
    // generateMutation 由 useMutation 保证引用稳定，无需加入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate, projectParam])

  const busy = activeJob != null && (activeJob.status === 0 || activeJob.status === 1)
  const generating = busy || generateMutation.isPending

  const selectProject = (project: IManagedProject | null) => {
    const params = new URLSearchParams(searchParams)
    if (project) params.set('project', project.id)
    else params.delete('project')
    setSearchParams(params, { replace: true })
  }

  /** 选中一套 Wiki；未按项目过滤时联动选中其所属项目，让页头与「生成 Wiki」指向正确项目 */
  const selectSet = (setId: string, projectId: string) => {
    setSelectedSetId(setId)
    setSelectedDocId(null)
    if (!projectParam && projectId) {
      const params = new URLSearchParams(searchParams)
      params.set('project', projectId)
      setSearchParams(params, { replace: true })
    }
  }

  const pageRow = (page: IWikiSetPage, indent: string) => (
    <div
      key={page.id}
      onClick={() => setSelectedDocId(page.id)}
      className={`group flex cursor-pointer items-center gap-2 border-l-2 py-1.5 pr-3 transition-colors ${
        page.id === selectedDoc?.id
          ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/20'
          : 'border-transparent hover:bg-gray-50 dark:hover:bg-white/[0.04]'
      }`}
      style={{ paddingLeft: indent }}
    >
      <span className="min-w-0 flex-1 truncate text-[12px] text-gray-600 dark:text-gray-300" title={page.title}>
        {page.sortOrder === 0 ? '★ ' : ''}{page.title}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setRegeneratingId(page.id)
          regenerateMutation.mutate(page.id)
        }}
        disabled={regeneratingId === page.id}
        title={t('wiki.regenerateTitle')}
        aria-label={t('wiki.regeneratePage')}
        className="shrink-0 rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:text-emerald-500 group-hover:opacity-100 disabled:opacity-100"
      >
        {regeneratingId === page.id
          ? <Loader2 size={12} className="animate-spin" />
          : <RefreshCw size={12} />}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          confirm({
            title: t('wiki.deletePageTitle'),
            message: t('wiki.deletePageMessage', { title: page.title }),
            onConfirm: () => deleteMutation.mutate(page.id),
          })
        }}
        title={t('common:delete')}
        aria-label={t('common:delete')}
        className="shrink-0 rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )

  /** 套件内的父子级树：总览 → 章节（父） → 页面（子）；无章节时平铺 */
  const renderSetTree = (set: IWikiSet) => {
    const ordered = [...set.pages].sort((a, b) => a.sortOrder - b.sortOrder)
    const nodes: React.ReactNode[] = []
    let currentChapter: string | null | undefined

    for (const page of ordered) {
      if (page.sortOrder === 0) {
        nodes.push(pageRow(page, '1.75rem'))
        continue
      }
      if (page.chapter !== currentChapter) {
        currentChapter = page.chapter
        if (page.chapter) {
          nodes.push(
            <div key={`chapter-${page.chapter}`} className="px-4 pb-0.5 pt-2 text-[11px] font-medium text-gray-400">
              {page.chapter}
            </div>
          )
        }
      }
      nodes.push(pageRow(page, page.chapter ? '2.75rem' : '1.75rem'))
    }
    return nodes
  }

  const chatModels = useMemo(
    () => models.filter((m: IAiModel) => m.purpose !== 'embedding'),
    [models],
  )
  const chosenModelName = chatModels.find((m) => m.id === chosenModelId)?.displayName

  return (
    <AppLayout showSidebar={false} mainContent={
      <div className="flex h-full min-w-0 flex-1 bg-gray-50 dark:bg-gray-950">
        {/* 项目列表 */}
        <aside className="flex h-full w-52 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
            <button
              onClick={() => selectProject(null)}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                !projectParam
                  ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]'
              }`}
            >
              <BookText size={14} className="shrink-0" />
              <span className="min-w-0 flex-1">{t('wiki.allDocs')}</span>
              <span className="shrink-0 text-[11px] text-gray-400">{sets.length}</span>
            </button>

            <div className="mt-5 px-2.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{t('wiki.projects')}</span>
            </div>
            <div className="mt-1 space-y-0.5">
              {projectsLoading ? (
                <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-gray-400" /></div>
              ) : orderedProjects.length === 0 ? (
                <p className="px-2.5 py-1 text-[11px] leading-relaxed text-gray-400">{t('wiki.noProjects')}</p>
              ) : (
                orderedProjects.map((project) => {
                  const active = project.id === projectParam
                  const count = sets.filter((s) => s.projectId === project.id).length
                  return (
                    <button
                      key={project.id}
                      onClick={() => selectProject(project)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                        active
                          ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300'
                          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]'
                      }`}
                    >
                      {project.projectType === 'Ssh'
                        ? <Server size={14} className="shrink-0 text-violet-400" />
                        : <FolderInput size={14} className="shrink-0 text-gray-400" />}
                      <span className="min-w-0 flex-1 truncate" title={project.name}>{project.name}</span>
                      {count > 0 && <span className="shrink-0 text-[11px] text-gray-400">{count}</span>}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </aside>

        {/* Wiki 套件与页面 */}
        <aside className="flex h-full w-56 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="shrink-0 border-b border-gray-100 px-4 py-2.5 dark:border-gray-800">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{t('wiki.sets')}</h2>
            <p className="mt-0.5 text-[10px] leading-relaxed text-gray-400">{t('wiki.setsHint')}</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-3">
            {setsLoading ? (
              <div className="flex justify-center py-10"><Loader2 size={18} className="animate-spin text-gray-400" /></div>
            ) : visibleSets.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <BookText size={28} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                <p className="text-[12px] leading-relaxed text-gray-400">
                  {projectParam ? t('wiki.emptyForProject') : t('wiki.empty')}
                </p>
                {selectedProject && selectedProject.projectType === 'Local' && (
                  <button
                    onClick={() => generateMutation.mutate(selectedProject.id)}
                    disabled={generating}
                    className="mt-3 rounded-full bg-emerald-600 px-3.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {t('wiki.generateFirstSet')}
                  </button>
                )}
              </div>
            ) : (
              visibleSets.map((set) => {
                const expanded = set.setId === selectedSet?.setId
                return (
                  <div key={set.setId} className="group">
                    <div
                      className={`flex items-center gap-1 px-2 py-2 transition-colors ${
                        expanded
                          ? 'bg-emerald-50/60 dark:bg-emerald-950/20'
                          : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                      }`}
                    >
                      <button
                        onClick={() => selectSet(set.setId, set.projectId)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <BookText size={13} className={`shrink-0 ${expanded ? 'text-emerald-500' : 'text-gray-400'}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-gray-800 dark:text-gray-100" title={set.title}>
                            {set.title}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-gray-400">
                            {!projectParam && `${set.projectName} · `}
                            {t('wiki.setMeta', { time: formatTime(set.createdAt), n: set.pageCount })}
                            {set.isStale && <span className="ml-1 text-amber-500">{t('wiki.setStale')}</span>}
                          </span>
                        </span>
                      </button>
                      <button
                        onClick={() => confirm({
                          title: t('wiki.deleteSetTitle'),
                          message: t('wiki.deleteSetMessage', { title: set.title, n: set.pageCount }),
                          onConfirm: () => deleteSetMutation.mutate(set.setId),
                        })}
                        title={t('wiki.deleteSetTooltip')}
                        aria-label={t('wiki.deleteSetTooltip')}
                        className="shrink-0 rounded p-1 text-gray-400 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    {expanded && renderSetTree(set)}
                  </div>
                )
              })
            )}
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          {/* 页头 */}
          <div className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300">
              <BookText size={20} />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {selectedProject ? t('wiki.projectTitle', { name: selectedProject.name }) : t('wiki.title')}
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('wiki.headerSubtitle', { n: visibleSets.length })}
                {selectedSet && t('wiki.headerCurrentPages', { n: selectedSet.pageCount })}
                {selectedSet?.isStale && t('wiki.headerStale')}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {selectedSet && (
                <button
                  onClick={() => exportMutation.mutate(selectedSet.setId)}
                  disabled={exportMutation.isPending}
                  title={t('wiki.exportTitle')}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-[13px] font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                >
                  {exportMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  {t('common:export')}
                </button>
              )}

              {/* 生成模型选择 */}
              <div className="relative">
                <button
                  onClick={() => setModelPickerOpen((v) => !v)}
                  title={t('wiki.modelPickerTitle')}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-[13px] font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                >
                  <Cpu size={14} />
                  <span className="max-w-[140px] truncate">{chosenModelName ?? t('wiki.defaultModel')}</span>
                </button>
                {modelPickerOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setModelPickerOpen(false)} />
                    <div className="absolute right-0 top-9 z-20 w-56 rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                      <button
                        onClick={() => { setChosenModelId(undefined); setModelPickerOpen(false) }}
                        className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                          !chosenModelId
                            ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300'
                            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                        }`}
                      >
                        {t('wiki.defaultModelCompletion')}
                      </button>
                      {chatModels.map((model) => (
                        <button
                          key={model.id}
                          onClick={() => { setChosenModelId(model.id); setModelPickerOpen(false) }}
                          className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                            chosenModelId === model.id
                              ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300'
                              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate" title={model.displayName}>
                            {model.displayName}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={() => selectedProject && generateMutation.mutate(selectedProject.id)}
                disabled={!selectedProject || generating}
                title={
                  !selectedProject
                    ? t('wiki.selectProjectFirst')
                    : t('wiki.generateTitle')
                }
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-1.5 text-[13px] font-medium text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generating ? <Loader2 size={15} className="animate-spin" /> : <BookText size={15} />}
                {generating ? t('wiki.generating') : t('wiki.generate')}
              </button>
            </div>
          </div>

          {/* 提示条 */}
          {toast && (
            <div className={`flex shrink-0 items-center gap-2 px-6 py-2 text-[12px] ${
              toast.ok
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                : 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-300'
            }`}>
              {toast.ok ? <Check size={13} /> : <AlertCircle size={13} />}
              <span className="min-w-0 flex-1">{toast.text}</span>
              <button onClick={() => setToast(null)} className="shrink-0 rounded p-0.5 hover:bg-black/5"><X size={12} /></button>
            </div>
          )}

          {/* 生成进度 */}
          {activeJob && (activeJob.status === 0 || activeJob.status === 1) && (
            <div className="shrink-0 bg-blue-50 px-6 py-2.5 dark:bg-blue-950/30">
              <div className="flex items-center gap-2 text-[12px] text-blue-600 dark:text-blue-300">
                <Loader2 size={13} className="animate-spin" />
                <span className="min-w-0 flex-1">
                  {activeJob.stage}
                  {activeJob.totalPages > 0 && t('wiki.jobProgress', { done: activeJob.donePages, total: activeJob.totalPages })}
                  {t('wiki.jobBackground')}
                </span>
                <span className="shrink-0 tabular-nums">{activeJob.progress}%</span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/50">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${Math.max(2, activeJob.progress)}%` }}
                />
              </div>
            </div>
          )}
          {activeJob && activeJob.status === 3 && (
            <div className="flex shrink-0 items-center gap-2 bg-red-50 px-6 py-2 text-[12px] text-red-600 dark:bg-red-950/30 dark:text-red-300">
              <AlertCircle size={13} />
              <span className="min-w-0 flex-1">{t('wiki.jobFailed', { msg: activeJob.errorMessage ?? t('wiki.unknownError') })}</span>
            </div>
          )}

          {/* 部分页面失败：整套仍可用，提示可单独重试 */}
          {activeJob && activeJob.status === 2 && activeJob.warningMessage && (
            <div className="flex shrink-0 items-center gap-2 bg-amber-50 px-6 py-2 text-[12px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertCircle size={13} />
              <span className="min-w-0 flex-1">{activeJob.warningMessage}</span>
            </div>
          )}

          {/* 内容区：有选中文档就渲染，与是否按项目过滤无关 */}
          {selectedDoc ? (
            <div className="min-h-0 flex-1 overflow-y-auto bg-white dark:bg-gray-900">
              <article className="mx-auto max-w-4xl px-8 py-6">
                <header className="mb-5 border-b border-gray-100 pb-4 dark:border-gray-800">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{selectedDoc.title}</h2>
                    <button
                      onClick={() => { setRegeneratingId(selectedDoc.id); regenerateMutation.mutate(selectedDoc.id) }}
                      disabled={regeneratingId === selectedDoc.id}
                      title={t('wiki.regenerateTitle')}
                      className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-emerald-500 dark:hover:bg-gray-800"
                    >
                      {regeneratingId === selectedDoc.id
                        ? <Loader2 size={13} className="animate-spin" />
                        : <RefreshCw size={13} />}
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-gray-400">
                    {selectedDoc.projectName} · {formatTime(selectedDoc.createdAt)}
                    {selectedDoc.brief && ` · ${selectedDoc.brief}`}
                  </p>
                </header>
                <ThemedMarkdown source={selectedDoc.content} className="text-[13px]" />
              </article>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <BookText size={36} className="mx-auto mb-4 text-gray-300 dark:text-gray-600" />
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
                  {visibleSets.length > 0 ? t('wiki.pickSet') : t('wiki.empty')}
                </p>
                <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-gray-400">
                  {visibleSets.length > 0
                    ? t('wiki.pickSetHint')
                    : t('wiki.noWikiHint')}
                </p>
                {visibleSets.length === 0 && (
                  <button
                    onClick={() => navigate('/projects')}
                    className="mt-5 rounded-full border border-gray-200 px-4 py-2 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    {t('wiki.goProjects')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    } />
  )
}
