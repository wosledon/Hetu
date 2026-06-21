import { useEffect, useState } from 'react'
import { Bot, Database, Settings, Trash2, Wrench } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import AppLayout from '../components/AppLayout'
import AiSettings from '../components/AiSettings'
import ExportBackupPanel from '../components/ExportBackupPanel'
import DatabaseSettings from '../components/DatabaseSettings'
import McpServerManager from '../components/McpServerManager'
import { useUIStore } from '../stores/uiStore'
import { settingService } from '../services/settingService'

type Theme = 'light' | 'dark' | 'system'
type SettingsSection = 'app' | 'ai' | 'mcp' | 'database' | 'trash'

const settingsSections = [
  { key: 'app', label: '应用设置', icon: Settings },
  { key: 'ai', label: 'AI 模型', icon: Bot },
  { key: 'mcp', label: 'MCP Server', icon: Wrench },
  { key: 'database', label: '数据与备份', icon: Database },
  { key: 'trash', label: '回收站', icon: Trash2 },
] satisfies { key: SettingsSection; label: string; icon: typeof Settings }[]

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
    setSetting.mutate({ key: 'AppName', value })
  }

  const handleThemeChange = (value: Theme) => {
    setTheme(value)
    setSetting.mutate({ key: 'Theme', value })
  }

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
          <div className="mx-auto max-w-5xl px-8 py-8">
            <h1 className="mb-8 text-2xl font-bold text-gray-800 dark:text-gray-100">设置</h1>
            <div className="flex gap-8">
              <aside className="w-56 shrink-0">
                <nav className="space-y-1">
                  {settingsSections.map((item) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setActiveSection(item.key)}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                          activeSection === item.key
                            ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-200'
                            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                        }`}
                      >
                        <Icon size={16} />
                        {item.label}
                      </button>
                    )
                  })}
                </nav>
              </aside>

              <div className="min-w-0 flex-1 rounded-lg bg-white p-6 dark:bg-gray-900">
                {activeSection === 'app' && <section className="space-y-4">
                  <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">应用设置</h2>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                      显示名称
                    </label>
                    <input
                      type="text"
                      value={appName}
                      onChange={(e) => handleAppNameChange(e.target.value)}
                      className="w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-900"
                    />
                    <p className="mt-1 text-xs text-gray-500">应用顶部栏显示的标题</p>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                      主题模式
                    </label>
                    <div className="flex gap-3">
                      {(['system', 'light', 'dark'] as Theme[]).map((t) => (
                        <button
                          key={t}
                          onClick={() => handleThemeChange(t)}
                          className={`rounded-lg border px-4 py-2 text-sm transition-colors ${
                            theme === t
                              ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200'
                              : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
                          }`}
                        >
                          {t === 'light' && '亮色'}
                          {t === 'dark' && '暗色'}
                          {t === 'system' && '跟随系统'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="border-t border-gray-200 pt-6 dark:border-gray-800">
                    <h3 className="mb-4 text-md font-semibold text-gray-800 dark:text-gray-100">知识图谱</h3>
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            自动提取知识图谱
                          </label>
                          <p className="mt-1 text-xs text-gray-500">
                            开启后，每次保存笔记时将自动调用 AI 提取实体和关系。此功能会消耗 LLM 配额。
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            const currentValue = snapshot?.graphAutoExtract === 'true'
                            setSetting.mutate({ key: 'GraphAutoExtract', value: currentValue ? 'false' : 'true' })
                          }}
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            snapshot?.graphAutoExtract === 'true' ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              snapshot?.graphAutoExtract === 'true' ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">
                          手动提取：在 <button onClick={() => navigate('/graph')} className="text-blue-500 hover:underline">知识图谱页面</button> 点击"从笔记提取"按钮，选择笔记进行提取。
                        </p>
                      </div>
                    </div>
                  </div>
                </section>}

                {activeSection === 'database' && <section className="space-y-6">
                  <DatabaseSettings />
                  <div className="border-t border-gray-200 pt-6 dark:border-gray-800">
                    <ExportBackupPanel />
                  </div>
                </section>}
                {activeSection === 'ai' && <AiSettings />}
                {activeSection === 'trash' && (
                  <section className="space-y-4">
                    <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">回收站</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      回收站中保存了被删除的笔记。您可以在回收站中恢复或彻底删除笔记。
                    </p>
                    <button
                      onClick={() => navigate('/trash')}
                      className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
                    >
                      打开回收站
                    </button>
                  </section>
                )}
                {activeSection === 'mcp' && <McpServerManager />}
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
