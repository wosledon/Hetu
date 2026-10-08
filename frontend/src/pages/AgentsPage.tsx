import { confirm } from '../components/confirm'
import { useState, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Bot,
  BookOpen,
  Brain,
  CalendarClock,
  ClipboardList,
  Download,
  Edit2,
  FileEdit,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  FolderTree,
  Globe,
  HelpCircle,
  History,
  Import,
  Library,
  List,
  ListChecks,
  Loader2,
  Lock,
  Network,
  PenLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  Sparkles,
  Tags,
  Terminal,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import FolderPickerDialog from '../components/FolderPickerDialog'
import Select from '../components/Select'
import MultiSelect from '../components/MultiSelect'
import { promptPresetService } from '../services/promptPresetService'
import { skillService } from '../services/skillService'
import { aiModelService } from '../services/aiProviderService'
import type { ILocalPromptPreset, IPromptPreset } from '../types'
import type { CreatePromptPresetRequest, UpdatePromptPresetRequest } from '../services/promptPresetService'

type TabKey = 'database' | 'local'

const CATEGORY_COLORS: Record<string, string> = {
  通用: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  写作: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  编程: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  分析: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  创意: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  自定义: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  导入: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  本地: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
}

const getCategoryColor = (category: string) =>
  CATEGORY_COLORS[category] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'

const TOOL_ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  search_notes: Search,
  read_note: BookOpen,
  list_notes: List,
  search_web: Globe,
  search_memory: Brain,
  list_memories: Brain,
  delete_memory: Trash2,
  search_graph: Network,
  create_note: PenLine,
  update_note: FileEdit,
  delete_note: Trash2,
  move_note: FolderInput,
  list_note_versions: History,
  restore_note_version: RotateCcw,
  list_notebooks: FolderTree,
  create_notebook: FolderPlus,
  list_tags: Tags,
  set_note_tags: Tags,
  list_knowledge_items: Library,
  create_memory: Save,
  ask_question: HelpCircle,
  todo: ClipboardList,
  plan: ListChecks,
  run_command: Zap,
  create_scheduled_task: CalendarClock,
  list_scheduled_tasks: CalendarClock,
  delete_scheduled_task: CalendarClock,
  list_skills: Sparkles,
}

const renderToolIcon = (name: string, className = 'text-gray-500') => {
  const Icon = TOOL_ICON_MAP[name]
  return Icon ? <Icon size={14} className={className} /> : <Sparkles size={14} className={className} />
}

const REASONING_EFFORT_OPTIONS = [
  { value: '', label: '跟随模型' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

const parseIdList = (json?: string): string[] => {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const AVAILABLE_TOOLS = [
  { name: 'search_notes', label: '搜索笔记', category: '检索' },
  { name: 'read_note', label: '读取笔记', category: '检索' },
  { name: 'list_notes', label: '浏览笔记', category: '检索' },
  { name: 'list_notebooks', label: '笔记本列表', category: '检索' },
  { name: 'list_tags', label: '标签列表', category: '检索' },
  { name: 'list_note_versions', label: '版本历史', category: '检索' },
  { name: 'list_knowledge_items', label: '知识库列表', category: '检索' },
  { name: 'search_web', label: '网络搜索', category: '检索' },
  { name: 'search_memory', label: '搜索记忆', category: '检索' },
  { name: 'list_memories', label: '浏览记忆', category: '检索' },
  { name: 'search_graph', label: '搜索图谱', category: '检索' },
  { name: 'list_skills', label: '技能列表', category: '检索' },
  { name: 'create_note', label: '创建笔记', category: '写入' },
  { name: 'update_note', label: '更新笔记', category: '写入' },
  { name: 'delete_note', label: '删除笔记', category: '写入' },
  { name: 'move_note', label: '移动笔记', category: '写入' },
  { name: 'set_note_tags', label: '设置标签', category: '写入' },
  { name: 'create_notebook', label: '创建笔记本', category: '写入' },
  { name: 'restore_note_version', label: '恢复版本', category: '写入' },
  { name: 'create_memory', label: '保存记忆', category: '写入' },
  { name: 'delete_memory', label: '删除记忆', category: '写入' },
  { name: 'ask_question', label: '向用户提问', category: '交互' },
  { name: 'todo', label: '任务管理', category: '交互' },
  { name: 'plan', label: '提交执行计划', category: '交互' },
  { name: 'create_scheduled_task', label: '创建定时任务', category: '执行' },
  { name: 'list_scheduled_tasks', label: '定时任务列表', category: '执行' },
  { name: 'delete_scheduled_task', label: '删除定时任务', category: '执行' },
  { name: 'run_command', label: '执行命令', category: '执行' },
] as const

/** 表单内下拉触发器样式（含 flex 布局，避免文字与箭头换行） */
const agentFormTriggerCls =
  'flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-rose-300 dark:border-gray-600 dark:bg-gray-700'

export default function AgentsPage() {
  const queryClient = useQueryClient()
  // 通用智能体的数据来源：本地目录 / 数据库（专业智能体仅数据库）
  const [generalSource, setGeneralSource] = useState<TabKey>('database')
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    category: '', name: '', content: '',
    agentType: 'General' as 'General' | 'Professional',
    subAgentIds: [] as string[],
    modelId: '',
    reasoningEffort: '',
    skillIds: [] as string[],
  })
  // 「从通用智能体创建专业智能体」：选中的源通用智能体
  const [sourceAgentId, setSourceAgentId] = useState('')
  const [enabledTools, setEnabledTools] = useState<string[]>(AVAILABLE_TOOLS.map(t => t.name))
  const [toolApprovals, setToolApprovals] = useState<Record<string, string>>({})
  const [toolSearch, setToolSearch] = useState('')
  const [showDirConfig, setShowDirConfig] = useState(false)
  const [showFolderPicker, setShowFolderPicker] = useState(false)
  const [dirInput, setDirInput] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Database presets
  const { data: dbPresets = [] } = useQuery({
    queryKey: ['promptPresets'],
    queryFn: () => promptPresetService.getAll(),
  })
  // Local presets（表单内的「从通用智能体创建」也要列本地智能体，故打开表单时一并加载）
  const { data: localPresets = [], isLoading: localLoading, refetch: refetchLocal } = useQuery({
    queryKey: ['localPromptPresets'],
    queryFn: () => promptPresetService.getLocal(),
    enabled: generalSource === 'local' || showForm,
  })
  // Directories
  const { data: directories = [] } = useQuery({
    queryKey: ['promptPresetDirectories'],
    queryFn: () => promptPresetService.getDirectories(),
    enabled: showDirConfig,
  })
  // 专业智能体配置数据源：模型 + 技能（数据库 + 本地）
  const { data: models = [] } = useQuery({
    queryKey: ['aiModels'],
    queryFn: () => aiModelService.getAll(),
  })
  const { data: skills = [] } = useQuery({
    queryKey: ['skills'],
    queryFn: () => skillService.getAll(),
  })
  const { data: localSkills = [] } = useQuery({
    queryKey: ['localSkills'],
    queryFn: () => skillService.getLocalSkills(),
  })

  const createMutation = useMutation({
    mutationFn: (data: CreatePromptPresetRequest) =>
      promptPresetService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promptPresets'] })
      closeForm()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePromptPresetRequest }) =>
      promptPresetService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promptPresets'] })
      closeForm()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: promptPresetService.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['promptPresets'] }),
  })

  const importMutation = useMutation({
    mutationFn: promptPresetService.import,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['promptPresets'] }),
  })

  // 从通用智能体创建专业智能体：克隆其提示词/工具配置，生成专业版草稿后直接打开编辑表单
  const createProfessionalMutation = useMutation({
    mutationFn: promptPresetService.createProfessional,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['promptPresets'] })
      if (created) {
        openEditForm(created)
        setSourceAgentId('')
      }
    },
  })

  // 从本地通用智能体创建专业智能体：本地智能体只读，落库为专业版草稿后打开编辑表单
  const createProfessionalFromLocalMutation = useMutation({
    mutationFn: promptPresetService.createProfessionalFromLocal,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['promptPresets'] })
      if (created) {
        openEditForm(created)
        setSourceAgentId('')
      }
    },
  })

  const updateDirsMutation = useMutation({
    mutationFn: (dirs: string[]) => promptPresetService.updateDirectories(dirs),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['promptPresetDirectories'] }),
  })

  const presets = generalSource === 'database' ? dbPresets : localPresets

  const categories = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of presets) map.set(p.category, (map.get(p.category) || 0) + 1)
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [presets])

  const filteredPresets = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return presets.filter(p => {
      if (activeCategory && p.category !== activeCategory) return false
      if (keyword && !p.name.toLowerCase().includes(keyword) && !p.content.toLowerCase().includes(keyword)) return false
      return true
    })
  }, [presets, search, activeCategory])

  // 上下分栏：上为通用智能体，下为专业智能体（本地智能体均为通用）
  const isLocalTab = generalSource === 'local'
  const generalPresets = useMemo(
    () => filteredPresets.filter(p => isLocalTab || ((p as IPromptPreset).agentType ?? 'General') === 'General'),
    [filteredPresets, isLocalTab],
  )
  const professionalPresets = useMemo(
    () => isLocalTab ? [] : filteredPresets.filter(p => ((p as IPromptPreset).agentType ?? 'General') === 'Professional'),
    [filteredPresets, isLocalTab],
  )

  // 可管理的子智能体：仅专业智能体（排除自身，避免自引用）
  const manageableAgents = useMemo(
    () => dbPresets.filter(p => (p.agentType ?? 'General') === 'Professional' && p.id !== editingId),
    [dbPresets, editingId],
  )

  // 「从通用智能体创建专业智能体」的源列表：本地 + 数据库通用智能体
  const sourceAgentOptions = useMemo(() => [
    ...dbPresets
      .filter(p => (p.agentType ?? 'General') === 'General')
      .map(a => ({ value: `db:${a.id}`, label: `${a.name}（${a.category} · 数据库）` })),
    ...localPresets.map(a => ({ value: `local:${a.id}`, label: `${a.name}（${a.category} · 本地）` })),
  ], [dbPresets, localPresets])

  // 可用技能：数据库技能 + 本地技能
  const selectableSkills = useMemo(() => [
    ...skills.map(s => ({ id: s.id, name: s.name, description: s.description, isEnabled: s.isEnabled, isLocal: false })),
    ...localSkills.map(s => ({ id: s.id, name: s.name, description: s.description, isEnabled: s.isEnabled, isLocal: true })),
  ], [skills, localSkills])

  const emptyForm = {
    category: '自定义', name: '', content: '',
    agentType: 'General' as 'General' | 'Professional',
    subAgentIds: [] as string[], modelId: '', reasoningEffort: '', skillIds: [] as string[],
  }

  const openCreateForm = () => {
    setEditingId(null)
    setForm(emptyForm)
    setEnabledTools(AVAILABLE_TOOLS.map(t => t.name))
    setToolApprovals({})
    setToolSearch('')
    setSourceAgentId('')
    setShowForm(true)
  }
  const openEditForm = (preset: IPromptPreset) => {
    setEditingId(preset.id)
    setForm({
      category: preset.category,
      name: preset.name,
      content: preset.content,
      agentType: preset.agentType ?? 'General',
      subAgentIds: parseIdList(preset.subAgentIds),
      modelId: preset.modelId ?? '',
      reasoningEffort: preset.reasoningEffort ?? '',
      skillIds: parseIdList(preset.skillIds),
    })
    try {
      const config = preset.toolsConfig ? JSON.parse(preset.toolsConfig) : {}
      setEnabledTools(config.tools || AVAILABLE_TOOLS.map(t => t.name))
      setToolApprovals(config.toolApprovals || {})
    } catch {
      setEnabledTools(AVAILABLE_TOOLS.map(t => t.name))
      setToolApprovals({})
    }
    setShowForm(true)
  }
  const closeForm = () => { setShowForm(false); setEditingId(null); setForm(emptyForm); setEnabledTools(AVAILABLE_TOOLS.map(t => t.name)); setToolApprovals({}); setToolSearch(''); setSourceAgentId('') }

  const isProfessional = form.agentType === 'Professional'

  // 可用工具：按分类分组 + 搜索过滤
  const toolGroups = useMemo(() => {
    const q = toolSearch.trim().toLowerCase()
    const matched = AVAILABLE_TOOLS.filter(t => !q || t.label.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
    return Object.entries(
      matched.reduce((acc, tool) => {
        (acc[tool.category] ??= []).push(tool)
        return acc
      }, {} as Record<string, typeof AVAILABLE_TOOLS[number][]>)
    )
  }, [toolSearch])

  const toggleToolGroup = (tools: readonly typeof AVAILABLE_TOOLS[number][]) => {
    const allOn = tools.every(t => enabledTools.includes(t.name))
    if (allOn) setEnabledTools(prev => prev.filter(n => !tools.some(t => t.name === n)))
    else setEnabledTools(prev => [...new Set([...prev, ...tools.map(t => t.name)])])
  }

  // 从源智能体创建专业智能体：db: 前缀走数据库克隆，local: 前缀走本地克隆
  const handleCreateProfessionalFromSource = () => {
    if (!sourceAgentId) return
    if (sourceAgentId.startsWith('db:')) createProfessionalMutation.mutate(sourceAgentId.slice(3))
    else createProfessionalFromLocalMutation.mutate(sourceAgentId.slice(6))
  }

  const openCreateProfessionalForm = () => {
    setEditingId(null)
    setForm({ ...emptyForm, agentType: 'Professional' })
    setEnabledTools(AVAILABLE_TOOLS.map(t => t.name))
    setToolApprovals({})
    setToolSearch('')
    setSourceAgentId('')
    setShowForm(true)
  }

  const handleSave = () => {
    if (!form.name.trim() || !form.content.trim()) return
    const toolsConfigJson = JSON.stringify({ tools: enabledTools, toolApprovals })
    const payload = {
      category: form.category,
      name: form.name,
      content: form.content,
      agentType: form.agentType,
      toolsConfig: toolsConfigJson,
      // 专业智能体专属字段；通用智能体不下发，后端按类型兜底
      ...(isProfessional
        ? {
            subAgentIds: JSON.stringify(form.subAgentIds),
            modelId: form.modelId || undefined,
            reasoningEffort: form.reasoningEffort || undefined,
            skillIds: JSON.stringify(form.skillIds),
          }
        : {}),
    }
    if (editingId) {
      const preset = dbPresets.find(p => p.id === editingId)
      updateMutation.mutate({ id: editingId, data: { ...payload, sortOrder: preset?.sortOrder ?? 0 } })
    } else {
      createMutation.mutate(payload)
    }
  }

  const handleExport = async () => {
    const data = await promptPresetService.export()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'agents.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const items = JSON.parse(reader.result as string)
        if (Array.isArray(items)) importMutation.mutate(items)
      } catch { /* ignore */ }
    }
    reader.readAsText(file)
    e.target.value = ''
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

  const getToolCount = (toolsConfig?: string) => {
    if (!toolsConfig) return AVAILABLE_TOOLS.length
    try {
      const config = JSON.parse(toolsConfig)
      return config.tools?.length ?? AVAILABLE_TOOLS.length
    } catch {
      return AVAILABLE_TOOLS.length
    }
  }

  const renderPresetCard = (preset: IPromptPreset | ILocalPromptPreset, isLocal: boolean) => {
    const p = preset
    const toolCount = getToolCount(p.toolsConfig)
    const agentType = isLocal ? 'General' : ((p as IPromptPreset).agentType ?? 'General')
    const isProfessionalAgent = agentType === 'Professional'
    const subAgentIds = isProfessionalAgent ? parseIdList((p as IPromptPreset).subAgentIds) : []
    const skillIds = isProfessionalAgent ? parseIdList((p as IPromptPreset).skillIds) : []
    const dbPreset = p as IPromptPreset
    const boundModel = isProfessionalAgent && dbPreset.modelId ? models.find(m => m.id === dbPreset.modelId) : undefined
    const effortLabel = REASONING_EFFORT_OPTIONS.find(o => o.value === dbPreset.reasoningEffort)?.label
    return (
      <div
        key={p.id}
        className="group relative flex flex-col rounded-2xl border border-gray-200 bg-white p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
      >
        <div className="mb-2 flex items-start justify-between">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${isProfessionalAgent ? 'bg-violet-50 dark:bg-violet-900/20' : 'bg-rose-50 dark:bg-rose-900/20'}`}>
              {isProfessionalAgent ? <Brain size={16} className="text-violet-500" /> : isLocal ? <Terminal size={16} className="text-rose-500" /> : <Bot size={16} className="text-rose-500" />}
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{p.name}</h3>
              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${getCategoryColor(p.category)}`}>{p.category}</span>
                {!isLocal && (
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    isProfessionalAgent
                      ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                      : 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-400'
                  }`}>{isProfessionalAgent ? '专业' : '通用'}</span>
                )}
              </div>
            </div>
          </div>
          {!isLocal && dbPreset.isBuiltIn && (
            <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-400 dark:bg-white/[0.06]">内置</span>
          )}
          {isLocal && (
            <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-600 dark:bg-rose-900/30">本地</span>
          )}
        </div>

        <p className="mb-3 line-clamp-3 flex-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{p.content}</p>

        {isProfessionalAgent && (
          <div className="mb-2 flex flex-wrap gap-1">
            {boundModel && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-600 dark:bg-blue-900/20 dark:text-blue-300">
                <Brain size={9} />{boundModel.displayName}{effortLabel && effortLabel !== '跟随模型' ? ` · ${effortLabel}` : ''}
              </span>
            )}
            {!boundModel && effortLabel && effortLabel !== '跟随模型' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-600 dark:bg-blue-900/20 dark:text-blue-300">
                <Brain size={9} />推理：{effortLabel}
              </span>
            )}
            {subAgentIds.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] text-violet-600 dark:bg-violet-900/20 dark:text-violet-300">
                <Network size={9} />{subAgentIds.length} 个子智能体
              </span>
            )}
            {skillIds.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-600 dark:bg-amber-900/20 dark:text-amber-300">
                <Sparkles size={9} />{skillIds.length} 个技能
              </span>
            )}
          </div>
        )}

        {toolCount > 0 && (
          <div className="mb-1 flex items-center gap-1 text-[10px] text-gray-400">
            <Zap size={11} />
            <span>{toolCount} 个工具</span>
          </div>
        )}

        {!isLocal && !dbPreset.isBuiltIn && (
          <div className="flex flex-wrap items-center gap-1 border-t border-gray-100 pt-2.5 dark:border-gray-800">
            <button onClick={() => openEditForm(dbPreset)} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700"><Edit2 size={11} /> 编辑</button>
            {!isProfessionalAgent && (
              <button
                onClick={() => createProfessionalMutation.mutate(p.id)}
                disabled={createProfessionalMutation.isPending}
                title="从该通用智能体创建专业智能体"
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-violet-500 transition-colors hover:bg-violet-50 hover:text-violet-600 dark:text-violet-400 dark:hover:bg-violet-900/20"
              ><Brain size={11} /> 创建专业版</button>
            )}
            <button onClick={() => { confirm({ message: '确认删除？', onConfirm: () => deleteMutation.mutate(p.id) }) }} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-red-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"><Trash2 size={11} /> 删除</button>
          </div>
        )}
        {!isLocal && dbPreset.isBuiltIn && (
          <div className="flex flex-wrap items-center gap-1 border-t border-gray-100 pt-2.5 dark:border-gray-800">
            <button
              onClick={() => createProfessionalMutation.mutate(p.id)}
              disabled={createProfessionalMutation.isPending}
              title="从该内置智能体创建专业智能体"
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-violet-500 transition-colors hover:bg-violet-50 hover:text-violet-600 dark:text-violet-400 dark:hover:bg-violet-900/20"
            ><Brain size={11} /> 创建专业版</button>
            <Lock size={11} className="text-gray-300 dark:text-gray-600" />
            <span className="text-[10px] text-gray-300 dark:text-gray-600">内置智能体</span>
          </div>
        )}
        {isLocal && (
          <div className="border-t border-gray-100 pt-2.5 dark:border-gray-800">
            <div className="mb-1.5 flex items-center gap-1">
              <button
                onClick={() => createProfessionalFromLocalMutation.mutate(p.id)}
                disabled={createProfessionalFromLocalMutation.isPending}
                title="从该本地智能体创建专业智能体"
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-violet-500 transition-colors hover:bg-violet-50 hover:text-violet-600 dark:text-violet-400 dark:hover:bg-violet-900/20"
              ><Brain size={11} /> 创建专业版</button>
            </div>
            <span className="block truncate text-[10px] text-gray-300 dark:text-gray-600" title={(p as ILocalPromptPreset).filePath}>
              {(p as ILocalPromptPreset).filePath}
            </span>
          </div>
        )}
      </div>
    )
  }

  const filterPill = (active: boolean) =>
    active
      ? 'bg-rose-500 text-white shadow-sm shadow-rose-500/20'
      : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'

  const mainContent = (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto max-w-6xl px-8 py-8">
        {/* 页头 */}
        <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 shadow-sm shadow-rose-500/20">
              <Bot size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">智能体</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">通用智能体分本地与数据库两种来源；专业智能体仅存于数据库，可由任意通用智能体创建</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
            <span><b className="text-sm font-semibold text-gray-700 dark:text-gray-200">{presets.length}</b> 个智能体</span>
            <span className="h-3.5 w-px bg-gray-200 dark:bg-gray-700" />
            <span><b className="text-sm font-semibold text-rose-600 dark:text-rose-400">{categories.length}</b> 个分类</span>
          </div>
        </div>

        {/* 工具栏：分类筛选 + 搜索 + 操作 */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setActiveCategory(null)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all ${filterPill(activeCategory === null)}`}
            >
              全部
              <span className="text-[11px] opacity-70">{presets.length}</span>
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
              placeholder="搜索智能体..."
              className="w-full rounded-full border border-gray-200 bg-white py-2 pl-10 pr-3 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:border-gray-800 dark:bg-gray-900 dark:focus:ring-rose-950/40"
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImport}
          />
          {generalSource === 'local' ? (
            <>
              <button
                onClick={() => setShowDirConfig(true)}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Settings size={14} />
                配置目录
              </button>
              <button
                onClick={() => refetchLocal()}
                title="刷新本地智能体"
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <RefreshCw size={14} />
                刷新
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleExport}
                title="导出"
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Download size={14} />
                导出
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                title="导入"
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Import size={14} />
                导入
              </button>
              <button
                onClick={openCreateForm}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-rose-500 to-pink-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-rose-500/20 transition-all hover:shadow-md active:scale-[0.97]"
              >
                <Plus size={16} />
                新建智能体
              </button>
            </>
          )}
        </div>

        {/* 智能体分栏：上「通用」（本地/数据库可切换），下「专业」（仅数据库） */}
        {generalSource === 'local' && localLoading ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-24 text-gray-400 dark:border-gray-800">
            <Loader2 size={32} className="mb-3 animate-spin text-rose-400" />
            <p className="text-sm">正在扫描本地智能体...</p>
          </div>
        ) : (
          <div className="space-y-8">
            {[
              { title: '通用智能体', desc: '提示词 + 工具配置', items: generalPresets, icon: Bot, accent: 'text-rose-500', bar: 'bg-rose-500' },
              { title: '专业智能体', desc: '子智能体 / 绑定模型 / 推理强度 / 可用技能', items: professionalPresets, icon: Brain, accent: 'text-violet-500', bar: 'bg-violet-500' },
            ].map(section => {
              const SectionIcon = section.icon
              const empty = section.items.length === 0
              const isGeneralSection = section.title === '通用智能体'
              return (
                <section key={section.title}>
                  <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span className={`flex items-center gap-1.5 text-[13px] font-semibold ${section.accent}`}>
                      <SectionIcon size={15} />{section.title}
                    </span>
                    <span className="text-[11px] text-gray-400">{section.items.length} 个</span>
                    <span className="text-[11px] text-gray-400">· {section.desc}</span>
                    {isGeneralSection ? (
                      <div className="ml-auto flex items-center gap-0.5 rounded-full bg-gray-100/80 p-0.5 dark:bg-white/[0.06]">
                        {([
                          { key: 'database' as TabKey, label: '数据库', icon: Bot },
                          { key: 'local' as TabKey, label: '本地', icon: FolderOpen },
                        ]).map((t) => {
                          const Icon = t.icon
                          return (
                            <button
                              key={t.key}
                              onClick={() => { setGeneralSource(t.key); setActiveCategory(null); if (t.key === 'local') refetchLocal() }}
                              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-all ${
                                generalSource === t.key
                                  ? 'bg-white text-gray-800 shadow-sm dark:bg-white/10 dark:text-gray-100'
                                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                              }`}
                            >
                              <Icon size={13} />
                              {t.label}
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <button
                        onClick={openCreateProfessionalForm}
                        className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-violet-500 px-3 py-1 text-[12px] font-medium text-white shadow-sm transition-all hover:bg-violet-600"
                      >
                        <Plus size={13} />新建专业智能体
                      </button>
                    )}
                    <span className={`h-3.5 w-0.5 rounded-full ${section.bar}`} />
                  </div>
                  {empty ? (
                    <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-200 py-10 text-[13px] text-gray-400 dark:border-gray-800 dark:text-gray-600">
                      暂无{section.title}
                      {isGeneralSection
                        ? (isLocalTab ? (
                            <button onClick={() => setShowDirConfig(true)} className="text-rose-500 hover:underline">配置本地目录</button>
                          ) : (
                            <button onClick={openCreateForm} className="text-rose-500 hover:underline">创建{section.title}</button>
                          ))
                        : (
                          <button onClick={openCreateProfessionalForm} className="text-violet-500 hover:underline">创建{section.title}</button>
                        )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {section.items.map(p => renderPresetCard(p, isGeneralSection && generalSource === 'local'))}
                    </div>
                  )}
                </section>
              )
            })}
            {generalPresets.length === 0 && professionalPresets.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-16 text-gray-400 dark:border-gray-800 dark:text-gray-600">
                <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gray-100 dark:bg-white/[0.04]">
                  <Sparkles size={36} className="opacity-50" />
                </div>
                <p className="text-sm font-medium">{isLocalTab ? '未发现本地智能体' : '暂无智能体'}</p>
                {isLocalTab ? (
                  <button onClick={() => setShowDirConfig(true)} className="mt-2 text-xs text-rose-500 hover:underline">
                    配置智能体目录
                  </button>
                ) : (
                  <button onClick={openCreateForm} className="mt-2 text-xs text-rose-500 hover:underline">
                    创建第一个智能体
                  </button>
                )}
              </div>
            )}
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
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-900/30"><Bot size={16} className="text-rose-600 dark:text-rose-400" /></div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{editingId ? '编辑智能体' : '新建智能体'}</h3>
              </div>
              <button onClick={closeForm} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"><X size={18} /></button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">分类</label>
                  <input type="text" placeholder="如：通用、编程、创意" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-rose-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">名称</label>
                  <input type="text" placeholder="智能体名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-rose-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700" />
                </div>
              </div>
              {/* 智能体类型：通用 / 专业 */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">类型</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: 'General' as const, label: '通用智能体', desc: '提示词 + 工具配置', icon: Bot },
                    { key: 'Professional' as const, label: '专业智能体', desc: '可指定子智能体 / 模型 / 推理强度 / 技能', icon: Brain },
                  ]).map(t => {
                    const Icon = t.icon
                    const active = form.agentType === t.key
                    return (
                      <button
                        key={t.key}
                        onClick={() => setForm({ ...form, agentType: t.key })}
                        className={`flex items-start gap-2 rounded-xl border p-3 text-left transition-all ${
                          active
                            ? 'border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-900/20'
                            : 'border-gray-200 hover:border-gray-300 dark:border-gray-600 dark:hover:border-gray-500'
                        }`}
                      >
                        <Icon size={16} className={active ? 'mt-0.5 text-violet-500' : 'mt-0.5 text-gray-400'} />
                        <div className="min-w-0">
                          <div className={`text-xs font-semibold ${active ? 'text-violet-700 dark:text-violet-300' : 'text-gray-700 dark:text-gray-300'}`}>{t.label}</div>
                          <div className="mt-0.5 text-[10px] leading-relaxed text-gray-400">{t.desc}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
              {/* 从通用智能体创建专业智能体：可选本地或数据库的通用智能体 */}
              {isProfessional && !editingId && sourceAgentOptions.length > 0 && (
                <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-800/50 dark:bg-violet-900/10">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-violet-700 dark:text-violet-300">
                    <FolderTree size={13} />
                    从通用智能体创建
                  </div>
                  <p className="mb-2 text-[10px] leading-relaxed text-violet-600/80 dark:text-violet-300/70">
                    复用所选通用智能体（本地或数据库）的提示词与工具配置，生成专业版草稿。
                  </p>
                  <div className="flex gap-2">
                    <Select
                      className="flex-1"
                      value={sourceAgentId}
                      onChange={setSourceAgentId}
                      placeholder="选择通用智能体..."
                      searchable
                      searchPlaceholder="搜索名称或分类..."
                      triggerClassName="flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-violet-200 bg-white px-2.5 text-xs outline-none dark:border-violet-700 dark:bg-gray-800"
                      options={sourceAgentOptions}
                    />
                    <button
                      onClick={handleCreateProfessionalFromSource}
                      disabled={!sourceAgentId || createProfessionalMutation.isPending || createProfessionalFromLocalMutation.isPending}
                      className="h-8 shrink-0 rounded-lg bg-violet-500 px-3 text-xs font-medium text-white transition-colors hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      创建
                    </button>
                  </div>
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">System Prompt</label>
                <textarea placeholder="定义智能体的角色和行为规则..." value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="h-48 w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-rose-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700" />
                <p className="mt-1 text-[10px] text-gray-400">定义智能体的角色、能力和行为准则。对话时将作为系统提示词使用。</p>
              </div>
              {/* 专业智能体能力配置 */}
              {isProfessional && (
                <div className="space-y-4 rounded-xl border border-violet-200 bg-violet-50/40 p-3.5 dark:border-violet-800/50 dark:bg-violet-900/10">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
                    <Settings size={13} />
                    专业智能体能力
                  </div>

                  {/* 绑定的模型 + 推理强度 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">绑定模型</label>
                      <Select
                        value={form.modelId}
                        onChange={(value) => setForm({ ...form, modelId: value })}
                        placeholder="跟随请求 / 话题"
                        triggerClassName={agentFormTriggerCls}
                        options={[
                          { value: '', label: '跟随请求 / 话题' },
                          ...models.filter(m => m.purpose === 'chat').map(m => ({ value: m.id, label: m.displayName })),
                        ]}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">推理强度</label>
                      <Select
                        value={form.reasoningEffort}
                        onChange={(value) => setForm({ ...form, reasoningEffort: value })}
                        placeholder="跟随模型默认"
                        triggerClassName={agentFormTriggerCls}
                        options={REASONING_EFFORT_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
                      />
                    </div>
                  </div>

                  {/* 可管理的子智能体：仅专业智能体 */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">
                      可管理的子智能体
                      <span className="ml-1 font-normal text-gray-400">（仅专业智能体，已选 {form.subAgentIds.length} 个）</span>
                    </label>
                    <MultiSelect
                      values={form.subAgentIds}
                      onChange={(subAgentIds) => setForm({ ...form, subAgentIds })}
                      options={manageableAgents.map(a => ({ value: a.id, label: a.name, hint: a.category }))}
                      placeholder={manageableAgents.length === 0 ? '暂无可管理的专业智能体' : '点击选择专业智能体...'}
                      searchPlaceholder="搜索专业智能体..."
                      emptyText="无匹配的专业智能体"
                    />
                  </div>

                  {/* 可使用的技能：数据库技能 + 本地技能 */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">
                      可使用的技能
                      <span className="ml-1 font-normal text-gray-400">（含数据库与本地技能，已选 {form.skillIds.length} 个，不选则不限制）</span>
                    </label>
                    <MultiSelect
                      values={form.skillIds}
                      onChange={(skillIds) => setForm({ ...form, skillIds })}
                      options={selectableSkills.map(s => ({
                        value: s.id,
                        label: `/${s.name}`,
                        hint: s.description,
                        group: s.isLocal ? '本地技能' : '数据库技能',
                        disabled: !s.isEnabled,
                      }))}
                      placeholder={selectableSkills.length === 0 ? '暂无技能可选' : '点击选择技能，不选则不限制...'}
                      searchPlaceholder="搜索技能名称或描述..."
                      emptyText="无匹配的技能"
                    />
                  </div>
                </div>
              )}
              {/* Tool Configuration：搜索 + 分类分组 + 分组全选 */}
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">可用工具</label>
                  <span className="text-[11px] text-gray-400">{enabledTools.length}/{AVAILABLE_TOOLS.length} 已启用</span>
                  <div className="ml-auto flex items-center gap-2">
                    <button onClick={() => setEnabledTools(AVAILABLE_TOOLS.map(t => t.name))} className="text-[11px] text-gray-400 transition-colors hover:text-rose-500">全选</button>
                    <button onClick={() => setEnabledTools([])} className="text-[11px] text-gray-400 transition-colors hover:text-rose-500">清空</button>
                  </div>
                </div>
                <div className="relative mb-2">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={toolSearch}
                    onChange={(e) => setToolSearch(e.target.value)}
                    placeholder="搜索工具名称..."
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-7 pr-2 text-[13px] outline-none transition-all placeholder:text-gray-400 focus:border-rose-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700"
                  />
                </div>
                <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                  {toolGroups.map(([category, tools]) => (
                    <div key={category}>
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400">{category}</span>
                        <span className="text-[10px] text-gray-300 dark:text-gray-600">
                          {tools.filter(t => enabledTools.includes(t.name)).length}/{tools.length}
                        </span>
                        <button
                          onClick={() => toggleToolGroup(tools)}
                          className="ml-auto text-[10px] text-gray-400 transition-colors hover:text-rose-500"
                        >
                          {tools.every(t => enabledTools.includes(t.name)) ? '全不选' : '全选'}
                        </button>
                      </div>
                      <div className="space-y-1">
                        {tools.map(tool => {
                          const isEnabled = enabledTools.includes(tool.name)
                          const approval = toolApprovals[tool.name] || 'auto'
                          return (
                            <div key={tool.name} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-white dark:hover:bg-gray-700/50">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={isEnabled}
                                  onChange={(e) => {
                                    if (e.target.checked) setEnabledTools(prev => [...prev, tool.name])
                                    else setEnabledTools(prev => prev.filter(n => n !== tool.name))
                                  }}
                                  className="rounded border-gray-300 text-rose-600 focus:ring-rose-500"
                                />
                                <span className="text-xs">{renderToolIcon(tool.name)}</span>
                                <span className="text-xs text-gray-700 dark:text-gray-300">{tool.label}</span>
                              </label>
                              {isEnabled && (
                                <Select
                                  value={approval}
                                  onChange={(value) => setToolApprovals(prev => ({ ...prev, [tool.name]: value }))}
                                  options={[
                                    { value: 'bypass', label: '静默' },
                                    { value: 'auto', label: '自动' },
                                    { value: 'ask', label: '询问' },
                                  ]}
                                />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                  {toolGroups.length === 0 && (
                    <p className="py-4 text-center text-[11px] text-gray-400">无匹配工具</p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-gray-700">
              <button onClick={closeForm} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">取消</button>
              <button onClick={handleSave} disabled={!form.name.trim() || !form.content.trim()} className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-50">{editingId ? '保存' : '创建'}</button>
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
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">配置智能体目录</h3>
                  <p className="text-xs text-gray-500">点击「浏览」选择目录，或手动输入路径</p>
                </div>
              </div>
              <button onClick={() => setShowDirConfig(false)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"><X size={18} /></button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="flex gap-2">
                <button
                  onClick={handleBrowseDir}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600"
                >
                  <FolderSearch size={14} />
                  浏览
                </button>
                <input
                  value={dirInput}
                  onChange={(e) => setDirInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddDir() }}
                  placeholder="或手动输入目录路径，如 /home/user/agents"
                  className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-amber-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700"
                />
                <button onClick={handleAddDir} disabled={!dirInput.trim()} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200">
                  添加
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {directories.length === 0 ? (
                  <div className="py-4 text-center text-xs text-gray-400">
                    <AlertCircle size={16} className="mx-auto mb-1" />
                    暂未配置智能体目录
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
              <div className="rounded-lg bg-rose-50 p-3 dark:bg-rose-900/20">
                <p className="text-[11px] leading-relaxed text-rose-700 dark:text-rose-300">
                  目录结构：每个子文件夹包含一个 <code className="rounded bg-rose-100 px-1 dark:bg-rose-800">agent.json</code> 或 <code className="rounded bg-rose-100 px-1 dark:bg-rose-800">AGENT.md</code> 文件。
                  也支持根目录下的 <code className="rounded bg-rose-100 px-1 dark:bg-rose-800">.json</code> 文件。
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

      {/* 前端目录选择器 */}
      {showFolderPicker && (
        <FolderPickerDialog
          initialPath={dirInput.trim() || directories[directories.length - 1]}
          title="选择智能体目录"
          onClose={() => setShowFolderPicker(false)}
          onPick={handleFolderPicked}
        />
      )}

    </AppLayout>
  )
}
