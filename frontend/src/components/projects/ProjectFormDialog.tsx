import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle, Check, ChevronRight, CornerLeftUp, Folder, FolderOpen, HardDrive, Loader2, Server, Wifi, X,
} from 'lucide-react'
import { workSshService, workBrowseService } from '../../services/workService'
import Select from '../Select'
import type { IDirListing } from '../../services/workService'
import type { IManagedProject, IProjectGroup, ICreateProjectRequest, IUpdateProjectRequest } from '../../types/project'

interface ProjectFormDialogProps {
  /** 为空表示新建 */
  project?: IManagedProject | null
  groups: IProjectGroup[]
  projects: IManagedProject[]
  onSubmit: (data: ICreateProjectRequest | IUpdateProjectRequest) => void
  onCreateGroup: (name: string) => Promise<IProjectGroup>
  onClose: () => void
  pending: boolean
}

const joinDirPath = (base: string, name: string) => {
  if (!base) return name
  const sep = base.includes('\\') && !base.includes('/') ? '\\' : '/'
  return base.endsWith(sep) ? base + name : `${base}${sep}${name}`
}

/** 目录浏览面板：本地 / 远程目录逐级浏览，"选择当前目录"回填输入框 */
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
  const [path, setPath] = useState('')
  const listing = useQuery<IDirListing>({
    queryKey: kind === 'local' ? ['projLocalDirs', path] : ['projRemoteDirs', ssh?.host, ssh?.port, ssh?.user, path],
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
          title="关闭浏览"
          aria-label="关闭目录浏览"
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
            上级目录
          </button>
        )}
        {listing.isLoading && (
          <div className="flex items-center gap-1.5 px-2.5 py-3 text-[12px] text-gray-400">
            <Loader2 size={12} className="animate-spin" />读取中...
          </div>
        )}
        {listing.isError && (
          <div className="px-2.5 py-3 text-[12px] text-red-500">{(listing.error as Error)?.message || '读取失败'}</div>
        )}
        {data?.entries.filter((e) => e.isDirectory).map((entry) => (
          <button
            key={entry.name}
            onClick={() => setPath(joinDirPath(data.current, entry.name))}
            className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[12px] text-gray-700 hover:bg-blue-50 dark:text-gray-300 dark:hover:bg-blue-950/30"
          >
            <Folder size={12} className="shrink-0 text-blue-400" />
            <span className="truncate">{entry.name}</span>
            <ChevronRight size={11} className="ml-auto shrink-0 text-gray-400" />
          </button>
        ))}
        {data && data.entries.filter((e) => e.isDirectory).length === 0 && !listing.isLoading && (
          <div className="px-2.5 py-3 text-[12px] text-gray-400">没有子目录</div>
        )}
      </div>
      <div className="mt-1.5 flex justify-end">
        <button
          onClick={() => { onPick(data?.current || path); onClose() }}
          disabled={!data?.current}
          className="rounded-lg bg-blue-500 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-40"
        >
          选择当前目录
        </button>
      </div>
    </div>
  )
}

const inputCls = 'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:focus:ring-blue-950/40'

export default function ProjectFormDialog({
  project, groups, projects, onSubmit, onCreateGroup, onClose, pending,
}: ProjectFormDialogProps) {
  const isEdit = !!project
  const [mode, setMode] = useState<'local' | 'ssh'>(project?.projectType === 'Ssh' ? 'ssh' : 'local')
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [directoryPath, setDirectoryPath] = useState(project?.directoryPath ?? '')
  const [host, setHost] = useState(project?.sshHost ?? '')
  const [port, setPort] = useState(project?.sshPort ?? 22)
  const [user, setUser] = useState(project?.sshUser ?? '')
  const [authType, setAuthType] = useState(project?.sshAuthType ?? 'Key')
  const [keyPath, setKeyPath] = useState(project?.sshKeyPath ?? '')
  const [password, setPassword] = useState('')
  const [groupId, setGroupId] = useState(project?.groupId ?? '')
  const [category, setCategory] = useState(project?.category ?? '')
  const [tags, setTags] = useState((project?.tags ?? []).join('，'))
  const [localBrowsing, setLocalBrowsing] = useState(false)
  const [remoteBrowsing, setRemoteBrowsing] = useState(false)
  const [error, setError] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [groupCreateOpen, setGroupCreateOpen] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')

  const { data: sshStatus } = useQuery({ queryKey: ['workSshStatus'], queryFn: workSshService.status })
  const { data: sshConfigHosts = [] } = useQuery({
    queryKey: ['workSshConfigHosts'],
    queryFn: workSshService.configHosts,
    enabled: mode === 'ssh',
    retry: false,
  })

  const categoryOptions = Array.from(new Set(projects.map((p) => p.category).filter((c): c is string => !!c)))
  const tagOptions = Array.from(new Set(projects.flatMap((p) => p.tags)))

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return
    setCreatingGroup(true)
    try {
      const created = await onCreateGroup(newGroupName.trim())
      setGroupId(created.id)
      setNewGroupName('')
      setGroupCreateOpen(false)
    } catch (e) {
      setError((e as Error).message || '创建分组失败')
    } finally {
      setCreatingGroup(false)
    }
  }

  const handleSubmit = () => {
    setError('')
    if (!name.trim()) { setError('请输入项目名称'); return }
    if (!directoryPath.trim()) { setError(mode === 'local' ? '请输入本地目录' : '请输入远程项目目录'); return }
    if (mode === 'ssh') {
      if (!host.trim()) { setError('请输入 SSH 主机地址'); return }
      if (authType === 'Password' && !password && !(isEdit && project?.hasSshPassword)) { setError('请输入 SSH 密码'); return }
    }

    const base: ICreateProjectRequest = {
      name: name.trim(),
      description: description.trim() || undefined,
      projectType: mode === 'ssh' ? 'Ssh' : 'Local',
      directoryPath: directoryPath.trim(),
      groupId: groupId || undefined,
      category: category.trim() || undefined,
      tags: tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
    }
    if (mode === 'ssh') {
      base.sshHost = host.trim()
      base.sshPort = port || 22
      base.sshUser = user.trim() || undefined
      base.sshAuthType = authType
      base.sshKeyPath = authType === 'Key' ? keyPath.trim() || undefined : undefined
      // 密码留空且编辑时已保存过 → 不传（保持原密码）；输入了新值才覆盖
      if (password || !(isEdit && project?.hasSshPassword)) base.sshPassword = password
    }

    if (isEdit && project) {
      onSubmit({ ...base, isPinned: project.isPinned, sortOrder: project.sortOrder } as IUpdateProjectRequest)
    } else {
      onSubmit(base)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">{isEdit ? '编辑项目' : '新建项目'}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X size={16} /></button>
        </div>
        <div className="space-y-4 px-5 py-4">
          {/* 类型切换 */}
          <div className="flex items-center gap-1 rounded-full bg-gray-100/80 p-1 dark:bg-white/[0.06]">
            {([
              { key: 'local' as const, label: '本地目录', icon: HardDrive },
              { key: 'ssh' as const, label: 'SSH 远程', icon: Server },
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
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">项目名称</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：我的服务端项目" className={inputCls} />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">备注</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="可选，记录项目用途" className={inputCls} />
          </div>

          {/* 分组与归类 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">分组</label>
              <div className="flex items-center gap-2">
                <Select
                  value={groupId}
                  onChange={setGroupId}
                  options={[
                    { value: '', label: '未分组' },
                    ...groups.map((g) => ({ value: g.id, label: g.name })),
                  ]}
                  triggerClassName={`${inputCls} flex items-center justify-between gap-2`}
                />
                <button
                  onClick={() => setGroupCreateOpen((v) => !v)}
                  title="新建分组"
                  aria-label="新建分组"
                  aria-expanded={groupCreateOpen}
                  className="shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                >
                  +
                </button>
              </div>
              {groupCreateOpen && (
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void handleCreateGroup() }
                      if (e.key === 'Escape') { setGroupCreateOpen(false); setNewGroupName('') }
                    }}
                    placeholder="新分组名称"
                    disabled={creatingGroup}
                    className={inputCls}
                  />
                  <button
                    onClick={() => void handleCreateGroup()}
                    disabled={creatingGroup || !newGroupName.trim()}
                    className="shrink-0 rounded-xl bg-blue-500 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-40"
                  >
                    {creatingGroup ? <Loader2 size={13} className="animate-spin" /> : '确定'}
                  </button>
                </div>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">分类</label>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                list="project-category-options"
                placeholder="如：服务端 / 工具"
                className={inputCls}
              />
              <datalist id="project-category-options">
                {categoryOptions.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              标签
              <span className="ml-1 text-[11px] font-normal text-gray-400">（用逗号分隔，可多个）</span>
            </label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              list="project-tag-options"
              placeholder="如：React，内部工具"
              className={inputCls}
            />
            <datalist id="project-tag-options">
              {tagOptions.map((t) => <option key={t} value={t} />)}
            </datalist>
          </div>

          {mode === 'local' ? (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">本地目录</label>
              <div className="flex items-center gap-2">
                <input
                  value={directoryPath}
                  onChange={(e) => setDirectoryPath(e.target.value)}
                  placeholder="如 D:\repos\MyProject 或 /home/me/project"
                  className={`${inputCls} font-mono text-[13px]`}
                />
                <button
                  onClick={() => setLocalBrowsing((v) => !v)}
                  className="flex shrink-0 items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                >
                  <FolderOpen size={13} />
                  浏览
                </button>
              </div>
              {localBrowsing && <DirBrowser kind="local" onPick={(p) => setDirectoryPath(p)} onClose={() => setLocalBrowsing(false)} />}
            </div>
          ) : (
            <>
              {sshStatus && !sshStatus.available && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 dark:border-amber-900/40 dark:bg-amber-950/20">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                    <Wifi size={13} />
                    未检测到 ssh 命令（{sshStatus.os}）
                  </div>
                  <p className="text-[11px] leading-relaxed text-amber-700/90 dark:text-amber-300/80">{sshStatus.installHint}</p>
                </div>
              )}

              {sshConfigHosts.length > 0 && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    从本机 SSH 配置导入
                    <span className="ml-1 text-[11px] font-normal text-gray-400">（~/.ssh/config，可选）</span>
                  </label>
                  <Select
                    value=""
                    onChange={(alias) => {
                      const picked = sshConfigHosts.find((h) => h.alias === alias)
                      if (!picked) return
                      setHost(picked.hostName || picked.alias)
                      setPort(picked.port || 22)
                      if (picked.user) setUser(picked.user)
                      if (picked.identityFile) { setAuthType('Key'); setKeyPath(picked.identityFile) }
                    }}
                    placeholder="选择已配置的主机…"
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
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">主机地址</label>
                  <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.10 或 example.com" className={`${inputCls} font-mono text-[13px]`} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">端口</label>
                  <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">登录用户</label>
                  <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="root" className={`${inputCls} font-mono text-[13px]`} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">认证方式</label>
                  <Select
                    value={authType}
                    onChange={setAuthType}
                    options={[
                      { value: 'Key', label: '私钥文件' },
                      { value: 'Password', label: '密码' },
                      { value: 'Agent', label: 'SSH Agent' },
                    ]}
                    triggerClassName={`${inputCls} flex items-center justify-between gap-2`}
                  />
                </div>
              </div>
              {authType === 'Key' && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">私钥文件路径</label>
                  <input value={keyPath} onChange={(e) => setKeyPath(e.target.value)} placeholder="如 ~/.ssh/id_rsa" className={`${inputCls} font-mono text-[13px]`} />
                </div>
              )}
              {authType === 'Password' && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">密码</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={isEdit && project?.hasSshPassword ? '已保存，留空保持不变；切换认证方式可清除' : 'SSH 登录密码（加密保存）'}
                    className={inputCls}
                  />
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">远程项目目录</label>
                <div className="flex items-center gap-2">
                  <input
                    value={directoryPath}
                    onChange={(e) => setDirectoryPath(e.target.value)}
                    placeholder="如 /home/me/projects/app（绝对路径）"
                    className={`${inputCls} font-mono text-[13px]`}
                  />
                  <button
                    onClick={() => setRemoteBrowsing((v) => !v)}
                    disabled={!host.trim()}
                    className="flex shrink-0 items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  >
                    <FolderOpen size={13} />
                    浏览
                  </button>
                </div>
                {remoteBrowsing && (
                  <DirBrowser
                    kind="remote"
                    ssh={{ host: host.trim(), port, user: user.trim() || undefined, authType, keyPath: keyPath.trim() || undefined, password: password.trim() || undefined }}
                    onPick={(p) => setDirectoryPath(p)}
                    onClose={() => setRemoteBrowsing(false)}
                  />
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setTestResult(null)
                    workSshService.test({
                      host: host.trim(), port, user: user.trim() || undefined, authType,
                      keyPath: authType === 'Key' ? keyPath.trim() || undefined : undefined,
                      password: authType === 'Password' ? password.trim() || undefined : undefined,
                      rootPath: directoryPath.trim() || '~',
                    })
                      .then((r) => setTestResult({ ok: r.success, text: r.remoteBanner ? `${r.message}（${r.remoteBanner}）` : r.message }))
                      .catch((e: Error) => setTestResult({ ok: false, text: e.message || '连接测试失败' }))
                  }}
                  disabled={!host.trim()}
                  className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-1.5 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                >
                  <Wifi size={12} />
                  测试连接
                </button>
                {testResult && (
                  <span className={`flex items-center gap-1 text-[11px] ${testResult.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                    {testResult.ok ? <Check size={11} /> : <AlertCircle size={11} />}
                    {testResult.text}
                  </span>
                )}
              </div>
            </>
          )}

          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4 dark:border-gray-800">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">取消</button>
          <button
            onClick={handleSubmit}
            disabled={pending}
            className="rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm shadow-blue-500/20 transition-all hover:shadow-md active:scale-[0.97] disabled:opacity-50"
          >
            {pending ? '保存中...' : isEdit ? '保存' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}
