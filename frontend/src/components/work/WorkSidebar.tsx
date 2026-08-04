import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Trash2, Folder, FolderOpen, MessageSquare, Pencil, Check, X, ChevronRight, ChevronDown } from 'lucide-react'
import { workProjectService, workSessionService } from '../../services/workService'
import type { IWorkProject, IWorkSession } from '../../types/work'

interface WorkSidebarProps {
  selectedProjectId?: string
  selectedSessionId?: string
  onSelectProject: (project: IWorkProject) => void
  onSelectSession: (session: IWorkSession) => void
}

const PROJECT_COLORS = ['blue', 'green', 'purple', 'yellow', 'red', 'indigo', 'pink', 'orange', 'teal'] as const
type ProjectColor = (typeof PROJECT_COLORS)[number]
const COLOR_CLASSES: Record<ProjectColor, string> = {
  blue: 'bg-blue-500', green: 'bg-green-500', purple: 'bg-purple-500', yellow: 'bg-yellow-500',
  red: 'bg-red-500', indigo: 'bg-indigo-500', pink: 'bg-pink-500', orange: 'bg-orange-500', teal: 'bg-teal-500',
}

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) { hash = (hash << 5) - hash + str.charCodeAt(i); hash |= 0 }
  return Math.abs(hash)
}

function resolveColor(project: IWorkProject): ProjectColor {
  const c = project.color?.toLowerCase()
  return (c && COLOR_CLASSES[c as ProjectColor]) ? (c as ProjectColor) : PROJECT_COLORS[hashString(project.name) % PROJECT_COLORS.length]
}

function ProjectNode({
  project,
  expanded,
  selectedProjectId,
  selectedSessionId,
  onToggle,
  onSelectProject,
  onSelectSession,
  onDeleteProject,
  onRenameProject,
}: {
  project: IWorkProject
  expanded: boolean
  selectedProjectId?: string
  selectedSessionId?: string
  onToggle: () => void
  onSelectProject: (p: IWorkProject) => void
  onSelectSession: (s: IWorkSession) => void
  onDeleteProject: (id: string) => void
  onRenameProject: (p: IWorkProject) => void
}) {
  const queryClient = useQueryClient()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(project.name)
  const color = resolveColor(project)

  const { data: sessions = [] } = useQuery({
    queryKey: ['workSessions', project.id],
    queryFn: () => workProjectService.getSessions(project.id),
    enabled: expanded,
  })

  const createSession = useMutation({
    mutationFn: workSessionService.create,
    onSuccess: (newSession) => {
      queryClient.invalidateQueries({ queryKey: ['workSessions', project.id] })
      queryClient.invalidateQueries({ queryKey: ['workProjects'] })
      onSelectProject(project)
      onSelectSession(newSession)
    },
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => workSessionService.update(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workSessions', project.id] })
      setRenaming(false)
    },
  })

  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [sessionName, setSessionName] = useState('')

  return (
    <div className="mb-0.5">
      <div
        onClick={() => { onSelectProject(project); onToggle() }}
        className={`group flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors ${
          selectedProjectId === project.id ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'
        }`}
      >
        <button onClick={(e) => { e.stopPropagation(); onToggle() }} className="shrink-0 text-gray-400">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-white ${COLOR_CLASSES[color]}`}>
          {expanded ? <FolderOpen size={11} /> : <Folder size={11} />}
        </div>
        <span className={`min-w-0 flex-1 truncate text-[13px] ${selectedProjectId === project.id ? 'font-medium text-blue-700 dark:text-blue-200' : 'text-gray-700 dark:text-gray-200'}`}>
          {project.name}
        </span>
        <span className="shrink-0 text-[10px] text-gray-400">{project.sessionCount}</span>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-all group-hover:opacity-100">
          <button
            onClick={(e) => { e.stopPropagation(); setRenaming(true); setName(project.name) }}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
          >
            <Pencil size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteProject(project.id) }}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-red-500 dark:hover:bg-gray-700"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {renaming && (
        <div className="flex items-center gap-1 px-2 py-1" style={{ paddingLeft: '36px' }}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) {
                onRenameProject({ ...project, name: name.trim() })
                setRenaming(false)
              }
              if (e.key === 'Escape') setRenaming(false)
            }}
            className="min-w-0 flex-1 rounded border border-blue-300 bg-white px-1.5 py-0.5 text-[12px] outline-none dark:bg-gray-800"
          />
          <button onClick={() => { if (name.trim()) onRenameProject({ ...project, name: name.trim() }); setRenaming(false) }} className="p-0.5 text-emerald-500"><Check size={12} /></button>
          <button onClick={() => setRenaming(false)} className="p-0.5 text-gray-400"><X size={12} /></button>
        </div>
      )}

      {expanded && (
        <div className="mt-0.5">
          {sessions.map((session) => {
            const active = selectedSessionId === session.id
            return (
              <div
                key={session.id}
                onClick={() => { onSelectProject(project); onSelectSession(session) }}
                className={`flex cursor-pointer items-center gap-1.5 rounded-lg py-1 pl-2 pr-1.5 transition-colors ${active ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'}`}
                style={{ paddingLeft: '40px' }}
              >
                <MessageSquare size={11} className={`shrink-0 ${active ? 'text-blue-500' : 'text-gray-400'}`} />
                {renamingSessionId === session.id ? (
                  <input
                    autoFocus
                    value={sessionName}
                    onChange={(e) => setSessionName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && sessionName.trim()) renameMutation.mutate({ id: session.id, title: sessionName.trim() })
                      if (e.key === 'Escape') setRenamingSessionId(null)
                    }}
                    className="min-w-0 flex-1 rounded border border-blue-300 bg-white px-1 py-0.5 text-[12px] outline-none dark:bg-gray-800"
                  />
                ) : (
                  <span className={`min-w-0 flex-1 truncate text-[12px] ${active ? 'font-medium text-blue-700 dark:text-blue-200' : 'text-gray-600 dark:text-gray-300'}`}>
                    {session.title || '新会话'}
                  </span>
                )}
              </div>
            )
          })}
          {sessions.length === 0 && (
            <div className="py-0.5 text-[11px] text-gray-400" style={{ paddingLeft: '40px' }}>空</div>
          )}
          <button
            onClick={() => createSession.mutate({ projectId: project.id, title: '' })}
            className="flex items-center gap-1 py-0.5 text-[11px] text-gray-400 transition-colors hover:text-blue-500"
            style={{ paddingLeft: '40px' }}
          >
            <Plus size={10} /> 新建会话
          </button>
        </div>
      )}
    </div>
  )
}

export default function WorkSidebar({ selectedProjectId, selectedSessionId, onSelectProject, onSelectSession }: WorkSidebarProps) {
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [isAdding, setIsAdding] = useState(false)
  const [name, setName] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [createError, setCreateError] = useState('')

  const { data: projects = [] } = useQuery({
    queryKey: ['workProjects'],
    queryFn: workProjectService.getAll,
  })

  const search = searchTerm.trim().toLowerCase()
  const filtered = projects.filter((p) => !search || p.name.toLowerCase().includes(search))

  const createProject = useMutation({
    mutationFn: workProjectService.create,
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['workProjects'] })
      setIsAdding(false)
      setName('')
      setRootPath('')
      setCreateError('')
      setExpandedProjects((prev) => new Set(prev).add(project.id))
      onSelectProject(project)
    },
    onError: (err) => {
      setCreateError(err instanceof Error ? err.message : '创建项目失败')
    },
  })

  const deleteProject = useMutation({
    mutationFn: workProjectService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workProjects'] })
      queryClient.invalidateQueries({ queryKey: ['workSessions'] })
    },
  })

  const renameProject = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => workProjectService.update(id, { name, rootPath: '', sortOrder: 0 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workProjects'] }),
  })

  // 选中项目时自动展开
  useEffect(() => {
    if (selectedProjectId) {
      setExpandedProjects((prev) => {
        if (prev.has(selectedProjectId)) return prev
        const next = new Set(prev)
        next.add(selectedProjectId)
        return next
      })
    }
  }, [selectedProjectId])

  const handleCreate = () => {
    if (!name.trim()) { setCreateError('请输入项目名称'); return }
    if (!rootPath.trim()) { setCreateError('请输入项目目录'); return }
    setCreateError('')
    createProject.mutate({ name: name.trim(), rootPath: rootPath.trim() })
  }

  return (
    <div className="flex w-60 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-100 p-3 dark:border-gray-800">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">项目</h2>
          <button
            onClick={() => setIsAdding(true)}
            title="新建项目"
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-300"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜索..."
            className="w-full rounded-lg border border-gray-200/80 bg-gray-50/80 py-1.5 pl-7 pr-2 text-[13px] outline-none transition-all placeholder:text-gray-400 focus:border-blue-300 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:focus:border-blue-600"
          />
        </div>
      </div>

      {isAdding && (
        <div className="border-b border-gray-100 p-3 dark:border-gray-800">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="项目名称"
            className="mb-1.5 w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-300 focus:bg-white dark:border-gray-700 dark:bg-gray-800"
          />
          <input
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="本地目录，如 D:\repos\MyProject"
            className="mb-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[12px] outline-none focus:border-blue-300 focus:bg-white dark:border-gray-700 dark:bg-gray-800"
          />
          <div className="flex gap-1.5">
            <button onClick={handleCreate} className="rounded-lg bg-blue-500 px-3 py-1 text-xs font-medium text-white hover:bg-blue-600">创建</button>
            <button onClick={() => { setIsAdding(false); setName(''); setRootPath(''); setCreateError('') }} className="rounded-lg border border-gray-200 px-3 py-1 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">取消</button>
          </div>
          {createError && (
            <p className="mt-1.5 text-[11px] text-red-500 dark:text-red-400">{createError}</p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {filtered.map((project) => (
          <ProjectNode
            key={project.id}
            project={project}
            expanded={expandedProjects.has(project.id)}
            selectedProjectId={selectedProjectId}
            selectedSessionId={selectedSessionId}
            onToggle={() => {
              setExpandedProjects((prev) => {
                const next = new Set(prev)
                if (next.has(project.id)) next.delete(project.id)
                else next.add(project.id)
                return next
              })
            }}
            onSelectProject={onSelectProject}
            onSelectSession={onSelectSession}
            onDeleteProject={(id) => deleteProject.mutate(id)}
            onRenameProject={(p) => renameProject.mutate({ id: p.id, name: p.name })}
          />
        ))}
        {filtered.length === 0 && (
          <div className="py-8 text-center text-xs text-gray-400">暂无项目</div>
        )}
      </div>
    </div>
  )
}
