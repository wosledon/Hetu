import { useEffect, useState } from 'react'
import { Bot, Database, Settings, Trash2, Wrench, Monitor, Sun, Moon, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import AppLayout from '../components/AppLayout'
import AiSettings from '../components/AiSettings'
import ExportBackupPanel from '../components/ExportBackupPanel'
import DatabaseSettings from '../components/DatabaseSettings'
import McpServerManager from '../components/McpServerManager'
import Select from '../components/Select'
import { useUIStore } from '../stores/uiStore'
import { settingService } from '../services/settingService'
import { aiProviderService } from '../services/aiProviderService'

type Theme = 'light' | 'dark' | 'system'
type SettingsSection = 'app' | 'ai' | 'mcp' | 'database' | 'trash'

const settingsSections = [
  { key: 'app', label: '应用设置', description: '名称、主题、图谱', icon: Settings },
  { key: 'ai', label: 'AI 模型', description: '提供商与模型管理', icon: Bot },
  { key: 'mcp', label: 'MCP Server', description: '工具服务配置', icon: Wrench },
  { key: 'database', label: '数据与备份', description: '数据库与导出恢复', icon: Database },
  { key: 'trash', label: '回收站', description: '已删除的笔记', icon: Trash2 },
] satisfies { key: SettingsSection; label: string; description: string; icon: typeof Settings }[]

const themeOptions = [
  { key: 'system' as Theme, label: '跟随系统', desc: '自动匹配系统设置', icon: Monitor },
  { key: 'light' as Theme, label: '亮色', desc: '明亮清晰', icon: Sun },
  { key: 'dark' as Theme, label: '暗色', desc: '护眼深色', icon: Moon },
]

export default function SettingsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeSection, setActiveSection] = useState<SettingsSection>('app')
  const appName = useUIStore((state) => state.appName)
  const theme = useUIStore((state) => state.theme)
  const setAppName = useUIStore((state) => state.setAppName)
  const setTheme = useUIStore((state) => state.setTheme)

  const { data: snapshot } = useQuery({
    queryKey: ['settings'],
    queryFn: settingService.getSnapshot,
  })

  const { data: providers = [] } = useQuery({
    queryKey: ['aiProviders'],
    queryFn: aiProviderService.getAll,
  })

  const allModels = providers.flatMap((p) => p.models)

  const setSetting = useMutation({
    mutationFn: settingService.set,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })

  useEffect(() => {
    if (snapshot && !setSetting.isPending) {
      setAppName(snapshot.appName)
      setTheme(snapshot.theme as Theme)
    }
  }, [snapshot, setAppName, setSetting.isPending, setTheme])

  const handleAppNameChange = (value: string) => {
    setAppName(value)
  }

  const handleAppNameSave = () => {
    setSetting.mutate({ key: 'AppName', value: appName })
  }

  const handleThemeChange = (value: Theme) => {
    setTheme(value)
    setSetting.mutate({ key: 'Theme', value })
  }

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-6 py-8">
            {/* Page Header */}
            <div className="mb-8">
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-50">设置</h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">管理应用偏好、AI 模型和数据存储</p>
            </div>

            <div className="flex gap-8">
              {/* Sidebar Navigation */}
              <aside className="w-60 shrink-0">
                <nav className="sticky top-8 space-y-1">
                  {settingsSections.map((item) => {
                    const Icon = item.icon
                    const isActive = activeSection === item.key
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setActiveSection(item.key)}
                        className={`group flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left transition-all duration-200 ${
                          isActive
                            ? 'bg-blue-50/80 shadow-sm shadow-blue-500/5 dark:bg-blue-950/30 dark:shadow-blue-500/10'
                            : 'hover:bg-gray-100/60 dark:hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                          isActive
                            ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/25'
                            : 'bg-gray-100 text-gray-500 group-hover:bg-gray-200 group-hover:text-gray-700 dark:bg-white/[0.06] dark:text-gray-400 dark:group-hover:bg-white/10 dark:group-hover:text-gray-300'
                        }`}>
                          <Icon size={15} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className={`text-sm font-medium ${
                            isActive ? 'text-blue-700 dark:text-blue-200' : 'text-gray-700 dark:text-gray-300'
                          }`}>
                            {item.label}
                          </div>
                          <div className="truncate text-[11px] text-gray-400 dark:text-gray-500">
                            {item.description}
                          </div>
                        </div>
                        {isActive && <ChevronRight size={14} className="text-blue-400 dark:text-blue-300" />}
                      </button>
                    )
                  })}
                </nav>
              </aside>

              {/* Content Area */}
              <div className="min-w-0 flex-1 animate-fade-in">
                <div className="rounded-2xl border border-gray-200/80 bg-white p-8 shadow-sm shadow-gray-100/50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:shadow-none">
                  {activeSection === 'app' && <AppSettingsSection
                    appName={appName}
                    theme={theme}
                    snapshot={snapshot}
                    models={allModels}
                    onAppNameChange={handleAppNameChange}
                    onAppNameSave={handleAppNameSave}
                    onThemeChange={handleThemeChange}
                    onSettingChange={(key, value) => setSetting.mutate({ key, value })}
                    onNavigate={navigate}
                  />}

                  {activeSection === 'database' && (
                    <section className="space-y-8">
                      <DatabaseSettings />
                      <div className="border-t border-gray-100 pt-8 dark:border-white/[0.06]">
                        <ExportBackupPanel />
                      </div>
                    </section>
                  )}

                  {activeSection === 'ai' && <AiSettings />}

                  {activeSection === 'trash' && <TrashSection onNavigate={navigate} />}

                  {activeSection === 'mcp' && <McpServerManager />}
                </div>
              </div>
            </div>
          </div>
        </div>
      }
    >
      {null}
    </AppLayout>
  )
}

/* ─── App Settings Section ─── */

function AppSettingsSection({
  appName,
  theme,
  snapshot,
  models,
  onAppNameChange,
  onAppNameSave,
  onThemeChange,
  onSettingChange,
  onNavigate,
}: {
  appName: string
  theme: Theme
  snapshot: Record<string, string> | undefined
  models: { id: string; modelId: string; displayName: string; purpose: string; isVisible: boolean }[]
  onAppNameChange: (v: string) => void
  onAppNameSave: () => void
  onThemeChange: (v: Theme) => void
  onSettingChange: (key: string, value: string) => void
  onNavigate: (path: string) => void
}) {
  const chatModels = models.filter((m) => m.purpose === 'chat' && m.isVisible)
  const embeddingModels = models.filter((m) => m.purpose === 'embedding' && m.isVisible);
  return (
    <div className="space-y-8">
      {/* Display Name */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">应用设置</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">自定义应用的外观和显示</p>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">显示名称</label>
        <div className="flex max-w-sm items-center gap-2">
          <input
            type="text"
            value={appName}
            onChange={(e) => onAppNameChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAppNameSave()}
            className="flex-1 rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20"
            placeholder="输入应用名称"
          />
          <button
            onClick={onAppNameSave}
            className="shrink-0 rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 active:scale-[0.98]"
          >
            保存
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">显示在顶部导航栏的标题文字</p>
      </div>

      {/* Theme Selector */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">外观主题</label>
        <div className="grid grid-cols-3 gap-3">
          {themeOptions.map((opt) => {
            const Icon = opt.icon
            const isActive = theme === opt.key
            return (
              <button
                key={opt.key}
                onClick={() => onThemeChange(opt.key)}
                className={`group relative flex flex-col items-center gap-2 rounded-xl border-2 px-4 py-4 transition-all duration-200 ${
                  isActive
                    ? 'border-blue-500 bg-blue-50/60 shadow-sm shadow-blue-500/10 dark:border-blue-400/60 dark:bg-blue-950/30'
                    : 'border-gray-200/80 hover:border-gray-300 hover:bg-gray-50 dark:border-white/[0.08] dark:hover:border-white/10 dark:hover:bg-white/[0.04]'
                }`}
              >
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                  isActive
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-500 group-hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-400'
                }`}>
                  <Icon size={18} />
                </div>
                <div className="text-center">
                  <div className={`text-sm font-medium ${isActive ? 'text-blue-700 dark:text-blue-200' : 'text-gray-700 dark:text-gray-300'}`}>
                    {opt.label}
                  </div>
                  <div className="text-[11px] text-gray-400 dark:text-gray-500">{opt.desc}</div>
                </div>
                {isActive && (
                  <div className="absolute -top-px -right-px rounded-bl-lg rounded-tr-[10px] bg-blue-500 px-2 py-0.5 text-[10px] font-medium text-white">
                    当前
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Knowledge Graph */}
      <div className="border-t border-gray-100 pt-8 dark:border-white/[0.06]">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">知识图谱</h3>
          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">自动从笔记中提取实体与关系</p>
        </div>
        <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/50 p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">自动提取知识图谱</label>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              保存笔记时自动调用 AI 提取实体和关系，会消耗 LLM 配额
            </p>
          </div>
          <button
            onClick={() => onSettingChange('GraphAutoExtract', snapshot?.graphAutoExtract === 'true' ? 'false' : 'true')}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
              snapshot?.graphAutoExtract === 'true' ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
            }`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition duration-200 ${
              snapshot?.graphAutoExtract === 'true' ? 'translate-x-5' : 'translate-x-0.5'
            }`} style={{ marginTop: '2px' }} />
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
          也可手动提取：前往{' '}
          <button onClick={() => onNavigate('/graph')} className="font-medium text-blue-500 hover:text-blue-600 dark:text-blue-400">
            知识图谱页面
          </button>
          {' '}点击「从笔记提取」
        </p>
      </div>

      {/* Auto Embedding */}
      <div className="border-t border-gray-100 pt-8 dark:border-white/[0.06]">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">向量索引</h3>
          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">笔记保存时自动生成向量嵌入，用于语义搜索</p>
        </div>
        <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/50 p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">自动生成 Embedding</label>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              保存笔记时自动调用 Embedding 模型生成向量索引，会消耗 Embedding 配额
            </p>
          </div>
          <button
            onClick={() => onSettingChange('AutoEmbedding', snapshot?.autoEmbedding === 'true' ? 'false' : 'true')}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
              snapshot?.autoEmbedding === 'true' ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
            }`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition duration-200 ${
              snapshot?.autoEmbedding === 'true' ? 'translate-x-5' : 'translate-x-0.5'
            }`} style={{ marginTop: '2px' }} />
          </button>
        </div>
      </div>

      {/* Context Window Size */}
      <div className="border-t border-gray-100 pt-8 dark:border-white/[0.06]">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">上下文窗口</h3>
          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">控制发送给 AI 的历史消息条数，留空表示不限制</p>
        </div>
        <div className="max-w-xs">
          <input
            type="number"
            value={snapshot?.contextWindowSize?.toString() ?? ''}
            onChange={(e) => onSettingChange('ContextWindowSize', e.target.value || '')}
            placeholder="不限制"
            min={1}
            max={100}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800"
          />
          <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
            建议 10-30，值越大 token 消耗越高，但对话连贯性越好
          </p>
        </div>
      </div>

      {/* Default Models */}
      <div className="border-t border-gray-100 pt-8 dark:border-white/[0.06]">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">默认模型</h3>
          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">为不同场景指定默认使用的 AI 模型</p>
        </div>
        <div className="space-y-4">
          <DefaultModelSelect
            label="默认对话模型"
            description="新对话默认使用的模型"
            value={snapshot?.defaultChatModelId || ''}
            models={chatModels}
            onChange={(v) => onSettingChange('DefaultChatModelId', v)}
          />
          <DefaultModelSelect
            label="默认文档 Chunk 模型"
            description="知识库分块时使用的 LLM（可选，不配置则使用结构化分块）"
            value={snapshot?.defaultChunkModelId || ''}
            models={chatModels}
            onChange={(v) => onSettingChange('DefaultChunkModelId', v)}
            placeholder="不使用 LLM 分块"
          />
          <DefaultModelSelect
            label="快速模型"
            description="用于轻量级任务（如标签建议、摘要等）"
            value={snapshot?.defaultFastModelId || ''}
            models={chatModels}
            onChange={(v) => onSettingChange('DefaultFastModelId', v)}
          />
          <DefaultModelSelect
            label="默认 Embedding 模型"
            description="知识库向量化使用的模型"
            value={snapshot?.defaultEmbeddingModelId || ''}
            models={embeddingModels}
            onChange={(v) => onSettingChange('DefaultEmbeddingModelId', v)}
          />
        </div>
      </div>
    </div>
  )
}

function DefaultModelSelect({
  label,
  description,
  value,
  models,
  onChange,
  placeholder = '未设置',
}: {
  label: string
  description: string
  value: string
  models: { id: string; modelId: string; displayName: string }[]
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/50 p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
      <div className="flex-1">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
        <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{description}</p>
      </div>
      <Select
        value={value}
        onChange={onChange}
        options={models.map((m) => ({ value: m.id, label: `${m.displayName} (${m.modelId})` }))}
        placeholder={placeholder}
        className="w-56"
      />
    </div>
  )
}

/* ─── Trash Section ─── */

function TrashSection({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">回收站</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">查看和管理已删除的笔记，可恢复或彻底删除</p>
      </div>
      <button
        onClick={() => onNavigate('/trash')}
        className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-5 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 hover:shadow-md hover:shadow-blue-500/30 active:scale-[0.98]"
      >
        <Trash2 size={15} />
        打开回收站
      </button>
    </section>
  )
}
