import { useState, useCallback, useMemo, useSyncExternalStore, forwardRef, useImperativeHandle } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Folder, FolderOpen, MessageSquare, Pencil, Check, X, ChevronRight, Settings, Server, HardDrive, Loader2, Wifi, CornerLeftUp } from 'lucide-react'
import { workProjectService, workSessionService, workSshService, workBrowseService } from '../../services/workService'
import { useConfirm } from '../../components/confirm'
import Select from '../Select'
import { Button, Card, ContextMenu, IconButton, Input, Modal, PillTabs, TreeRow } from '../ui'
import { useUIStore } from '../../stores/uiStore'
import { workStreamRuns } from '../../utils/workStreamRuns'
import RunningIndicator from './RunningIndicator'
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
        <IconButton variant="ghost" tone="gray" className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700" label={t('sidebar.closeDirBrowser')} onClick={onClose}
          
          title={t('sidebar.closeBrowse')}
          aria-label={t('sidebar.closeDirBrowser')}>
          <X size={12} />
        </IconButton>
      </div>
      <div className="max-h-44 overflow-y-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        {data?.parent !== null && data?.parent !== undefined && (
          <Button variant="ghost" tone="gray" className="flex w-full items-center gap-1.5 border-b border-gray-100 px-2.5 py-1.5 text-left text-[12px] text-gray-500 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800" onClick={() => setPath(data.parent!)}>
            <CornerLeftUp size={12} className="shrink-0" />
            {t('sidebar.parentDir')}
          </Button>
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
        <Button variant="primary" tone="blue" className="rounded-lg bg-blue-500 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-40" onClick={() => { onPick(data?.current || path); onClose() }}
          disabled={!data?.current}>
          {t('sidebar.pickCurrentDir')}
        </Button>
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


  return (
    <Modal open onClose={onClose} size="lg" scroll className="max-h-[90vh] max-w-lg">

        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">{t('sidebar.newProjectTitle')}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X size={16} /></button>
        </div>
        <div className="space-y-4 px-5 py-4">
          {/* 模式切换 */}
          <PillTabs
            value={mode}
            onSelect={(key) => { setMode(key as typeof mode); setTestResult(null) }}
            items={[
              { key: 'local', label: <><HardDrive size={13} />{t('sidebar.localDir')}</> },
              { key: 'ssh', label: <><Server size={13} />{t('sidebar.sshRemote')}</> },
            ]}
          />

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sidebar.projectName')}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('sidebar.projectNamePlaceholder')} />
          </div>

          {mode === 'local' ? (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sidebar.localDir')}</label>
              <div className="flex items-center gap-2">
                <Input value={rootPath} onChange={(e) => setRootPath(e.target.value)} placeholder={t('sidebar.localDirPlaceholder')} className="font-mono text-[13px]" />
                <Button variant="secondary" size="sm" className="flex shrink-0 items-center gap-1 rounded-xl border border-gray-200 bg-white glass px-3 py-2 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300" onClick={() => setLocalBrowsing((v) => !v)}>
                  <FolderOpen size={13} />
                  {t('sidebar.browse')}
                </Button>
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
                    
                  />
                </div>
              )}

              <div className="grid grid-cols-[1fr_96px] gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sidebar.hostAddress')}</label>
                  <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder={t('sidebar.hostPlaceholder')} className="font-mono text-[13px]" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sidebar.port')}</label>
                  <Input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sidebar.loginUser')}</label>
                  <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="root" className="font-mono text-[13px]" />
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
                    
                  />
                </div>
              </div>
              {authType === 'Key' && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sidebar.keyPath')}</label>
                  <Input value={keyPath} onChange={(e) => setKeyPath(e.target.value)} placeholder={t('sidebar.keyPathPlaceholder')} className="font-mono text-[13px]" />
                </div>
              )}
              {authType === 'Password' && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sidebar.password')}</label>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('sidebar.passwordPlaceholder')} />
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sidebar.remoteDir')}</label>
                <div className="flex items-center gap-2">
                  <Input value={rootPath} onChange={(e) => setRootPath(e.target.value)} placeholder={t('sidebar.remoteDirPlaceholder')} className="font-mono text-[13px]" />
                  <Button variant="secondary" size="sm" className="flex shrink-0 items-center gap-1 rounded-xl border border-gray-200 bg-white glass px-3 py-2 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300" onClick={() => setRemoteBrowsing((v) => !v)}
                    disabled={!host.trim()}>
                    <FolderOpen size={13} />
                    {t('sidebar.browse')}
                  </Button>
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
                <Button variant="secondary" size="sm" pill className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white glass px-4 py-1.5 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300" onClick={() => { setTestResult(null); testConnection.mutate({ host: host.trim(), port, user: user.trim() || undefined, authType, keyPath: keyPath.trim() || undefined, password: password || undefined, rootPath: rootPath.trim() || '~' }) }}
                  disabled={testConnection.isPending || !host.trim()}>
                  {testConnection.isPending ? <Loader2 size={12} className="animate-spin" /> : <Wifi size={12} />}
                  {t('sidebar.testConnection')}
                </Button>
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
          <Button variant="ghost" tone="gray" className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800" onClick={onClose}>{t('common:cancel')}</Button>
          <button
            onClick={handleCreate}
            disabled={create.isPending}
            className="rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm shadow-blue-500/20 transition-all hover:shadow-md active:scale-[0.97] disabled:opacity-50"
          >
            {create.isPending ? t('sidebar.creating') : t('sidebar.create')}
          </button>
        </div>
</Modal>
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
  runningSessionIds,
  onSelectProject,
  onSelectSession,
  onStartDraftSession,
  onSessionDeleted,
}: {
  project: IWorkProject
  sessionQuery: string
  indent: boolean
  selectedSessionId?: string
  /** 在跑的会话 id（由侧栏统一拉取，项目行也要用） */
  runningSessionIds: Set<string>
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
  // 会话的重命名 / 删除挂在右键菜单上（与项目行一致），行内只留选中态
  const [menu, setMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

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

  const pad = indent ? { paddingLeft: `${8 + 14}px` } : undefined
  const menuSession = sessions.find((item) => item.id === menu?.sessionId)

  return (
    <div>
      {actionError && (        <div className="mx-1 mb-1 rounded bg-red-50 px-2 py-1 text-[10px] text-red-500 dark:bg-red-950/30 dark:text-red-400" style={indent ? { marginLeft: `${8 + 14}px` } : undefined}>
          {actionError}
        </div>
      )}
      {sessions.map((session) => {
        const active = selectedSessionId === session.id
        return (
          <TreeRow
            key={session.id}
            depth={indent ? 1 : 0}
            selected={active}
            onClick={() => { onSelectProject(project); onSelectSession(session) }}
            icon={(activeIcon) => (
              <span className="flex shrink-0 items-center gap-1.5">
                <MessageSquare size={12} className={`shrink-0 ${activeIcon ? 'text-blue-500' : 'text-gray-400'}`} />
                {/* 进行中标记前置：行首比行尾更容易看到（不再放 badge） */}
                {runningSessionIds.has(session.id) && <RunningIndicator />}
              </span>
            )}
            label={renamingSessionId === session.id ? (
              <Input
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
            ) : (session.title || t('sidebar.newSession'))}
            labelClassName="text-gray-600 dark:text-gray-300"
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMenu({ x: e.clientX, y: e.clientY, sessionId: session.id })
            }}
          />
        )
      })}

      {/* 会话操作收进右键菜单：与项目行一致，行内只留选中态 */}
      <ContextMenu
        anchor={menu}
        onClose={closeMenu}
        items={[
          {
            key: 'rename',
            label: t('sidebar.renameSession'),
            icon: <Pencil size={14} />,
            onSelect: () => { setRenamingSessionId(menuSession!.id); setSessionName(menuSession!.title || '') },
          },
          {
            key: 'delete',
            label: t('sidebar.deleteSession'),
            icon: <Trash2 size={14} />,
            danger: true,
            onSelect: () => handleDeleteSession(menuSession!),
          },
        ]}
      />
      {sessions.length === 0 && sessionQuery && (
        <div className="py-0.5 text-[11px] text-gray-400" style={pad}>
          {t('sidebar.noMatchingSessions')}
        </div>
      )}
      {sessions.length === 0 && !sessionQuery ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center" style={indent ? { paddingLeft: '22px' } : undefined}>
          <MessageSquare size={18} className="text-gray-300 dark:text-gray-600" />
          <span className="text-[11px] text-gray-400">{t('sidebar.noSessions')}</span>
          <Button variant="link" tone="gray" className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:border-blue-300 hover:text-blue-500 dark:border-gray-700 dark:text-gray-400 dark:hover:border-blue-500 dark:hover:text-blue-400" onClick={() => (onStartDraftSession ? onStartDraftSession(project) : createSession.mutate({ projectId: project.id, title: '' }))}>
            {t('sidebar.newSession')}
          </Button>
        </div>
      ) : (
        sessions.length > 0 && (
          <TreeRow
            depth={indent ? 1 : 0}
            icon={<Plus size={12} className="shrink-0" />}
            label={t('sidebar.newSession')}
            labelClassName="text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400"
            onClick={() => (onStartDraftSession ? onStartDraftSession(project) : createSession.mutate({ projectId: project.id, title: '' }))}
          />
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
  runningSessionIds,
  runningProjectIds,
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
  runningSessionIds: Set<string>
  runningProjectIds: Set<string>
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
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const color = resolveColor(project)
  // 子级会话被选中时父级不再高亮：选中态只落在真正选中的那一行
  const projectSelected = selectedProjectId === project.id && !selectedSessionId

  return (
    <div>
      <TreeRow
        expandable={!flat}
        expanded={expanded}
        onToggle={onToggle}
        selected={projectSelected}
        icon={(
          <span className="flex shrink-0 items-center gap-1.5">
            <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-white ${COLOR_CLASSES[color]}`}>
              {expanded && !flat ? <FolderOpen size={11} /> : <Folder size={11} />}
            </div>
            {/* 项目下有会话在跑：行首标记，折叠状态下同样可见 */}
            {runningProjectIds.has(project.id) && <RunningIndicator />}
          </span>
        )}
        label={project.name}
        subtitle={project.description?.trim() || undefined}
        onClick={() => { onSelectProject(project); if (!flat) onToggle() }}
        badge={project.connectionType === 'Ssh' && (
          <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-medium text-violet-600 dark:bg-violet-900/40 dark:text-violet-300" title={`SSH：${project.sshUser ?? ''}${project.sshUser ? '@' : ''}${project.sshHost}:${project.sshPort}`}>
            SSH
          </span>
        )}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      />

      {/* 项目操作收进右键菜单：行内只留选中与展开，悬停不再挤出一排按钮 */}
      <ContextMenu
        anchor={menu}
        onClose={closeMenu}
        items={[
          {
            key: 'settings',
            label: t('sidebar.projectSettings'),
            icon: <Settings size={14} />,
            onSelect: () => setSetting(true),
          },
          {
            key: 'rename',
            label: t('sidebar.renameProject'),
            icon: <Pencil size={14} />,
            onSelect: () => { setName(project.name); setRenaming(true) },
          },
          { kind: 'separator' },
          {
            key: 'delete',
            label: t('sidebar.deleteProject'),
            icon: <Trash2 size={14} />,
            danger: true,
            onSelect: () => onDeleteProject(project.id),
          },
        ]}
      />

      {setting && <WorkProjectSettings project={project} onClose={() => setSetting(false)} />}

      {renaming && (
        <div className="flex items-center gap-1 px-2 py-1" style={{ paddingLeft: `${8 + 14 + 14}px` }}>
          <Input
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
          <Button variant="link" tone="emerald" className="p-0.5 text-emerald-500" onClick={() => { if (name.trim()) onRenameProject({ ...project, name: name.trim() }); setRenaming(false) }}><Check size={12} /></Button>
          <button onClick={() => setRenaming(false)} className="p-0.5 text-gray-400"><X size={12} /></button>
        </div>
      )}

      {!flat && expanded && (
        <SessionList
          project={project}
          sessionQuery={sessionQuery}
          indent
          selectedSessionId={selectedSessionId}
          runningSessionIds={runningSessionIds}
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

  // 进行中的会话 / 项目：后端批量运行态（3s 轮询，覆盖所有标签页与刷新前起的运行）
  // ∪ 本标签页起的流（登记即时生效）。项目行与会话行共用，故在这里统一拉一次。
  const { data: runningSessions } = useQuery({
    queryKey: ['workRunningSessions'],
    queryFn: workSessionService.getRunningSessions,
    refetchInterval: 3000,
  })
  const localRunningIds = useSyncExternalStore(workStreamRuns.subscribe, workStreamRuns.snapshot)
  const runningSessionIds = useMemo(
    () => new Set([...localRunningIds, ...(runningSessions?.sessionIds ?? [])]),
    [localRunningIds, runningSessions],
  )
  const runningProjectIds = useMemo(
    () => new Set(runningSessions?.projectIds ?? []),
    [runningSessions],
  )

  const keyword = search.trim().toLowerCase()
  const filtered = projects.filter((p) => !keyword || p.name.toLowerCase().includes(keyword))

  const projectGroupBy = useUIStore((state) => state.projectGroupBy)
  const projectSortBy = useUIStore((state) => state.projectSortBy)

  // 排序：先于分组，保证每个分组内部顺序一致
  const sorted = [...filtered].sort((a, b) => {
    switch (projectSortBy) {
      case 'name':
        return a.name.localeCompare(b.name)
      case 'updated':
        return b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name)
      case 'sessions':
        return b.sessionCount - a.sessionCount || a.name.localeCompare(b.name)
      default:
        return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
    }
  })

  // 分组键：空字符串表示「未归类」，与未分类/未分组同义
  const groupKeyOf = (p: IWorkProject): string => {
    if (projectGroupBy === 'group') return p.groupName?.trim() || ''
    if (projectGroupBy === 'connection') return p.connectionType === 'Ssh' ? 'ssh' : 'local'
    return p.category?.trim() || ''
  }

  // 按键聚合成节：排序可能把同组项目打散，不能用「连续相同键」切片；节内顺序沿用排序结果
  const sections: Array<[string, IWorkProject[]]> = (() => {
    if (projectGroupBy === 'none') return [['', sorted]]
    const buckets = new Map<string, IWorkProject[]>()
    for (const p of sorted) {
      const key = groupKeyOf(p)
      const bucket = buckets.get(key)
      if (bucket) bucket.push(p)
      else buckets.set(key, [p])
    }
    return [...buckets.entries()].sort((a, b) =>
      (a[0] === '' ? 1 : 0) - (b[0] === '' ? 1 : 0) ||
      a[0].localeCompare(b[0]))
  })()

  const sectionLabel = (key: string): string => {
    if (key === 'ssh') return 'SSH'
    if (key === 'local') return t('sidebar.localProject')
    return key || t('sidebar.uncategorized')
  }


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
      {sections.map(([key, items]) => (
        <div key={key || '__none__'} className="mb-1">
          {projectGroupBy !== 'none' && sections.length > 1 && (
            <div className="flex items-center gap-1.5 px-2 py-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400">{sectionLabel(key)}</span>
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
              runningSessionIds={runningSessionIds}
              runningProjectIds={runningProjectIds}
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
        <Card padded={false} className="flex w-44 shrink-0 flex-col border-r">
          {createDialog}
          <div className="flex-1 overflow-y-auto p-2">{projectList}</div>
        </Card>
        <Card padded={false} className="flex w-56 shrink-0 flex-col border-r">
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
                runningSessionIds={runningSessionIds}
                onSelectProject={onSelectProject}
                onSelectSession={onSelectSession}
                onStartDraftSession={onStartDraftSession}
                onSessionDeleted={onSessionDeleted}
              />
            ) : (
              <div className="py-8 text-center text-xs text-gray-400">{t('sidebar.selectProjectForSessions')}</div>
            )}
          </div>
        </Card>
      </div>
    )
  }

  // 树形：项目下挂会议话列表，单栏展示（合并侧栏固定用此形态；搜索/新建由一级菜单提供）
  // embedded：已被外层卡片（Code 页左栏）包住，不再自带卡片材质，否则是一张卡套一张卡
  if (embedded) {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col">
        {createDialog}
        <div className="flex-1 overflow-y-auto p-2">{projectList}</div>
      </div>
    )
  }

  return (
    <Card padded={false} className="flex w-60 shrink-0 flex-col border-r">
      {createDialog}
      <div className="flex-1 overflow-y-auto p-2">
        {projectList}
      </div>
    </Card>
  )
})

export default WorkSidebar
