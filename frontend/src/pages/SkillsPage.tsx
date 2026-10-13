import { confirm } from '../components/confirm'
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  FolderOpen,
  FolderSearch,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Terminal,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import AppLayout from '../components/AppLayout'
import FolderPickerDialog from '../components/FolderPickerDialog'
import SlidingPill from '../components/SlidingPill'
import { skillService } from '../services/skillService'
import type { ILocalSkill } from '../services/skillService'
import type { ISkill } from '../types'
import { Button, Input, Modal, Textarea } from '../components/ui'

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
  const { t } = useTranslation('agents')
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabKey>('database')
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ category: '', name: '', description: '', config: defaultConfig, isEnabled: true })
  const [showDirConfig, setShowDirConfig] = useState(false)
  const [showFolderPicker, setShowFolderPicker] = useState(false)
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
    for (const s of skills) {
      const key = s.category || t('skillsPage.uncategorized')
      map.set(key, (map.get(key) || 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [skills, t])

  const filteredSkills = useMemo(() => {
    const kw = search.trim().toLowerCase()
    return skills.filter(s => {
      if (activeCategory && (s.category || t('skillsPage.uncategorized')) !== activeCategory) return false
      if (kw && !s.name.toLowerCase().includes(kw) && !s.description.toLowerCase().includes(kw)) return false
      return true
    })
  }, [skills, search, activeCategory, t])

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

  // 打开前端目录选择器；选中后直接添加
  const handleBrowseDir = () => setShowFolderPicker(true)

  const handleFolderPicked = (picked: string) => {
    setShowFolderPicker(false)
    const trimmed = picked.trim()
    if (!trimmed || directories.includes(trimmed)) return
    updateDirsMutation.mutate([...directories, trimmed])
    setDirInput('')
  }

  const renderSkillCard = (skill: ISkill | ILocalSkill, isLocal: boolean) => {
    const s = skill
    const isDb = !isLocal
    return (
      <div
        key={s.id}
        className={`group relative flex flex-col rounded-2xl border bg-white glass p-4 transition-all duration-200 ${
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
              <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${getCategoryColor(s.category || t('skillsPage.uncategorized'))}`}>
                {s.category || t('skillsPage.uncategorized')}
              </span>
            </div>
          </div>
          {isDb && (s as ISkill).isBuiltIn && (
            <span className="shrink-0 rounded-full bg-gray-100 glass px-2 py-0.5 text-[10px] text-gray-400 dark:bg-white/[0.06]">{t('card.builtIn')}</span>
          )}
          {isLocal && (
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:bg-amber-900/30">{t('card.local')}</span>
          )}
        </div>

        <p className="mb-3 line-clamp-2 flex-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {s.description}
        </p>

        {isDb && !(s as ISkill).isBuiltIn && (
          <div className="flex items-center gap-1 border-t border-gray-100 pt-2.5 dark:border-gray-800">
            <Button variant="ghost" tone="gray" pill className="flex items-center gap-1 px-2.5 py-1 text-gray-500 hover:text-gray-700" onClick={() => openEditForm(s as ISkill)}>
              <Pencil size={11} /> {t('common:edit')}
            </Button>
            <button onClick={() => { confirm({ message: t('common:deleteConfirm'), onConfirm: () => deleteMutation.mutate(s.id) }) }} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-red-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400">
              <Trash2 size={11} /> {t('common:delete')}
            </button>
          </div>
        )}
        {isDb && (s as ISkill).isBuiltIn && (
          <div className="border-t border-gray-100 pt-2.5 dark:border-gray-800">
            <span className="text-[10px] text-gray-300 dark:text-gray-600">{t('card.builtInSkill')}</span>
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
    <div className="flex-1 overflow-y-auto bg-transparent">
      <div className="mx-auto max-w-6xl px-8 py-8">
        {/* 页头 */}
        <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-sm shadow-amber-500/20">
              <Zap size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('skillsPage.title')}</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('skillsPage.subtitle')}</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
            <span>
              <Trans ns="agents" i18nKey="skillsPage.skillCount" values={{ n: skills.length }} components={{ b: <b className="text-sm font-semibold text-gray-700 dark:text-gray-200" /> }} />
            </span>
            <span className="h-3.5 w-px bg-gray-200 dark:bg-gray-700" />
            <span>
              <Trans ns="agents" i18nKey="page.categoryCount" values={{ n: categories.length }} components={{ b: <b className="text-sm font-semibold text-amber-600 dark:text-amber-400" /> }} />
            </span>
          </div>
        </div>

        {/* 选项卡 */}
        <SlidingPill value={tab} className="mb-4 flex items-center gap-1 rounded-full bg-gray-100/80 p-1 dark:bg-white/[0.06] glass-track">
          {([
            { key: 'database' as TabKey, labelKey: 'tabs.database', icon: Zap },
            { key: 'local' as TabKey, labelKey: 'tabs.local', icon: FolderOpen },
          ]).map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.key}
                onClick={() => { setTab(item.key); setActiveCategory(null); if (item.key === 'local') refetchLocal() }}
                data-pill-key={item.key}
                className={`relative flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-medium transition-all ${
                  tab === item.key
                    ? 'text-gray-800 dark:text-gray-100'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <Icon size={14} />
                {t(item.labelKey)}
              </button>
            )
          })}
        </SlidingPill>

        {/* 工具栏：分类筛选 + 搜索 + 操作 */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setActiveCategory(null)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all ${filterPill(activeCategory === null)}`}
            >
              {t('common:all')}
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
            <Input tone="amber" glass pill
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('skillsPage.searchSkills')}
              className="w-full pl-10 pr-3 text-sm"
            />
          </div>
          {tab === 'local' ? (
            <>
              <Button variant="secondary" pill className="flex shrink-0 items-center gap-1.5 px-4 py-2 text-gray-700 hover:bg-red-50 hover:text-red-600" onClick={() => setShowDirConfig(true)}>
                <Settings size={14} />
                {t('skillsPage.configureDirectories')}{directories.length > 0 && <span className="text-[11px] text-gray-400">{directories.length}</span>}
              </Button>
              <Button variant="secondary" pill className="flex shrink-0 items-center gap-1.5 px-4 py-2 text-gray-700" onClick={() => refetchLocal()}
                title={t('skillsPage.refreshLocalSkills')}>
                <RefreshCw size={14} />
                {t('common:refresh')}
              </Button>
            </>
          ) : (
            <button
              onClick={openCreateForm}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-amber-500/20 transition-all hover:shadow-md active:scale-[0.97]"
            >
              <Plus size={16} />
              {t('skillsPage.newSkill')}
            </button>
          )}
        </div>

        {/* 卡片网格 */}
        {tab === 'local' && localLoading ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-24 text-gray-400 dark:border-gray-800">
            <Loader2 size={32} className="mb-3 animate-spin text-amber-400" />
            <p className="text-sm">{t('skillsPage.scanningLocalSkills')}</p>
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-24 text-gray-400 dark:border-gray-800 dark:text-gray-600">
            <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gray-100 dark:bg-white/[0.04]">
              <Zap size={36} className="opacity-50" />
            </div>
            <p className="text-sm font-medium">{tab === 'local' ? t('empty.localSkills') : t('empty.skills')}</p>
            {tab === 'local' ? (
              <Button variant="secondary" pill className="mt-2 text-amber-500" onClick={() => setShowDirConfig(true)}>
                {t('empty.configureSkillDirs')}
              </Button>
            ) : (
              <Button variant="link" tone="amber" size="sm" className="mt-2 text-amber-500" onClick={openCreateForm}>
                {t('empty.createFirstSkill')}
              </Button>
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
        <Modal open onClose={closeForm} dismissible={false} size="lg" className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <Zap size={16} className="text-amber-600 dark:text-amber-400" />
                </div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                  {editingId ? t('form.editSkill') : t('skillsPage.newSkill')}
                </h3>
              </div>
              <button onClick={closeForm} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"><X size={18} /></button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('form.category')}</label>
                  <Input tone="amber" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder={t('form.skillCategoryPlaceholder')} className="w-full" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('form.skillName')}</label>
                  <Input tone="amber" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('form.skillNamePlaceholder')} className="w-full" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('common:description')}</label>
                <Input tone="amber" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t('form.skillDescriptionPlaceholder')} className="w-full" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('form.configJson')}</label>
                <Textarea tone="amber" value={form.config} onChange={(e) => setForm({ ...form, config: e.target.value })} className="h-32 w-full resize-none font-mono text-xs" />
              </div>
              {editingId && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.isEnabled} onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })} />
                  {t('common:enable')}
                </label>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-gray-700">
              <Button variant="link" tone="amber" size="sm" className="px-4 py-2 text-gray-600" onClick={closeForm}>{t('common:cancel')}</Button>
              <Button variant="link" tone="amber" size="sm" className="px-4 py-2" onClick={handleSave} disabled={!form.name.trim() || !form.description.trim()}>
                {editingId ? t('common:save') : t('common:create')}
              </Button>
            </div>
        </Modal>
      )}

      {/* Directory config modal */}
      {showDirConfig && (
        <Modal open onClose={() => setShowDirConfig(false)} dismissible={false} className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <FolderOpen size={16} className="text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('dir.skillTitle')}</h3>
                  <p className="text-xs text-gray-500">{t('dir.hint')}</p>
                </div>
              </div>
              <button onClick={() => setShowDirConfig(false)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"><X size={18} /></button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="flex gap-2">
                <Button variant="primary" tone="amber" className="flex shrink-0 items-center gap-1.5 px-3 py-2 hover:bg-gray-100 hover:text-gray-600" onClick={handleBrowseDir}>
                  <FolderSearch size={14} />
                  {t('dir.browse')}
                </Button>
                <Input tone="amber"
                  value={dirInput}
                  onChange={(e) => setDirInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddDir() }}
                  placeholder={t('dir.skillPathPlaceholder')}
                  className="flex-1"
                />
                <Button variant="ghost" tone="gray" className="px-3 py-2 text-gray-700" onClick={handleAddDir} disabled={!dirInput.trim()}>
                  {t('common:add')}
                </Button>
              </div>
              <div className="max-h-48 space-y-1.5 overflow-y-auto">
                {directories.length === 0 ? (
                  <div className="py-4 text-center text-xs text-gray-400">
                    <AlertCircle size={16} className="mx-auto mb-1" />
                    {t('dir.noSkillDirs')}
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
                  <Trans
                    ns="agents"
                    i18nKey="dir.skillStructure"
                    components={{ code: <code className="rounded bg-amber-100 px-1 dark:bg-amber-800" /> }}
                  />
                </p>
              </div>
            </div>
            <div className="flex justify-end border-t border-gray-100 px-5 py-3 dark:border-gray-700">
              <Button variant="primary" tone="amber" className="px-4 py-2 text-gray-700" onClick={() => setShowDirConfig(false)}>
                {t('dir.done')}
              </Button>
            </div>
        </Modal>
      )}

      {/* 前端目录选择器 */}
      {showFolderPicker && (
        <FolderPickerDialog
          initialPath={dirInput.trim() || directories[directories.length - 1]}
          title={t('dir.pickSkillDir')}
          onClose={() => setShowFolderPicker(false)}
          onPick={handleFolderPicked}
        />
      )}

    </AppLayout>
  )
}
