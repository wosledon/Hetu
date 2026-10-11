import { useState, forwardRef, useImperativeHandle } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Folder, FolderOpen, MessageSquare, Pencil, Check, X, ChevronRight, ChevronDown, Settings, Server, HardDrive, Loader2, Wifi, CornerLeftUp } from 'lucide-react'
import { workProjectService, workSessionService, workSshService, workBrowseService } from '../../services/workService'
import { useConfirm } from '../../components/confirm'
import Select from '../Select'
import { useUIStore } from '../../stores/uiStore'
import type { IDirListing } from '../../services/workService'
import type { IWorkProject, IWorkSession } from '../../types/work'
import WorkProjectSettings from './WorkProjectSettings'

interface WorkSidebarProps {
  selectedProjectId?: string
  selectedSessionId?: string
  onSelectProject: (project: IWorkProject) => void
  onSelectSession: (session: IWorkSession) => void
  onProjectDeleted?: (projectId: string) => void
  onSessionDeleted?: (sessionId: string) => void
  /** 嵌在合并侧栏里：单栏树形展示、不占固定宽度、不画右边框 */
  embedded?: boolean
  /** 搜索词由一级菜单输入框提供（同时用于会话检索） */
  search?: string
}

const joinDirPath = (base: string, name: string) => {
  if (!base) return name
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/'
  return base.endsWith(sep) ? base + name : `${base}${sep}${name}`
}

/** 目录选择面板：本地/远程目录逐级浏览，"选择当前目录"回填输入框 */
function DirBrowser({
  kind,
  ssh,
  onPick,
  onClose,
}: {
  kind: 'local' | 'remote'
  ssh?: { host: string; port: number; user?: string; authType?: string; keyPath?: string; password?: string }
  onPick: (path: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation('work')
  const [path, setPath] = useState('')
  const listing = useQuery<IDirListing>({
    queryKey: kind === 'local' ? ['workLocalDirs', path] : ['workRemoteDirs', ssh?.host, ssh?.port, ssh?.user, path],
    queryFn: () => kind === 'local'
      ? workBrowseService.localDirs(path || undefined)
      : workSshService.remoteDirs({ ...ssh!, path: path || '~' }),
    enabled: kind === 'local' || !!ssh?.host.trim(),
    retry: false,
  })
  const data = listing.data

  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50/70 p-2 dark:border-gray-700 dark:bg-gray-800/40">
      <div className="mb-1.5 flex items-center gap-1.5">
        <FolderOpen size={13} className="shrink-0 text-gray-400" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-600 dark:text-gray-300" title={data?.current || ''}>
          {data?.current || '—'}
        </span>
        <button
          onClick={onClose}
          className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
          title={t('sidebar.closeBrowse')}
          aria-label={t('sidebar.closeDirBrowser')}
        >
          <X size={12} />
        </button>
      </div>
      <div className="max-h-44 overflow-y-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        {data?.parent !== null && data?.parent !== undefined && (
          <button
            onClick={() => setPath(data.parent!)}
            className="flex w-full items-center gap-1.5 border-b border-gray-100 px-2.5 py-1.5 text-left text-[12px] text-gray-500 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <CornerLeftUp size={12} className="shrink-0" />
            {t('sidebar.parentDir')}
          </button>
        )}
        {listing.isLoading && (
          <div className="flex items-center gap-1.5 px-2.5 py-3 text-[12px] text-gray-400">
            <Loader2 size={12} className="animate-spin" />{t('sidebar.reading')}
          </div>
        )}
        {listing.isError && (
          <div className="px-2.5 py-3 text-[12px] text-red-500">
            {(listing.error as Error)?.message || t('sidebar.readFailed')}
          </div>
        )}
        {data?.entries.filter((e) => e.isDirectory).map((entry) => (
          <button
            key={entry.name}
            onClick={() => setPath(joinDirPath(data.current, entry.name))}
            className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[12px] text-gray-700 hover:bg-blue-50 dark:text-gray-300 dark:hover:bg-blue-950/30"
          >
            <Folder size={12} className="shrink-0 text-blue-400" />
            <span className="truncate">{entry.name}</span>
            <ChevronRight size={11} className="ml-auto shrink-0 text-gray-300" />
          </button>
        ))}
        {data && data.entries.filter((e) => e.isDirectory).length === 0 && !listing.isLoading && (
          <div className="px-2.5 py-3 text-[12px] text-gray-400">{t('sidebar.noSubDirs')}</div>
        )}
      </div>
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button
          onClick={() => { onPick(data?.current || path); onClose() }}
          disabled={!data?.current}
          className="rounded-lg bg-blue-500 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-40"
        >
          {t('sidebar.pickCurrentDir')}
        </button>
      </div>
    </div>
  )
}

/* ─── 新建项目对话框（本地 / SSH 远程） ─── */

function CreateProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (p: IWorkProject) => void }) {
  const { t } = useTranslation('work')
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'local' | 'ssh'>('local')
  const [name, setName] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(22)
  const [user, setUser] = useState('')
  const [authType, setAuthType] = useState('Key')
  const [keyPath, setKeyPath] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [localBrowsing, setLocalBrowsing] = useState(false)
  const [remoteBrowsing, setRemoteBrowsing] = useState(false)

  const { data: sshStatus } = useQuery({ queryKey: ['workSshStatus'], queryFn: workSshService.status })
  const { data: sshConfigHosts = [] } = useQuery({
    queryKey: ['workSshConfigHosts'],
    queryFn: workSshService.configHosts,
    enabled: mode === 'ssh',
    retry: false,
  })

  const create = useMutation({
    mutationFn: workProjectService.create,
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['workProjects'] })
      onCreated(project)
    },
    onError: (e: Error) => setError(e.message || t('sidebar.createProjectFailed')),
  })

  const testConnection = useMutation({
    mutationFn: workSshService.test,
    onSuccess: (r) => setTestResult({ ok: r.success, text: r.remoteBanner ? `${r.message}（${r.remoteBanner}）` : r.message }),
    onError: (e: Error) => setTestResult({ ok: false, text: e.message || t('sidebar.testConnectionFailed') }),
  })

  const handleCreate = () => {
    setError('')
    if (!name.trim()) { setError(t('sidebar.projectNameRequired')); return }
    if (mode === 'local') {
      if (!rootPath.trim()) { setError(t('sidebar.localDirRequired')); return }
      create.mutate({ name: name.trim(), rootPath: rootPath.trim() })
      return
    }
    if (!host.trim()) { setError(t('sidebar.sshHostRequired')); return }
    if (authType === 'Password' && !password) { setError(t('sidebar.sshPasswordRequired')); return }
    if (authType === 'Key' && !keyPath.trim()) { setError(t('sidebar.sshKeyPathRequired')); return }
    if (!rootPath.trim()) { setError(t('sidebar.remoteDirRequired')); return }
    create.mutate({
      name: name.trim(),
      rootPath: rootPath.trim(),
      connectionType: 'Ssh',
      sshHost: host.trim(),
      sshPort: port,
      sshUser: user.trim() || undefined,
      sshAuthType: authType,
      sshKeyPath: authType === 'Key' ? keyPath.trim() : undefined,
      sshPassword: authType === 'Password' ? password : undefined,
    })
  }

  const inputCls = 'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-blue-950/40'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">{t('sidebar.newProjectTitle')}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X size={16} /></button>
        </div>
        <div className="space-y-4 px-5 py-4">
          {/* 模式切换 */}
          <div className="flex items-center gap-1 rounded-full bg-gray-100/80 p-1 dark:bg-white/[0.06]">
            {([
              { key: 'local' as const, label: t('sidebar.localDir'), icon: HardDrive },
              { key: 'ssh' as const, label: t('sidebar.sshRemote'), icon: Server },
            ]).map((m) => {
              const Icon = m.icon
              return (
                <button
                  key={m.key}
                  onClick={() => { setMode(m.key); setTestResult(null) }}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-[13px] font-medium transition-all ${
                    mode === m.key ? 'bg-white text-gray-800 shadow-sm dark:bg-white/10 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
                  }`}
                >
                  <Icon size={13} />
                  {m.label}
                </button>
              )
            })}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sidebar.projectName')}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('sidebar.projectNamePlaceholder')} className={inputCls} />
          </div>

          {mode === 'local' ? (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sidebar.localDir')}</label>
              <div className="flex items-center gap-2">
                <input value={rootPath} onChange={(e) => setRootPath(e.target.value)} placeholder={t('sidebar.localDirPlaceholder')} className={`${inputCls} font-mono text-[13px]`} />
                <button
                  onClick={() => setLocalBrowsing((v) => !v)}
                  className="flex shrink-0 items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                >
                  <FolderOpen size={13} />
                  {t('sidebar.browse')}
                </button>
              </div>
              {localBrowsing && (
                <DirBrowser
                  kind="local"
                  onPick={(p) => setRootPath(p)}
                  onClose={() => setLocalBrowsing(false)}
                />
              )}
            </div>
          ) : (
            <>
              {/* SSH 未安装引导 */}
              {sshStatus && !sshStatus.available && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 dark:border-amber-900/40 dark:bg-amber-950/20">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                    <Wifi size={13} />
                    {t('sidebar.sshNotFound', { os: sshStatus.os })}
                  </div>
                  <p className="text-[11px] leading-relaxed text-amber-700/90 dark:text-amber-300/80">{sshStatus.installHint}</p>
                  {sshStatus.installUrl && (
                    <a href={sshStatus.installUrl} target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-[11px] font-medium text-amber-700 underline dark:text-amber-300">
                      {t('sidebar.viewInstallGuide')}
                    </a>
                  )}
                </div>
              )}

              {/* 从本机 SSH 配置导入连接参数，避免重复填写 */}
              {sshConfigHosts.length > 0 && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('sidebar.importFromSshConfig')}
                    <span className="ml-1 text-[11px] font-normal text-gray-400">{t('sidebar.sshConfigHint')}</span>
                  </label>
                  <Select
                    value=""
                    onChange={(alias) => {
                      const picked = sshConfigHosts.find((h) => h.alias === alias)
                      if (!picked) return
                      setHost(picked.hostName || picked.alias)
                      setPort(picked.port || 22)
                      if (picked.user) setUser(picked.user)
                      if (picked.identityFile)
                      {
                        setAuthType('Key')
                        setKeyPath(picked.identityFile)
                      }
                    }}
                    placeholder={t('sidebar.pickConfiguredHost')}
                    options={sshConfigHosts.map((h) => ({
                      value: h.alias,
                      label: `${h.alias}${h.hostName && h.hostName !== h.alias ? ` → ${h.hostName}` : ''}${h.user ? `（${h.user}）` : ''}`,
                    }))}
                    triggerClassName={`${inputCls} flex items-center justify-between gap-2`}
                  />
                </div>
              )}

              <div className="grid grid-cols-[1fr_96px] gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sidebar.hostAddress')}</label>
                  <input value={host} onChange={(e) => setHost(e.target.value)} placeholder={t('sidebar.hostPlaceholder')} className={`${inputCls} font-mono text-[13px]`} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sidebar.port')}</label>
                  <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sidebar.loginUser')}</label>
                  <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="root" className={`${inputCls} font-mono text-[13px]`} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sidebar.authType')}</label>
                  <Select
                    value={authType}
                    onChange={setAuthType}
                    options={[
                      { value: 'Key', label: t('sidebar.authKeyFile') },
                      { value: 'Password', label: t('sidebar.authPassword') },
                      { value: 'Agent', label: 'SSH Agent' },
                    ]}
                    triggerClassName={`${inputCls} flex items-center justify-between gap-2`}
                  />
                </div>
              </div>
              {authType === 'Key' && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sidebar.keyPath')}</label>
                  <input value={keyPath} onChange={(e) => setKeyPath(e.target.value)} placeholder={t('sidebar.keyPathPlaceholder')} className={`${inputCls} font-mono text-[13px]`} />
                </div>
              )}
              {authType === 'Password' && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sidebar.password')}</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('sidebar.passwordPlaceholder')} className={inputCls} />
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sidebar.remoteDir')}</label>
                <div className="flex items-center gap-2">
                  <input value={rootPath} onChange={(e) => setRootPath(e.target.value)} placeholder={t('sidebar.remoteDirPlaceholder')} className={`${inputCls} font-mono text-[13px]`} />
                  <button
                    onClick={() => setRemoteBrowsing((v) => !v)}
                    disabled={!host.trim()}
                    className="flex shrink-0 items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  >
                    <FolderOpen size={13} />
                    {t('sidebar.browse')}
                  </button>
                </div>
                {remoteBrowsing && (
                  <DirBrowser
                    kind="remote"
                    ssh={{ host: host.trim(), port, user: user.trim() || undefined, authType, keyPath: keyPath.trim() || undefined, password: password || undefined }}
                    onPick={(p) => setRootPath(p)}
                    onClose={() => setRemoteBrowsing(false)}
                  />
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setTestResult(null); testConnection.mutate({ host: host.trim(), port, user: user.trim() || undefined, authType, keyPath: keyPath.trim() || undefined, password: password || undefined, rootPath: rootPath.trim() || '~' }) }}
                  disabled={testConnection.isPending || !host.trim()}
                  className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-1.5 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                >
                  {testConnection.isPending ? <Loader2 size={12} className="animate-spin" /> : <Wifi size={12} />}
                  {t('sidebar.testConnection')}
                </button>
                {testResult && (
                  <span className={`text-[11px] ${testResult.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                    {testResult.text}
                  </span>
                )}
              </div>
            </>
          )}

          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4 dark:border-gray-800">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">{t('common:cancel')}</button>
          <button
            onClick={handleCreate}
            disabled={create.isPending}
            className="rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm shadow-blue-500/20 transition-all hover:shadow-md active:scale-[0.97] disabled:opacity-50"
          >
            {create.isPending ? t('sidebar.creating') : t('sidebar.create')}
          </button>
        </div>
      </div>
    </div>
  )
}

interface WorkSidebarProps {
  selectedProjectId?: string
  selectedSessionId?: string
  onSelectProject: (project: IWorkProject) => void
  onSelectSession: (session: IWorkSession) => void
  /** 新建会话：只放草稿占位（第一条消息才落库）；不传时退回「立刻创建」 */
  onStartDraftSession?: (project: IWorkProject) => void
  onProjectDeleted?: (projectId: string) => void
  onSessionDeleted?: (sessionId: string) => void
  /** 嵌在合并侧栏里：单栏树形展示、不占固定宽度、不画右边框 */
  embedded?: boolean
}

interface WorkSidebarProps {
  selectedProjectId?: string
  selectedSessionId?: string
  onSelectProject: (project: IWorkProject) => void
  onSelectSession: (session: IWorkSession) => void
  /** 新建会话：只放草稿占位（第一条消息才落库）；不传时退回「立刻创建」 */
  onStartDraftSession?: (project: IWorkProject) => void
  onProjectDeleted?: (projectId: string) => void
  onSessionDeleted?: (sessionId: string) => void
  /** 嵌在合并侧栏里：单栏树形展示、不占固定宽度、不画右边框 */
  embedded?: boolean
  /** 搜索词由一级菜单输入框提供（同时用于会话检索） */
  search?: string
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

/** 会话列表：树形模式下缩进挂在项目节点下，平铺模式下独立成第二栏 */
function SessionList({
  project,
  sessionQuery,
  indent,
  selectedSessionId,
  onSelectProject,
  onSelectSession,
  onStartDraftSession,
  onSessionDeleted,
}: {
  project: IWorkProject
  sessionQuery: string
  indent: boolean
  selectedSessionId?: string
  onSelectProject: (p: IWorkProject) => void
  onSelectSession: (s: IWorkSession) => void
  /** 新建会话：只放草稿占位（第一条消息才落库） */
  onStartDraftSession?: (project: IWorkProject) => void
  onSessionDeleted?: (sessionId: string) => void
}) {
  const { t } = useTranslation('work')
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [actionError, setActionError] = useState('')
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [sessionName, setSessionName] = useState('')

  const { data: sessions = [] } = useQuery({
    queryKey: ['workSessions', project.id, sessionQuery],
    queryFn: () => workProjectService.getSessions(project.id, sessionQuery || undefined),
  })

  const createSession = useMutation({
    mutationFn: workSessionService.create,
    onSuccess: (newSession) => {
      setActionError('')
      queryClient.invalidateQueries({ queryKey: ['workSessions', project.id] })
      queryClient.invalidateQueries({ queryKey: ['workProjects'] })
      onSelectProject(project)
      onSelectSession(newSession)
    },
    onError: (e: Error) => setActionError(e.message || t('sidebar.createSessionFailed')),
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => workSessionService.update(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workSessions', project.id] })
      setRenamingSessionId(null)
      setActionError('')
    },
    onError: (e: Error) => {
      setActionError(e.message || t('sidebar.renameFailed'))
      setRenamingSessionId(null)
    },
  })

  const deleteSessionMutation = useMutation({
    mutationFn: workSessionService.delete,
    onSuccess: (_result, sessionId) => {
      setActionError('')
      queryClient.invalidateQueries({ queryKey: ['workSessions', project.id] })
      queryClient.invalidateQueries({ queryKey: ['workProjects'] })
      onSessionDeleted?.(sessionId)
    },
    onError: (e: Error) => setActionError(e.message || t('sidebar.deleteSessionFailed')),
  })

  const handleDeleteSession = (session: IWorkSession) => {
    confirm({
      message: t('sidebar.deleteSessionConfirm', { title: session.title || t('sidebar.newSession') }),
      onConfirm: () => deleteSessionMutation.mutate(session.id),
    })
  }

  const pad = indent ? { paddingLeft: '40px' } : undefined

  return (
    <div className="mt-0.5">
      {actionError && (
        <div className="mx-1 mb-1 rounded bg-red-50 px-2 py-1 text-[10px] text-red-500 dark:bg-red-950/30 dark:text-red-400" style={indent ? { marginLeft: '40px' } : undefined}>
          {actionError}
        </div>
      )}
      {sessions.map((session) => {
        const active = selectedSessionId === session.id
        return (
          <div
            key={session.id}
            onClick={() => { onSelectProject(project); onSelectSession(session) }}
            className={`group flex cursor-pointer items-center gap-1.5 rounded-lg py-1 pl-2 pr-1.5 transition-colors ${active ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'}`}
            style={pad}
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
                onClick={(e) => e.stopPropagation()}
                className="min-w-0 flex-1 rounded border border-blue-300 bg-white px-1 py-0.5 text-[12px] outline-none dark:bg-gray-800"
              />
            ) : (
              <span className={`min-w-0 flex-1 truncate text-[12px] ${active ? 'font-medium text-blue-700 dark:text-blue-200' : 'text-gray-600 dark:text-gray-300'}`}>
                {session.title || t('sidebar.newSession')}
              </span>
            )}
            {renamingSessionId !== session.id && (
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={(e) => { e.stopPropagation(); setRenamingSessionId(session.id); setSessionName(session.title || '') }}
                  title={t('sidebar.renameSession')}
                  aria-label={t('sidebar.renameSession')}
                  className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                >
                  <Pencil size={10} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteSession(session) }}
                  disabled={deleteSessionMutation.isPending}
                  title={t('sidebar.deleteSession')}
                  aria-label={t('sidebar.deleteSession')}
                  className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-red-500 disabled:opacity-40 dark:hover:bg-gray-700"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            )}
          </div>
        )
      })}
      {sessions.length === 0 && sessionQuery && (
        <div className="py-0.5 text-[11px] text-gray-400" style={pad}>
          {t('sidebar.noMatchingSessions')}
        </div>
      )}
      {sessions.length === 0 && !sessionQuery ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center" style={indent ? { paddingLeft: '32px' } : undefined}>
          <MessageSquare size={18} className="text-gray-300 dark:text-gray-600" />
          <span className="text-[11px] text-gray-400">{t('sidebar.noSessions')}</span>
          <button
            onClick={() => (onStartDraftSession ? onStartDraftSession(project) : createSession.mutate({ projectId: project.id, title: '' }))}
            className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:border-blue-300 hover:text-blue-500 dark:border-gray-700 dark:text-gray-400 dark:hover:border-blue-500 dark:hover:text-blue-400"
          >
            {t('sidebar.newSession')}
          </button>
        </div>
      ) : (
        sessions.length > 0 && (
          <button
            onClick={() => (onStartDraftSession ? onStartDraftSession(project) : createSession.mutate({ projectId: project.id, title: '' }))}
            className="flex items-center gap-1 py-0.5 text-[11px] text-gray-400 transition-colors hover:text-blue-500"
            style={pad}
          >
            <Plus size={10} /> {t('sidebar.newSession')}
          </button>
        )
      )}
    </div>
  )
}

function ProjectNode({
  project,
  expanded,
  sessionQuery,
  flat,
  selectedProjectId,
  selectedSessionId,
  onToggle,
  onSelectProject,
  onSelectSession,
  onDeleteProject,
  onRenameProject,
  onStartDraftSession,
  onSessionDeleted,
}: {
  project: IWorkProject
  expanded: boolean
  sessionQuery: string
  flat?: boolean
  selectedProjectId?: string
  selectedSessionId?: string
  onToggle: () => void
  onSelectProject: (p: IWorkProject) => void
  onSelectSession: (s: IWorkSession) => void
  onDeleteProject: (id: string) => void
  onRenameProject: (p: IWorkProject) => void
  /** 新建会话：只放草稿占位（第一条消息才落库） */
  onStartDraftSession?: (project: IWorkProject) => void
  onSessionDeleted?: (sessionId: string) => void
}) {
  const { t } = useTranslation('work')
  const [renaming, setRenaming] = useState(false)
  const [setting, setSetting] = useState(false)
  const [name, setName] = useState(project.name)
  const color = resolveColor(project)

  return (
    <div className="mb-0.5">
      <div
        onClick={() => { onSelectProject(project); if (!flat) onToggle() }}
        className={`group flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors ${
          selectedProjectId === project.id ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'
        }`}
      >
        {!flat && (
          <button onClick={(e) => { e.stopPropagation(); onToggle() }} className="shrink-0 text-gray-400">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        )}
        <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-white ${COLOR_CLASSES[color]}`}>
          {expanded ? <FolderOpen size={11} /> : <Folder size={11} />}
        </div>
        <span className={`min-w-0 flex-1 truncate text-[13px] ${selectedProjectId === project.id ? 'font-medium text-blue-700 dark:text-blue-200' : 'text-gray-700 dark:text-gray-200'}`}>
          {project.name}
        </span>
        {project.connectionType === 'Ssh' && (
          <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-medium text-violet-600 dark:bg-violet-900/40 dark:text-violet-300" title={`SSH：${project.sshUser ?? ''}${project.sshUser ? '@' : ''}${project.sshHost}:${project.sshPort}`}>
            SSH
          </span>
        )}
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-all group-hover:opacity-100">
          <button
            onClick={(e) => { e.stopPropagation(); setSetting(true) }}
            title={t('sidebar.projectSettings')}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
          >
            <Settings size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setRenaming(true); setName(project.name) }}
            title={t('sidebar.renameProject')}
            aria-label={t('sidebar.renameProject')}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
          >
            <Pencil size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteProject(project.id) }}
            title={t('sidebar.deleteProject')}
            aria-label={t('sidebar.deleteProject')}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-red-500 dark:hover:bg-gray-700"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {setting && <WorkProjectSettings project={project} onClose={() => setSetting(false)} />}

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

      {!flat && expanded && (
        <SessionList
          project={project}
          sessionQuery={sessionQuery}
          indent
          selectedSessionId={selectedSessionId}
          onSelectProject={onSelectProject}
          onSelectSession={onSelectSession}
          onStartDraftSession={onStartDraftSession}
          onSessionDeleted={onSessionDeleted}
        />
      )}
    </div>
  )
}

export interface WorkSidebarHandle {
  /** 一级菜单的「＋」触发：打开新建项目对话框 */
  startCreateProject: () => void
}

const WorkSidebar = forwardRef<WorkSidebarHandle, WorkSidebarProps>(function WorkSidebar({
  selectedProjectId, selectedSessionId, onSelectProject, onSelectSession, onStartDraftSession, onProjectDeleted, onSessionDeleted,
  embedded, search = '',
}, ref) {
  const { t } = useTranslation('work')
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [expandedProjects, setExpandedProjects] = useState<Map<string, boolean>>(new Map())
  const [isAdding, setIsAdding] = useState(false)
  const [projectActionError, setProjectActionError] = useState('')

  useImperativeHandle(ref, () => ({ startCreateProject: () => setIsAdding(true) }), [])

  // 用户手动展开/折叠优先，未手动设置过的项目在选中时默认展开
  const isExpanded = (id: string) => expandedProjects.get(id) ?? id === selectedProjectId
  const setProjectExpanded = (id: string, expanded: boolean) =>
    setExpandedProjects((prev) => new Map(prev).set(id, expanded))

  const { data: projects = [] } = useQuery({
    queryKey: ['workProjects'],
    queryFn: workProjectService.getAll,
  })

  const keyword = search.trim().toLowerCase()
  const filtered = projects.filter((p) => !keyword || p.name.toLowerCase().includes(keyword))

  // 按分类分节展示：分类取自关联的项目管理条目，未分类的归到「未分类」
  const sections = filtered.reduce<Array<[string, IWorkProject[]]>>((acc, p) => {
    const name = p.category?.trim() || ''
    const last = acc[acc.length - 1]
    if (last && last[0] === name) last[1].push(p)
    else acc.push([name, [p]])
    return acc
  }, [])
  sections.sort((a, b) =>
    (a[0] === '' ? 1 : 0) - (b[0] === '' ? 1 : 0) ||
    b[1].length - a[1].length ||
    a[0].localeCompare(b[0]))

  const deleteProject = useMutation({
    mutationFn: workProjectService.delete,
    onSuccess: (_result, projectId) => {
      setProjectActionError('')
      queryClient.invalidateQueries({ queryKey: ['workProjects'] })
      queryClient.invalidateQueries({ queryKey: ['workSessions'] })
      onProjectDeleted?.(projectId)
    },
    onError: (e: Error) => setProjectActionError(e.message || t('sidebar.deleteProjectFailed')),
  })

  const renameProject = useMutation({
    mutationFn: (p: IWorkProject) =>
      workProjectService.update(p.id, {
        name: p.name,
        rootPath: p.rootPath,
        description: p.description,
        icon: p.icon,
        color: p.color,
        sortOrder: p.sortOrder,
        mcpServerIds: p.mcpServerIds,
        skillIds: p.skillIds,
        diagnosticsCommand: p.diagnosticsCommand,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workProjects'] })
      setProjectActionError('')
    },
    onError: (e: Error) => setProjectActionError(e.message || t('sidebar.renameProjectFailed')),
  })

  const secondaryMenuStyle = useUIStore((state) => state.secondaryMenuStyle)
  const flat = secondaryMenuStyle === 'flat' && !embedded
  const selectedProject = projects.find((p) => p.id === selectedProjectId)

  const createDialog = isAdding && (
    <CreateProjectDialog
      onClose={() => setIsAdding(false)}
      onCreated={(project) => {
        setIsAdding(false)
        setProjectExpanded(project.id, true)
        onSelectProject(project)
      }}
    />
  )

  const projectList = (
    <>
      {sections.map(([category, items]) => (
        <div key={category} className="mb-1">
          {sections.length > 1 && (
            <div className="flex items-center gap-1.5 px-2 py-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400">{category || t('sidebar.uncategorized')}</span>
              <span className="text-[10px] text-gray-300 dark:text-gray-600">{items.length}</span>
            </div>
          )}
          {items.map((project) => (
            <ProjectNode
              key={project.id}
              project={project}
              flat={flat}
              expanded={search ? true : isExpanded(project.id)}
              sessionQuery={search}
              selectedProjectId={selectedProjectId}
              selectedSessionId={selectedSessionId}
              onToggle={() => setProjectExpanded(project.id, !isExpanded(project.id))}
              onSelectProject={onSelectProject}
              onSelectSession={onSelectSession}
              onStartDraftSession={onStartDraftSession}
              onDeleteProject={(id) => {
                const project = projects.find((p) => p.id === id)
                confirm({
                  message: t('sidebar.deleteProjectConfirm', { name: project?.name ?? '' }),
                  onConfirm: () => deleteProject.mutate(id),
                })
              }}
              onRenameProject={(p) => renameProject.mutate(p)}
              onSessionDeleted={onSessionDeleted}
            />
          ))}
        </div>
      ))}
      {projectActionError && (
        <div className="mx-1 mb-1 rounded bg-red-50 px-2 py-1 text-[11px] text-red-500 dark:bg-red-950/30 dark:text-red-400">
          {projectActionError}
        </div>
      )}
      {filtered.length === 0 && (
        <div className="py-8 text-center text-xs text-gray-400">{t('sidebar.noProjects')}</div>
      )}
    </>
  )

  // 平铺：项目与会话分两栏并排（与对话页的双栏结构一致）
  if (flat) {
    return (
      <div className="flex shrink-0">
        <div className="flex w-44 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          {createDialog}
          <div className="flex-1 overflow-y-auto p-2">{projectList}</div>
        </div>
        <div className="flex w-56 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-gray-100 p-3 dark:border-gray-800">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{t('sidebar.sessions')}</h2>
              {selectedProject && (
                <span className="min-w-0 truncate text-[10px] text-gray-400" title={selectedProject.name}>{selectedProject.name}</span>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {selectedProject ? (
              <SessionList
                project={selectedProject}
                sessionQuery={search}
                indent={false}
                selectedSessionId={selectedSessionId}
                onSelectProject={onSelectProject}
                onSelectSession={onSelectSession}
                onStartDraftSession={onStartDraftSession}
                onSessionDeleted={onSessionDeleted}
              />
            ) : (
              <div className="py-8 text-center text-xs text-gray-400">{t('sidebar.selectProjectForSessions')}</div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // 树形：项目下挂会议话列表，单栏展示（合并侧栏固定用此形态；搜索/新建由一级菜单提供）
  return (
    <div className={`flex flex-col bg-white dark:bg-gray-900 ${embedded ? 'min-h-0 w-full flex-1' : 'w-60 shrink-0 border-r border-gray-200 dark:border-gray-800'}`}>
      {createDialog}
      <div className="flex-1 overflow-y-auto p-2">
        {projectList}
      </div>
    </div>
  )
})

export default WorkSidebar
