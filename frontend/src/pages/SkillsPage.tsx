import { confirm } from '../components/confirm'
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
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

  const renderSkillCard = (skill: ISkill | ILocalSkill, isLocal: boolean) => {
    const s = skill
    const isDb = !isLocal
    return (
      <div
        key={s.id}
        className={`group relative flex flex-col rounded-2xl border bg-white p-4 transition-all duration-200 ${
          s.isEnabled
            ? 'border-gray-200 hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700'
            : 'border-gray-100 bg-gray-50/60 opacity-60 dark:border-gray-800 dark:bg-gray-900/60'
        }`}
      >
        <div className="mb-2 flex items-start justify-between">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-900/20">
              {isLocal ? <Terminal size={16} className="text-amber-500" /> : <Zap size={16} className="text-amber-500" />}
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">/{s.name}</h3>
              <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${getCategoryColor(s.category || '未分类')}`}>
                {s.category || '未分类'}
              </span>
            </div>
          </div>
          {isDb && (s as ISkill).isBuiltIn && (
            <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-400 dark:bg-white/[0.06]">内置</span>
          )}
          {isLocal && (
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:bg-amber-900/30">本地</span>
          )}
        </div>

        <p className="mb-3 line-clamp-2 flex-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {s.description}
        </p>

        {isDb && !(s as ISkill).isBuiltIn && (
          <div className="flex items-center gap-1 border-t border-gray-100 pt-2.5 dark:border-gray-800">
            <button onClick={() => openEditForm(s as ISkill)} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700">
              <Pencil size={11} /> 编辑
            </button>
            <button onClick={() => { confirm({ message: '确认删除？', onConfirm: () => deleteMutation.mutate(s.id) }) }} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-red-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400">
              <Trash2 size={11} /> 删除
            </button>
          </div>
        )}
        {isDb && (s as ISkill).isBuiltIn && (
          <div className="border-t border-gray-100 pt-2.5 dark:border-gray-800">
            <span className="text-[10px] text-gray-300 dark:text-gray-600">内置技能</span>
          </div>
        )}
        {isLocal && (
          <div className="border-t border-gray-100 pt-2.5 dark:border-gray-800">
            <span className="truncate text-[10px] text-gray-300 dark:text-gray-600" title={(s as ILocalSkill).filePath}>
              {(s as ILocalSkill).filePath}
            </span>
          </div>
        )}
      </div>
    )
  }

  const filterPill = (active: boolean) =>
    active
      ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/20'
      : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'

  const mainContent = (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto max-w-6xl px-8 py-8">
        {/* 页头 */}
        <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-sm shadow-amber-500/20">
              <Zap size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">技能</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">通过 /name 触发预设技能，自定义提示词与工具组合</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
            <span><b className="text-sm font-semibold text-gray-700 dark:text-gray-200">{skills.length}</b> 个技能</span>
            <span className="h-3.5 w-px bg-gray-200 dark:bg-gray-700" />
            <span><b className="text-sm font-semibold text-amber-600 dark:text-amber-400">{categories.length}</b> 个分类</span>
          </div>
        </div>

        {/* 选项卡 */}
        <div className="mb-4 flex items-center gap-1 rounded-full bg-gray-100/80 p-1 dark:bg-white/[0.06]">
          {([
            { key: 'database' as TabKey, label: '数据库', icon: Zap },
            { key: 'local' as TabKey, label: '本地', icon: FolderOpen },
          ]).map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setActiveCategory(null); if (t.key === 'local') refetchLocal() }}
                className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-medium transition-all ${
                  tab === t.key
                    ? 'bg-white text-gray-800 shadow-sm dark:bg-white/10 dark:text-gray-100'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* 工具栏：分类筛选 + 搜索 + 操作 */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setActiveCategory(null)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all ${filterPill(activeCategory === null)}`}
            >
              全部
              <span className="text-[11px] opacity-70">{skills.length}</span>
            </button>
            {categories.map(([cat, count]) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all ${filterPill(activeCategory === cat)}`}
              >
                {cat}
                <span className="text-[11px] opacity-70">{count}</span>
              </button>
            ))}
          </div>
          <div className="relative ml-auto min-w-[180px] max-w-xs flex-1">
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索技能..."
              className="w-full rounded-full border border-gray-200 bg-white py-2 pl-10 pr-3 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-gray-800 dark:bg-gray-900 dark:focus:ring-amber-950/40"
            />
          </div>
          {tab === 'local' ? (
            <button
              onClick={() => refetchLocal()}
              title="刷新本地技能"
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <RefreshCw size={14} />
              刷新
            </button>
          ) : (
            <button
              onClick={openCreateForm}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-amber-500/20 transition-all hover:shadow-md active:scale-[0.97]"
            >
              <Plus size={16} />
              新建技能
            </button>
          )}
        </div>

        {/* 卡片网格 */}
        {tab === 'local' && localLoading ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-24 text-gray-400 dark:border-gray-800">
            <Loader2 size={32} className="mb-3 animate-spin text-amber-400" />
            <p className="text-sm">正在扫描本地技能...</p>
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-24 text-gray-400 dark:border-gray-800 dark:text-gray-600">
            <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gray-100 dark:bg-white/[0.04]">
              <Zap size={36} className="opacity-50" />
            </div>
            <p className="text-sm font-medium">{tab === 'local' ? '未发现本地技能' : '暂无技能'}</p>
            {tab === 'local' ? (
              <button onClick={() => setShowDirConfig(true)} className="mt-2 text-xs text-amber-500 hover:underline">
                配置技能目录
              </button>
            ) : (
              <button onClick={openCreateForm} className="mt-2 text-xs text-amber-500 hover:underline">
                创建第一个技能
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredSkills.map(s => renderSkillCard(s, tab === 'local'))}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <AppLayout showSidebar={false} mainContent={mainContent}>
      {/* Create/Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <Zap size={16} className="text-amber-600 dark:text-amber-400" />
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
                  <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="如：通用、编程" className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-amber-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">名称（英文）</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="用于 /name 触发" className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-amber-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">描述</label>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="技能功能描述" className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-amber-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">配置 JSON</label>
                <textarea value={form.config} onChange={(e) => setForm({ ...form, config: e.target.value })} className="h-32 w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs outline-none focus:border-amber-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700" />
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
              <button onClick={handleSave} disabled={!form.name.trim() || !form.description.trim()} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">
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
              <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
                <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                  目录结构：每个子文件夹包含一个 <code className="rounded bg-amber-100 px-1 dark:bg-amber-800">skill.json</code> 或 <code className="rounded bg-amber-100 px-1 dark:bg-amber-800">SKILL.md</code> 文件。
                  也支持根目录下的 <code className="rounded bg-amber-100 px-1 dark:bg-amber-800">.json</code> 文件。
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

    </AppLayout>
  )
}
