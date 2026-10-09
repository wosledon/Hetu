import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, BookText, Check, FolderInput, Loader2, Server, Trash2, X } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import ThemedMarkdown from '../components/ThemedMarkdown'
import { projectService } from '../services/projectService'
import { wikiService } from '../services/wikiService'
import { useConfirm } from '../components/confirm'
import type { IManagedProject } from '../types/project'
import type { IWikiDocument } from '../types/wiki'

/** 一套 Wiki：一次生成的所有页面（总览 + 主题页） */
interface WikiSet {
  setId: string
  projectId: string
  projectName: string
  title: string
  createdAt: string
  pages: IWikiDocument[]
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMins = Math.floor((now.getTime() - date.getTime()) / 60000)
  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins} 分钟前`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours} 小时前`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays} 天前`
  return date.toLocaleDateString('zh-CN')
}

export default function WikiPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [searchParams, setSearchParams] = useSearchParams()
  const projectParam = searchParams.get('project')
  const autoGenerate = searchParams.get('generate') === '1'

  const [selectedSetId, setSelectedSetId] = useState<string | null>(null)
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const autoGenerateHandled = useRef(false)

  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: projectService.getAll,
  })

  const { data: allDocs = [], isLoading: docsLoading } = useQuery({
    queryKey: ['wiki', 'all'],
    queryFn: () => wikiService.getAll(),
  })

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

  /** 按套件聚合：新套件在前，套件内总览在前 */
  const sets = useMemo<WikiSet[]>(() => {
    const bySet = new Map<string, IWikiDocument[]>()
    for (const doc of allDocs) {
      const list = bySet.get(doc.setId)
      if (list) list.push(doc)
      else bySet.set(doc.setId, [doc])
    }
    return [...bySet.values()]
      .map((pages) => {
        const sorted = [...pages].sort((a, b) => a.sortOrder - b.sortOrder)
        return {
          setId: sorted[0].setId,
          projectId: sorted[0].projectId,
          projectName: sorted[0].projectName,
          title: sorted[0].title,
          createdAt: sorted[0].createdAt,
          pages: sorted,
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [allDocs])

  const visibleSets = useMemo(
    () => (projectParam ? sets.filter((s) => s.projectId === projectParam) : sets),
    [sets, projectParam],
  )

  // 选中项：优先用户点选，列表变化（切换项目 / 删除 / 新生成）时回落到最新
  const selectedSet = visibleSets.find((s) => s.setId === selectedSetId) ?? visibleSets[0] ?? null
  const selectedDoc = selectedSet
    ? selectedSet.pages.find((p) => p.id === selectedDocId) ?? selectedSet.pages[0] ?? null
    : null

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text })
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 2600)
  }

  const generateMutation = useMutation({
    mutationFn: (projectId: string) => wikiService.generate(projectId),
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: ['wiki', 'all'] })
      setSelectedSetId(doc.setId)
      setSelectedDocId(doc.id)
      showToast(true, 'Wiki 已生成')
    },
    onError: (e: Error) => showToast(false, e.message || '生成失败'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => wikiService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wiki', 'all'] })
      setSelectedDocId(null)
      showToast(true, '已删除')
    },
    onError: (e: Error) => showToast(false, e.message || '删除失败'),
  })

  // 从项目页带 generate=1 跳转进来：自动触发一次生成，并清掉 URL 参数
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

  const generating = generateMutation.isPending

  const selectProject = (project: IManagedProject | null) => {
    const params = new URLSearchParams(searchParams)
    if (project) params.set('project', project.id)
    else params.delete('project')
    setSearchParams(params, { replace: true })
  }

  const pageCount = visibleSets.reduce((sum, s) => sum + s.pages.length, 0)

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
              <span className="min-w-0 flex-1">全部文档</span>
              <span className="shrink-0 text-[11px] text-gray-400">{sets.length}</span>
            </button>

            <div className="mt-5 px-2.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">项目</span>
            </div>
            <div className="mt-1 space-y-0.5">
              {projectsLoading ? (
                <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-gray-400" /></div>
              ) : orderedProjects.length === 0 ? (
                <p className="px-2.5 py-1 text-[11px] leading-relaxed text-gray-400">还没有项目，请先到「项目」页添加</p>
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
          <div className="min-h-0 flex-1 overflow-y-auto py-3">
            {docsLoading ? (
              <div className="flex justify-center py-10"><Loader2 size={18} className="animate-spin text-gray-400" /></div>
            ) : visibleSets.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <BookText size={28} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                <p className="text-[12px] leading-relaxed text-gray-400">
                  {projectParam ? '该项目还没有 Wiki' : '还没有 Wiki 文档'}
                </p>
                {selectedProject?.projectType === 'Local' && (
                  <button
                    onClick={() => generateMutation.mutate(selectedProject.id)}
                    disabled={generating}
                    className="mt-3 rounded-full bg-emerald-600 px-3.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                  >
                    生成第一套
                  </button>
                )}
                {selectedProject && selectedProject.projectType !== 'Local' && (
                  <p className="mt-2 text-[11px] leading-relaxed text-gray-400">远程（SSH）项目暂不支持生成 Wiki</p>
                )}
              </div>
            ) : (
              visibleSets.map((set) => {
                const expanded = set.setId === selectedSet?.setId
                return (
                  <div key={set.setId}>
                    <button
                      onClick={() => { setSelectedSetId(set.setId); setSelectedDocId(null) }}
                      className={`flex w-full items-center gap-2 px-4 py-2 text-left transition-colors ${
                        expanded
                          ? 'bg-emerald-50/60 dark:bg-emerald-950/20'
                          : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                      }`}
                    >
                      <BookText size={13} className={`shrink-0 ${expanded ? 'text-emerald-500' : 'text-gray-400'}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-gray-800 dark:text-gray-100" title={set.title}>
                          {set.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-gray-400">
                          {!projectParam && `${set.projectName} · `}
                          {formatTime(set.createdAt)} · {set.pages.length} 页
                        </span>
                      </span>
                    </button>
                    {expanded && set.pages.map((page) => (
                      <div
                        key={page.id}
                        onClick={() => setSelectedDocId(page.id)}
                        className={`group flex cursor-pointer items-center gap-2 border-l-2 py-1.5 pl-7 pr-3 transition-colors ${
                          page.id === selectedDoc?.id
                            ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/20'
                            : 'border-transparent hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate text-[12px] text-gray-600 dark:text-gray-300" title={page.title}>
                          {page.sortOrder === 0 ? '★ ' : ''}{page.title}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            confirm({
                              title: '删除页面',
                              message: `删除「${page.title}」？删除后不可恢复。`,
                              onConfirm: () => deleteMutation.mutate(page.id),
                            })
                          }}
                          title="删除"
                          aria-label="删除"
                          className="shrink-0 rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
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
                {selectedProject ? `${selectedProject.name} · Wiki` : 'Wiki 文档'}
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                AI 依据项目本地目录资料生成的多页文档（总览 + 主题页 + 架构图） · {visibleSets.length} 套 / {pageCount} 页
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => selectedProject && generateMutation.mutate(selectedProject.id)}
                disabled={!selectedProject || generating || selectedProject.projectType !== 'Local'}
                title={
                  !selectedProject
                    ? '请先选择项目'
                    : selectedProject.projectType !== 'Local'
                      ? '远程（SSH）项目暂不支持生成 Wiki'
                      : '规划并生成整套 Wiki（多页，耗时较长）'
                }
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-1.5 text-[13px] font-medium text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generating ? <Loader2 size={15} className="animate-spin" /> : <BookText size={15} />}
                {generating ? '生成中…' : '生成 Wiki'}
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

          {generating && (
            <div className="flex shrink-0 items-center gap-2 bg-blue-50 px-6 py-2 text-[12px] text-blue-600 dark:bg-blue-950/30 dark:text-blue-300">
              <Loader2 size={13} className="animate-spin" />
              正在规划分页并生成整套 Wiki，可能需要几分钟，请稍候…
            </div>
          )}

          {/* 内容区 */}
          {!projectParam ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <BookText size={36} className="mx-auto mb-4 text-gray-300 dark:text-gray-600" />
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300">从左侧选择一个项目</p>
                <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-gray-400">
                  选择项目后可查看已生成的 Wiki，或点击「生成 Wiki」读取项目本地目录资料，由 AI 规划并撰写整套多页文档。
                </p>
                <button
                  onClick={() => navigate('/projects')}
                  className="mt-5 rounded-full border border-gray-200 px-4 py-2 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  去项目页看看
                </button>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto bg-white dark:bg-gray-900">
              {selectedDoc ? (
                <article className="mx-auto max-w-4xl px-8 py-6">
                  <header className="mb-5 border-b border-gray-100 pb-4 dark:border-gray-800">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{selectedDoc.title}</h2>
                    <p className="mt-1 text-[11px] text-gray-400">
                      {selectedDoc.projectName} · {formatTime(selectedDoc.createdAt)}
                    </p>
                  </header>
                  <ThemedMarkdown source={selectedDoc.content} className="text-[13px]" />
                </article>
              ) : (
                <p className="py-16 text-center text-xs text-gray-400">选择一套 Wiki 开始阅读</p>
              )}
            </div>
          )}
        </div>
      </div>
    } />
  )
}
