import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle, BookText, Check, Code, Copy, FolderInput, HardDrive, Loader2, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Server, Settings2, Trash2, X,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import ProjectsSidebar from '../components/projects/ProjectsSidebar'
import ProjectFormDialog from '../components/projects/ProjectFormDialog'
import GroupManagerDialog from '../components/projects/GroupManagerDialog'
import { projectService, projectGroupService } from '../services/projectService'
import { useConfirm } from '../components/confirm'
import type {
  IManagedProject, IProjectGroup, ICreateProjectRequest, IUpdateProjectRequest,
  ICreateProjectGroupRequest, IUpdateProjectGroupRequest, IProjectFilter,
} from '../types/project'

const ALL_PROJECTS_FILTER: IProjectFilter = { type: 'all' }

interface Section {
  key: string
  name: string | null
  projects: IManagedProject[]
}

/** 置顶优先，再按排序值、名称 */
function orderProjects(list: IManagedProject[]): IManagedProject[] {
  return [...list].sort((a, b) =>
    Number(b.isPinned) - Number(a.isPinned) ||
    a.sortOrder - b.sortOrder ||
    a.name.localeCompare(b.name))
}

/** 按当前目录组织展示分区：全部分组视图按分组分节，筛选视图平铺 */
function buildSections(list: IManagedProject[], groups: IProjectGroup[], groupBy: boolean, ungroupedName: string): Section[] {
  if (!groupBy) return list.length === 0 ? [] : [{ key: 'flat', name: null, projects: orderProjects(list) }]
  const sections: Section[] = []
  const sortedGroups = [...groups].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  for (const group of sortedGroups) {
    const items = orderProjects(list.filter((p) => p.groupId === group.id))
    if (items.length > 0) sections.push({ key: group.id, name: group.name, projects: items })
  }
  const ungrouped = orderProjects(list.filter((p) => !p.groupId))
  if (ungrouped.length > 0) sections.push({ key: '__ungrouped', name: ungroupedName, projects: ungrouped })
  return sections
}

/** 卡片字母头像：取名称首字，按字符哈希分配色系 */
const AVATAR_CLASSES = [
  'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300',
  'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300',
  'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300',
  'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300',
  'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300',
  'bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-300',
]

function avatarClass(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 997
  return AVATAR_CLASSES[hash % AVATAR_CLASSES.length]
}

export default function ProjectsPage() {
  const { t } = useTranslation('projects')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [filter, setFilter] = useState<IProjectFilter>(ALL_PROJECTS_FILTER)
  const [keyword, setKeyword] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<IManagedProject | null>(null)
  const [groupManagerOpen, setGroupManagerOpen] = useState(false)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const { data: projects = [], isLoading } = useQuery({ queryKey: ['projects'], queryFn: projectService.getAll })
  const { data: groups = [] } = useQuery({ queryKey: ['projectGroups'], queryFn: projectGroupService.getAll })

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text })
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 2600)
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['projects'] })
    queryClient.invalidateQueries({ queryKey: ['projectGroups'] })
  }

  const createMutation = useMutation({
    mutationFn: (data: ICreateProjectRequest) => projectService.create(data),
    onSuccess: () => { invalidate(); setFormOpen(false); showToast(true, t('page.created')) },
    onError: (e: Error) => showToast(false, e.message || t('page.createFailed')),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: IUpdateProjectRequest }) => projectService.update(id, data),
    onSuccess: () => { invalidate(); setFormOpen(false); setEditing(null); showToast(true, t('page.saved')) },
    onError: (e: Error) => showToast(false, e.message || t('page.saveFailed')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => projectService.delete(id),
    onSuccess: () => { invalidate(); showToast(true, t('page.deleted')) },
    onError: (e: Error) => showToast(false, e.message || t('page.deleteFailed')),
  })

  const sortMutation = useMutation({
    mutationFn: (items: { id: string; sortOrder: number }[]) => projectService.sort(items),
    onSuccess: invalidate,
    onError: (e: Error) => showToast(false, e.message || t('page.sortFailed')),
  })

  const openMutation = useMutation({
    mutationFn: (id: string) => projectService.open(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      showToast(true, t('page.openedInExplorer'))
    },
    onError: (e: Error) => showToast(false, e.message),
  })

  const createGroupMutation = useMutation({
    mutationFn: (data: ICreateProjectGroupRequest) => projectGroupService.create(data),
    onSuccess: () => invalidate(),
    onError: (e: Error) => showToast(false, e.message || t('page.groupCreateFailed')),
  })

  const updateGroupMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: IUpdateProjectGroupRequest }) => projectGroupService.update(id, data),
    onSuccess: invalidate,
    onError: (e: Error) => showToast(false, e.message || t('page.groupSaveFailed')),
  })

  const deleteGroupMutation = useMutation({
    mutationFn: (id: string) => projectGroupService.delete(id),
    onSuccess: () => { invalidate(); setFilter(ALL_PROJECTS_FILTER); showToast(true, t('page.groupDeleted')) },
    onError: (e: Error) => showToast(false, e.message || t('page.groupDeleteFailed')),
  })

  /** 当前目录视图：目录筛选 + 关键字 */
  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return projects.filter((p) => {
      if (filter.type === 'group' && p.groupId !== filter.id) return false
      if (filter.type === 'ungrouped' && p.groupId) return false
      if (filter.type === 'category' && p.category !== filter.id) return false
      if (filter.type === 'tag' && !p.tags.includes(filter.id ?? '')) return false
      if (!kw) return true
      const groupName = groups.find((g) => g.id === p.groupId)?.name ?? ''
      return [p.name, p.directoryPath, p.category, p.description, groupName, ...p.tags]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(kw))
    })
  }, [projects, groups, filter, keyword])

  const sections = useMemo(
    () => buildSections(visible, groups, filter.type === 'all' || filter.type === 'category' || filter.type === 'tag', t('page.ungrouped')),
    [visible, groups, filter.type, t],
  )

  const moveToGroup = (project: IManagedProject, groupId: string | null) => {
    const base: IUpdateProjectRequest = {
      name: project.name,
      description: project.description,
      projectType: project.projectType,
      directoryPath: project.directoryPath,
      groupId: groupId ?? undefined,
      category: project.category,
      tags: project.tags,
      isPinned: project.isPinned,
      sortOrder: project.sortOrder,
    }
    if (project.projectType === 'Ssh') {
      base.sshHost = project.sshHost
      base.sshPort = project.sshPort
      base.sshUser = project.sshUser
      base.sshAuthType = project.sshAuthType
      base.sshKeyPath = project.sshKeyPath
    }
    updateMutation.mutate({ id: project.id, data: base })
    setMenuFor(null)
  }

  const handleCardDrop = (section: Section, targetId: string, draggedId: string) => {
    if (!draggedId || draggedId === targetId) return
    const ids = section.projects.map((p) => p.id)
    const from = ids.indexOf(draggedId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    const next = [...ids]
    next.splice(to, 0, ...next.splice(from, 1))
    sortMutation.mutate(next.map((id, index) => ({ id, sortOrder: index })))
  }

  const copyPath = (project: IManagedProject) => {
    void navigator.clipboard.writeText(project.directoryPath)
    setCopiedId(project.id)
    window.setTimeout(() => setCopiedId((id) => (id === project.id ? null : id)), 1600)
  }

  const openCreate = () => { setEditing(null); setFormOpen(true) }
  const openEdit = (project: IManagedProject) => { setEditing(project); setFormOpen(true) }

  const cardActionClass =
    'rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800'

  return (
    <AppLayout showSidebar={false} mainContent={
      <div className="flex h-full min-w-0 flex-1 bg-gray-50 dark:bg-gray-950">
        <ProjectsSidebar
          groups={groups}
          projects={projects}
          filter={filter}
          onFilterChange={setFilter}
          onManageGroups={() => setGroupManagerOpen(true)}
          onMoveToGroup={(projectId, groupId) => {
            const project = projects.find((p) => p.id === projectId)
            if (project) moveToGroup(project, groupId)
          }}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* 页头 */}
          <div className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">
              <FolderInput size={20} />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('page.title')}</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('page.subtitle', { projects: projects.length, groups: groups.length })}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder={t('page.searchPlaceholder')}
                  className="w-56 rounded-full border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-3 text-[13px] outline-none transition-all focus:border-blue-300 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:focus:bg-gray-900"
                />
              </div>
              <button
                onClick={() => setGroupManagerOpen(true)}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-[13px] font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
              >
                <Settings2 size={14} />
                {t('page.manageGroups')}
              </button>
              <button
                onClick={openCreate}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-1.5 text-[13px] font-medium text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-[0.97]"
              >
                <Plus size={15} />
                {t('page.newProject')}
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

          {/* 项目列表 */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {isLoading ? (
              <div className="flex justify-center py-24"><Loader2 size={24} className="animate-spin text-indigo-500" /></div>
            ) : projects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 py-16 text-center dark:border-gray-800">
                <FolderInput size={36} className="mx-auto mb-4 text-gray-300 dark:text-gray-600" />
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{t('page.emptyTitle')}</p>
                <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-gray-400">
                  {t('page.emptyHint')}
                </p>
                <button
                  onClick={openCreate}
                  className="mt-5 rounded-full bg-indigo-600 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-indigo-700"
                >
                  {t('page.createFirst')}
                </button>
              </div>
            ) : visible.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 py-16 text-center dark:border-gray-800">
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{t('page.noMatchTitle')}</p>
                <p className="mt-1 text-xs text-gray-400">{t('page.noMatchHint')}</p>
              </div>
            ) : (
              <div className="space-y-6">
                {sections.map((section) => (
                  <section key={section.key}>
                    {section.name && (
                      <h2 className="mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-gray-600 dark:text-gray-300">
                        {section.name}
                        <span className="text-[11px] font-normal text-gray-400">{section.projects.length}</span>
                      </h2>
                    )}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {section.projects.map((project) => (
                        <div
                          key={project.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('application/x-project-id', project.id)
                            e.dataTransfer.effectAllowed = 'move'
                          }}
                          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('ring-1', 'ring-blue-300') }}
                          onDragLeave={(e) => e.currentTarget.classList.remove('ring-1', 'ring-blue-300')}
                          onDrop={(e) => {
                            e.preventDefault()
                            e.currentTarget.classList.remove('ring-1', 'ring-blue-300')
                            handleCardDrop(section, project.id, e.dataTransfer.getData('application/x-project-id'))
                          }}
                          className="group relative flex flex-col rounded-2xl border border-gray-200 bg-white p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
                        >
                          <div className="flex items-start gap-3">
                            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base font-bold ${avatarClass(project.name)}`}>
                              {project.name.slice(0, 1)}
                            </span>
                            <div className="min-w-0 flex-1 pr-32">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-[13px] font-medium text-gray-800 dark:text-gray-100" title={project.name}>
                                  {project.name}
                                </span>
                                {project.isPinned && <Pin size={11} className="shrink-0 text-amber-400" />}
                                <span className={`flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                  project.projectType === 'Ssh'
                                    ? 'bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300'
                                    : 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'
                                }`}>
                                  {project.projectType === 'Ssh' ? <Server size={9} /> : <HardDrive size={9} />}
                                  {project.projectType === 'Ssh' ? 'SSH' : t('page.typeLocal')}
                                </span>
                              </div>
                              <p
                                className="mt-0.5 truncate font-mono text-[11px] text-gray-400"
                                title={project.projectType === 'Ssh'
                                  ? `${project.sshUser ? `${project.sshUser}@` : ''}${project.sshHost}:${project.sshPort} ${project.directoryPath}`
                                  : project.directoryPath}
                              >
                                {project.projectType === 'Ssh'
                                  ? `${project.sshUser ? `${project.sshUser}@` : ''}${project.sshHost}:${project.sshPort} · ${project.directoryPath}`
                                  : project.directoryPath}
                              </p>
                            </div>
                          </div>

                          {project.description && (
                            <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-gray-500 dark:text-gray-400">
                              {project.description}
                            </p>
                          )}

                          {/* 归类信息 */}
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            {project.groupName && (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-600 dark:bg-amber-950/40 dark:text-amber-300">
                                {project.groupName}
                              </span>
                            )}
                            {project.category && (
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
                                {project.category}
                              </span>
                            )}
                            {project.tags.map((tag) => (
                              <span key={tag} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                                {tag}
                              </span>
                            ))}
                          </div>

                          {/* 操作区：空间不足时自动换行，避免操作按钮被裁出卡片 */}
                          <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1.5 border-t border-gray-100 pt-2.5 dark:border-gray-800">
                            {project.projectType === 'Local' && (
                              <button
                                onClick={() => openMutation.mutate(project.id)}
                                className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                              >
                                <HardDrive size={12} />
                                {t('page.openDirectory')}
                              </button>
                            )}
                            <button
                              onClick={() => copyPath(project)}
                              className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                            >
                              {copiedId === project.id ? <Check size={12} /> : <Copy size={12} />}
                              {copiedId === project.id ? t('common:copied') : t('page.copyPath')}
                            </button>
                            {/* 与 Code 工作区互通：直接跳到对应工作项目 */}
                            <button
                              onClick={() => navigate(project.workProjectId ? `/code?project=${project.workProjectId}` : '/code')}
                              className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/40"
                            >
                              <Code size={12} />
                              {t('page.openInCode')}
                            </button>
                            {/* 生成项目 Wiki：本地项目进入即触发生成，远程项目仅跳转（不支持） */}
                            <button
                              onClick={() => navigate(
                                project.projectType === 'Local'
                                  ? `/wiki?project=${project.id}&generate=1`
                                  : `/wiki?project=${project.id}`,
                              )}
                              title={project.projectType === 'Local' ? t('page.generateWikiTitle') : t('page.wikiRemoteUnsupported')}
                              className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                            >
                              <BookText size={12} />
                              {t('page.generateWiki')}
                            </button>
                            {/* 管理操作：固定在卡片右上角、始终可见，不再占用操作行导致底部留空 */}
                            <div className="absolute right-2.5 top-2.5 z-10 flex shrink-0 items-center gap-0.5 rounded-lg bg-gray-50/80 p-0.5 transition dark:bg-white/[0.04] dark:group-hover:bg-white/[0.07]">
                              <button
                                onClick={() => updateMutation.mutate({
                                  id: project.id,
                                  data: {
                                    ...projectToRequest(project),
                                    isPinned: !project.isPinned,
                                  },
                                })}
                                title={project.isPinned ? t('page.unpin') : t('page.pin')}
                                aria-label={project.isPinned ? t('page.unpin') : t('page.pin')}
                                className={cardActionClass}
                              >
                                {project.isPinned ? <PinOff size={13} /> : <Pin size={13} />}
                              </button>
                              <button
                                onClick={() => openEdit(project)}
                                title={t('common:edit')}
                                aria-label={t('common:edit')}
                                className={cardActionClass}
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                onClick={() => setMenuFor(menuFor === project.id ? null : project.id)}
                                title={t('page.moveToGroup')}
                                aria-label={t('page.moveToGroup')}
                                className={cardActionClass}
                              >
                                <MoreHorizontal size={13} />
                              </button>
                              <button
                                onClick={() => confirm({
                                  title: t('page.deleteTitle'),
                                  message: t('page.deleteConfirm', { name: project.name }),
                                  onConfirm: () => deleteMutation.mutate(project.id),
                                })}
                                title={t('common:delete')}
                                aria-label={t('common:delete')}
                                className={`${cardActionClass} hover:text-red-500`}
                              >
                                <Trash2 size={13} />
                              </button>

                              {/* 移动分组菜单 */}
                              {menuFor === project.id && (
                                <>
                                  <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
                                  <div className="absolute right-0 top-7 z-20 w-36 rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                                    <p className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">{t('page.moveTo')}</p>
                                    <button
                                      onClick={() => moveToGroup(project, null)}
                                      className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[12px] text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                                    >
                                      {t('page.ungrouped')}
                                    </button>
                                    {groups.map((group) => (
                                      <button
                                        key={group.id}
                                        onClick={() => moveToGroup(project, group.id)}
                                        disabled={project.groupId === group.id}
                                        className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[12px] text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-700"
                                      >
                                        {group.name}
                                      </button>
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 新建 / 编辑项目 */}
        {formOpen && (
          <ProjectFormDialog
            project={editing}
            groups={groups}
            projects={projects}
            pending={createMutation.isPending || updateMutation.isPending}
            onCreateGroup={async (name) => {
              const created = await projectGroupService.create({ name })
              invalidate()
              return created
            }}
            onSubmit={(data) => {
              if (editing) updateMutation.mutate({ id: editing.id, data: data as IUpdateProjectRequest })
              else createMutation.mutate(data as ICreateProjectRequest)
            }}
            onClose={() => { setFormOpen(false); setEditing(null) }}
          />
        )}

        {/* 分组管理 */}
        {groupManagerOpen && (
          <GroupManagerDialog
            groups={groups}
            pending={createGroupMutation.isPending}
            onCreate={(data) => createGroupMutation.mutate(data)}
            onUpdate={(id, data) => updateGroupMutation.mutate({ id, data })}
            onDelete={(id) => deleteGroupMutation.mutate(id)}
            onClose={() => setGroupManagerOpen(false)}
          />
        )}
      </div>
    } />
  )
}

/** 把项目当前值转成更新请求（保留未修改字段） */
function projectToRequest(project: IManagedProject): IUpdateProjectRequest {
  const base: IUpdateProjectRequest = {
    name: project.name,
    description: project.description,
    projectType: project.projectType,
    directoryPath: project.directoryPath,
    groupId: project.groupId ?? undefined,
    category: project.category,
    tags: project.tags,
    isPinned: project.isPinned,
    sortOrder: project.sortOrder,
  }
  if (project.projectType === 'Ssh') {
    base.sshHost = project.sshHost
    base.sshPort = project.sshPort
    base.sshUser = project.sshUser
    base.sshAuthType = project.sshAuthType
    base.sshKeyPath = project.sshKeyPath
  }
  return base
}
