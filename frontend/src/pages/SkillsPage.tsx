import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Bot,
  Check,
  FolderOpen,
  Hash,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Terminal,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { skillService } from '../services/skillService'
import type { ILocalSkill } from '../services/skillService'
import type { ISkill } from '../types'

type TabKey = 'database' | 'local'

const CATEGORY_COLORS: Record<string, string> = {
  通用: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  编程: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  写作: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  自定义: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  本地: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
}

const getCategoryColor = (c: string) => CATEGORY_COLORS[c] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'

const defaultConfig = JSON.stringify({ promptTemplate: '请处理以下内容：\n\n{{input}}', systemPrompt: '你是智能助手。' }, null, 2)

export default function SkillsPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabKey>('database')
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ category: '', name: '', description: '', config: defaultConfig, isEnabled: true })
  const [showDirConfig, setShowDirConfig] = useState(false)
  const [dirInput, setDirInput] = useState('')
  const [invokeResult, setInvokeResult] = useState<{ id: string; result?: string; error?: string } | null>(null)
  const [invokeInput, setInvokeInput] = useState('')
  const [invokingId, setInvokingId] = useState<string | null>(null)

  // Database skills
  const { data: dbSkills = [] } = useQuery({ queryKey: ['skills'], queryFn: () => skillService.getAll() })
  // Local skills
  const { data: localSkills = [], isLoading: localLoading, refetch: refetchLocal } = useQuery({
    queryKey: ['localSkills'],
    queryFn: () => skillService.getLocalSkills(),
    enabled: tab === 'local',
  })
  // Skill directories
  const { data: directories = [] } = useQuery({
    queryKey: ['skillDirectories'],
    queryFn: () => skillService.getSkillDirectories(),
    enabled: showDirConfig,
  })

  const createMutation = useMutation({
    mutationFn: skillService.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['skills'] }); closeForm() },
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof skillService.update>[1] }) => skillService.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['skills'] }); closeForm() },
  })
  const deleteMutation = useMutation({
    mutationFn: skillService.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  })
  const updateDirsMutation = useMutation({
    mutationFn: (dirs: string[]) => skillService.updateSkillDirectories(dirs),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skillDirectories'] }),
  })
  const invokeMutation = useMutation({
    mutationFn: ({ nameOrId, input }: { nameOrId: string; input: string }) => skillService.invoke(nameOrId, { input }),
    onMutate: ({ nameOrId }) => { setInvokingId(nameOrId); setInvokeResult(null) },
    onSuccess: (result, { nameOrId }) => { setInvokeResult({ id: nameOrId, result }); setInvokingId(null) },
    onError: (err: Error, { nameOrId }) => { setInvokeResult({ id: nameOrId, error: err.message }); setInvokingId(null) },
  })

  const skills = tab === 'database' ? dbSkills : localSkills
  const categories = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of skills) map.set(s.category || '未分类', (map.get(s.category || '未分类') || 0) + 1)
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [skills])

  const filteredSkills = useMemo(() => {
    const kw = search.trim().toLowerCase()
    return skills.filter(s => {
      if (activeCategory && (s.category || '未分类') !== activeCategory) return false
      if (kw && !s.name.toLowerCase().includes(kw) && !s.description.toLowerCase().includes(kw)) return false
      return true
    })
  }, [skills, search, activeCategory])

  const openCreateForm = () => { setEditingId(null); setForm({ category: '自定义', name: '', description: '', config: defaultConfig, isEnabled: true }); setShowForm(true) }
  const openEditForm = (s: ISkill) => { setEditingId(s.id); setForm({ category: s.category, name: s.name, description: s.description, config: s.config || defaultConfig, isEnabled: s.isEnabled }); setShowForm(true) }
  const closeForm = () => { setShowForm(false); setEditingId(null) }

  const handleSave = () => {
    if (!form.name.trim() || !form.description.trim()) return
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: { ...form, sortOrder: 0 } })
    } else {
      createMutation.mutate({ category: form.category, name: form.name, description: form.description, config: form.config })
    }
  }

  const handleAddDir = () => {
    const trimmed = dirInput.trim()
    if (!trimmed || directories.includes(trimmed)) return
    updateDirsMutation.mutate([...directories, trimmed])
    setDirInput('')
  }

  const handleRemoveDir = (dir: string) => {
    updateDirsMutation.mutate(directories.filter(d => d !== dir))
  }

  const handleInvoke = (nameOrId: string) => {
    if (!invokeInput.trim()) return
    invokeMutation.mutate({ nameOrId, input: invokeInput })
  }

  const renderSkillCard = (skill: ISkill | ILocalSkill, isLocal: boolean) => {
    const s = skill
    const isDb = !isLocal
    return (
      <div
        key={s.id}
        className={`group relative flex flex-col rounded-xl border p-4 shadow-sm transition-all hover:shadow-md ${
          s.isEnabled
            ? 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
            : 'border-gray-100 bg-gray-50 opacity-60 dark:border-gray-800 dark:bg-gray-900'
        }`}
      >
        {/* Header */}
        <div className="mb-2 flex items-start justify-between">
          <div className="flex items-start gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-900/20 dark:to-indigo-900/20">
              {isLocal ? <Terminal size={16} className="text-violet-500" /> : <Zap size={16} className="text-violet-500" />}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">/{s.name}</h3>
              <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${getCategoryColor(s.category || '未分类')}`}>
                {s.category || '未分类'}
              </span>
            </div>
          </div>
          {isDb && (s as ISkill).isBuiltIn && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400 dark:bg-gray-700">内置</span>
          )}
          {isLocal && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-600 dark:bg-amber-900/30">本地</span>
          )}
        </div>

        <p className="mb-3 line-clamp-2 flex-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {s.description}
        </p>

        {/* Invoke area */}
        <div className="mb-2 flex items-center gap-1.5">
          <input
            value={invokeResult?.id === s.id ? invokeInput : ''}
            onChange={(e) => setInvokeInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleInvoke(s.name) }}
            placeholder="输入内容测试..."
            className="h-7 flex-1 rounded-md border border-gray-200 bg-gray-50 px-2 text-xs outline-none focus:border-violet-300 dark:border-gray-600 dark:bg-gray-700"
          />
          <button
            onClick={() => handleInvoke(s.name)}
            disabled={invokingId === s.name}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-500 transition-colors hover:bg-violet-50 hover:text-violet-600 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-violet-900/20"
            title="测试运行"
          >
            {invokingId === s.name ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          </button>
        </div>

        {/* Invoke result */}
        {invokeResult?.id === s.id && (
          <div className={`mb-2 rounded-md p-2 text-xs ${invokeResult.error ? 'bg-red-50 text-red-600 dark:bg-red-900/20' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20'}`}>
            {invokeResult.error || invokeResult.result}
          </div>
        )}

        {/* Actions */}
        {isDb && !(s as ISkill).isBuiltIn && (
          <div className="flex items-center gap-1 border-t border-gray-100 pt-2 dark:border-gray-700">
            <button onClick={() => openEditForm(s as ISkill)} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700">
              <Pencil size={11} /> 编辑
            </button>
            <button onClick={() => { if (confirm('确认删除？')) deleteMutation.mutate(s.id) }} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-gray-500 hover:bg-red-50 hover:text-red-600 dark:text-gray-400 dark:hover:bg-red-900/20">
              <Trash2 size={11} /> 删除
            </button>
          </div>
        )}
        {isDb && (s as ISkill).isBuiltIn && (
          <div className="border-t border-gray-100 pt-2 dark:border-gray-700">
            <span className="text-[10px] text-gray-300 dark:text-gray-600">内置技能</span>
          </div>
        )}
        {isLocal && (
          <div className="border-t border-gray-100 pt-2 dark:border-gray-700">
            <span className="truncate text-[10px] text-gray-300 dark:text-gray-600" title={(s as ILocalSkill).filePath}>
              {(s as ILocalSkill).filePath}
            </span>
          </div>
        )}
      </div>
    )
  }

  const mainContent = (
    <div className="flex flex-1 overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* Left sidebar */}
      <div className="flex w-56 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-100 p-4 dark:border-gray-800">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">技能管理</h2>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 dark:border-gray-800">
          <button
            onClick={() => { setTab('database'); setActiveCategory(null) }}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${tab === 'database' ? 'border-b-2 border-violet-500 text-violet-600 dark:text-violet-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
          >
            <Zap size={12} className="mr-1 inline" />
            数据库
          </button>
          <button
            onClick={() => { setTab('local'); setActiveCategory(null); refetchLocal() }}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${tab === 'local' ? 'border-b-2 border-violet-500 text-violet-600 dark:text-violet-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
          >
            <FolderOpen size={12} className="mr-1 inline" />
            本地
          </button>
        </div>

        {/* Category list */}
        <div className="flex-1 overflow-y-auto p-2">
          <button
            onClick={() => setActiveCategory(null)}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${activeCategory === null ? 'bg-violet-50 font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-200' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/50'}`}
          >
            <span className="flex items-center gap-2"><Bot size={14} /> 全部</span>
            <span className="text-[10px] text-gray-400">{skills.length}</span>
          </button>
          {categories.map(([cat, count]) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${activeCategory === cat ? 'bg-violet-50 font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-200' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/50'}`}
            >
              <span className="flex items-center gap-2"><Hash size={14} /> {cat}</span>
              <span className="text-[10px] text-gray-400">{count}</span>
            </button>
          ))}
        </div>

        {/* Directory config button for local tab */}
        {tab === 'local' && (
          <div className="border-t border-gray-100 p-2 dark:border-gray-800">
            <button
              onClick={() => setShowDirConfig(true)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-gray-500 transition-colors hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50"
            >
              <Settings size={13} />
              配置技能目录
            </button>
          </div>
        )}
      </div>

      {/* Main content area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索技能..."
              className="h-8 w-56 rounded-lg border border-gray-200 bg-gray-50 py-1 pl-3 pr-3 text-xs outline-none placeholder:text-gray-400 focus:border-violet-300 focus:bg-white focus:ring-2 focus:ring-violet-500/10 dark:border-gray-700 dark:bg-gray-800"
            />
            {activeCategory && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${getCategoryColor(activeCategory)}`}>
                {activeCategory}
                <button onClick={() => setActiveCategory(null)} className="ml-0.5 opacity-60 hover:opacity-100"><X size={10} /></button>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {tab === 'local' && (
              <button onClick={() => refetchLocal()} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800" title="刷新本地技能">
                <RefreshCw size={13} />
              </button>
            )}
            {tab === 'database' && (
              <button onClick={openCreateForm} className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-violet-700">
                <Plus size={13} /> 新建技能
              </button>
            )}
          </div>
        </div>

        {/* Cards grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'local' && localLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Loader2 size={32} className="mb-3 animate-spin text-violet-400" />
              <p className="text-sm">正在扫描本地技能...</p>
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Zap size={36} className="mb-3 text-gray-300 dark:text-gray-600" />
              <p className="text-sm">{tab === 'local' ? '未发现本地技能' : '暂无技能'}</p>
              {tab === 'local' && (
                <button onClick={() => setShowDirConfig(true)} className="mt-2 text-xs text-violet-500 hover:underline">
                  配置技能目录
                </button>
              )}
              {tab === 'database' && (
                <button onClick={openCreateForm} className="mt-2 text-xs text-violet-500 hover:underline">
                  创建第一个技能
                </button>
              )}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredSkills.map(s => renderSkillCard(s, tab === 'local'))}
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                  <Zap size={16} className="text-violet-600 dark:text-violet-400" />
                </div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                  {editingId ? '编辑技能' : '新建技能'}
                </h3>
              </div>
              <button onClick={closeForm} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"><X size={18} /></button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">分类</label>
                  <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="如：通用、编程" className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-violet-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">名称（英文）</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="用于 /name 触发" className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-violet-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">描述</label>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="技能功能描述" className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-violet-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">配置 JSON</label>
                <textarea value={form.config} onChange={(e) => setForm({ ...form, config: e.target.value })} className="h-32 w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs outline-none focus:border-violet-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700" />
              </div>
              {editingId && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.isEnabled} onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })} />
                  启用
                </label>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-gray-700">
              <button onClick={closeForm} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">取消</button>
              <button onClick={handleSave} disabled={!form.name.trim() || !form.description.trim()} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">
                {editingId ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Directory config modal */}
      {showDirConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <FolderOpen size={16} className="text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">配置技能目录</h3>
                  <p className="text-xs text-gray-500">添加包含技能定义文件的目录路径</p>
                </div>
              </div>
              <button onClick={() => setShowDirConfig(false)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"><X size={18} /></button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="flex gap-2">
                <input
                  value={dirInput}
                  onChange={(e) => setDirInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddDir() }}
                  placeholder="输入目录路径，如 /home/user/skills"
                  className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-amber-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700"
                />
                <button onClick={handleAddDir} className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600">
                  添加
                </button>
              </div>
              <div className="max-h-48 space-y-1.5 overflow-y-auto">
                {directories.length === 0 ? (
                  <div className="py-4 text-center text-xs text-gray-400">
                    <AlertCircle size={16} className="mx-auto mb-1" />
                    暂未配置技能目录
                  </div>
                ) : (
                  directories.map(dir => (
                    <div key={dir} className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
                      <span className="truncate text-xs text-gray-700 dark:text-gray-300" title={dir}>{dir}</span>
                      <button onClick={() => handleRemoveDir(dir)} className="ml-2 shrink-0 text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
                    </div>
                  ))
                )}
              </div>
              <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
                <p className="text-[11px] leading-relaxed text-blue-700 dark:text-blue-300">
                  目录结构：每个子文件夹包含一个 <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">skill.json</code> 或 <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">SKILL.md</code> 文件。
                  也支持根目录下的 <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">.json</code> 文件。
                </p>
              </div>
            </div>
            <div className="flex justify-end border-t border-gray-100 px-5 py-3 dark:border-gray-700">
              <button onClick={() => setShowDirConfig(false)} className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <AppLayout showSidebar={false} mainContent={mainContent}>
      {null}
    </AppLayout>
  )
}
