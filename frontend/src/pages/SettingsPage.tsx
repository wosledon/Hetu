import { useEffect, useRef, useState } from 'react'
import { Bot, Database, Settings, Trash2, Wrench, Monitor, Sun, Moon, ChevronRight, Tag, Zap, Network, ListTodo, Atom, Cpu, Menu, CalendarClock, Columns2, PanelLeft, Coins, PanelTop, GalleryVerticalEnd, AppWindow, Info, GitBranch, Brain } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import AppLayout from '../components/AppLayout'
import AboutSection from '../components/AboutSection'
import AiSettings from '../components/AiSettings'
import ExportBackupPanel from '../components/ExportBackupPanel'
import DatabaseSettings from '../components/DatabaseSettings'
import McpServerManager from '../components/McpServerManager'
import CompressionSettings from '../components/CompressionSettings'
import DreamSettings from '../components/DreamSettings'
import Select from '../components/Select'
import { useUIStore } from '../stores/uiStore'
import { settingService } from '../services/settingService'
import { aiProviderService } from '../services/aiProviderService'
import { applyLanguage } from '../i18n'
import type { IAppSettingsSnapshot } from '../types'

type Theme = 'light' | 'dark' | 'system'
type SettingsSection = 'app' | 'navigation' | 'models' | 'ai' | 'mcp' | 'database' | 'trash' | 'cost' | 'memory' | 'about'

const settingsSections = [
  { key: 'app', labelKey: 'sections.app', descKey: 'sections.appDesc', icon: Settings },
  { key: 'navigation', labelKey: 'sections.navigation', descKey: 'sections.navigationDesc', icon: Menu },
  { key: 'models', labelKey: 'sections.models', descKey: 'sections.modelsDesc', icon: Cpu },
  { key: 'ai', labelKey: 'sections.ai', descKey: 'sections.aiDesc', icon: Bot },
  { key: 'cost', labelKey: 'sections.cost', descKey: 'sections.costDesc', icon: Coins },
  { key: 'memory', labelKey: 'sections.memory', descKey: 'sections.memoryDesc', icon: Brain },
  { key: 'mcp', labelKey: 'sections.mcp', descKey: 'sections.mcpDesc', icon: Wrench },
  { key: 'database', labelKey: 'sections.database', descKey: 'sections.databaseDesc', icon: Database },
  { key: 'trash', labelKey: 'sections.trash', descKey: 'sections.trashDesc', icon: Trash2 },
  { key: 'about', labelKey: 'sections.about', descKey: 'sections.aboutDesc', icon: Info },
] satisfies { key: SettingsSection; labelKey: string; descKey: string; icon: typeof Settings }[]

const themeOptions = [
  { key: 'system' as Theme, labelKey: 'app.themeSystem', descKey: 'app.themeSystemDesc', icon: Monitor },
  { key: 'light' as Theme, labelKey: 'app.themeLight', descKey: 'app.themeLightDesc', icon: Sun },
  { key: 'dark' as Theme, labelKey: 'app.themeDark', descKey: 'app.themeDarkDesc', icon: Moon },
]

type SecondaryMenuStyle = 'flat' | 'collapsed'

const menuStyleOptions = [
  { key: 'flat' as SecondaryMenuStyle, labelKey: 'app.menuStyleFlat', descKey: 'app.menuStyleFlatDesc', icon: Columns2 },
  { key: 'collapsed' as SecondaryMenuStyle, labelKey: 'app.menuStyleTree', descKey: 'app.menuStyleTreeDesc', icon: PanelLeft },
]

type NavStyle = 'top' | 'vertical'

const navStyleOptions = [
  { key: 'top' as NavStyle, labelKey: 'app.navStyleTop', descKey: 'app.navStyleTopDesc', icon: PanelTop },
  { key: 'vertical' as NavStyle, labelKey: 'app.navStyleVertical', descKey: 'app.navStyleVerticalDesc', icon: GalleryVerticalEnd },
]

/** 语言选项：名称用各自语言书写（中/English），与主题卡片同一套视觉 */
const languageOptions = [
  { key: 'zh' as const, labelKey: 'common:languageZh', descKey: 'language.zhDesc', badge: '中' },
  { key: 'en' as const, labelKey: 'common:languageEn', descKey: 'language.enDesc', badge: 'EN' },
]

const configurableNavItems = [
  { path: '/tags', labelKey: 'navigation.items.tags', icon: Tag },
  { path: '/agents', labelKey: 'navigation.items.agents', icon: Bot },
  { path: '/skills', labelKey: 'navigation.items.skills', icon: Zap },
  { path: '/knowledge-base', labelKey: 'navigation.items.knowledgeBase', icon: Database },
  { path: '/graph', labelKey: 'navigation.items.graph', icon: Network },
  { path: '/tasks/background', labelKey: 'navigation.items.backgroundTasks', icon: ListTodo },
  { path: '/tasks/scheduled', labelKey: 'navigation.items.scheduledTasks', icon: CalendarClock },
  { path: '/memories', labelKey: 'navigation.items.memories', icon: Atom },
  { path: '/models', labelKey: 'navigation.items.models', icon: Cpu },
  { path: '/apps', labelKey: 'navigation.items.apps', icon: AppWindow },
  { path: '/workflows', labelKey: 'navigation.items.workflows', icon: GitBranch },
]

export default function SettingsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { t } = useTranslation('settings')
  const [activeSection, setActiveSection] = useState<SettingsSection>('app')
  const appName = useUIStore((state) => state.appName)
  const assistantName = useUIStore((state) => state.assistantName)
  const assistantPersona = useUIStore((state) => state.assistantPersona)
  const theme = useUIStore((state) => state.theme)
  const secondaryMenuStyle = useUIStore((state) => state.secondaryMenuStyle)
  const navStyle = useUIStore((state) => state.navStyle)
  const pinnedNavItems = useUIStore((state) => state.pinnedNavItems)
  const setAppName = useUIStore((state) => state.setAppName)
  const setAssistantName = useUIStore((state) => state.setAssistantName)
  const setAssistantPersona = useUIStore((state) => state.setAssistantPersona)
  const setTheme = useUIStore((state) => state.setTheme)
  const setSecondaryMenuStyle = useUIStore((state) => state.setSecondaryMenuStyle)
  const setNavStyle = useUIStore((state) => state.setNavStyle)
  const setPinnedNavItems = useUIStore((state) => state.setPinnedNavItems)

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

  // 服务端快照只在首次加载时灌入本地 store；否则保存后的旧快照会把刚改的值覆盖回去
  const hydrated = useRef(false)
  useEffect(() => {
    if (!snapshot || hydrated.current) return
    hydrated.current = true
    setAppName(snapshot.appName)
    setAssistantName(snapshot.assistantName)
    setAssistantPersona(snapshot.assistantPersona)
    setTheme(snapshot.theme as Theme)
    if (snapshot.secondaryMenuStyle === 'flat' || snapshot.secondaryMenuStyle === 'collapsed')
      setSecondaryMenuStyle(snapshot.secondaryMenuStyle)
    if (snapshot.navStyle === 'top' || snapshot.navStyle === 'vertical')
      setNavStyle(snapshot.navStyle)
    try {
      const items = JSON.parse(snapshot.pinnedNavItems)
      if (Array.isArray(items) && items.length > 0) setPinnedNavItems(items)
    } catch { /* keep current value if parse fails */ }
  }, [snapshot, setAppName, setAssistantName, setAssistantPersona, setTheme, setSecondaryMenuStyle, setPinnedNavItems])

  const handleAppNameChange = (value: string) => {
    setAppName(value)
  }

  const handleAppNameSave = () => {
    setSetting.mutate({ key: 'AppName', value: appName })
  }

  const handleAssistantNameChange = (value: string) => {
    setAssistantName(value)
  }

  const handleAssistantNameSave = () => {
    setSetting.mutate({ key: 'AssistantName', value: assistantName })
  }

  const handleAssistantPersonaChange = (value: string) => {
    setAssistantPersona(value)
  }

  const handleAssistantPersonaSave = () => {
    setSetting.mutate({ key: 'AssistantPersona', value: assistantPersona })
  }

  const handleThemeChange = (value: Theme) => {
    setTheme(value)
    setSetting.mutate({ key: 'Theme', value })
  }

  // 语言：界面立即切换，同时落库（前端请求头 Accept-Language 与后台任务都读它）
  const handleLanguageChange = (value: 'zh' | 'en') => {
    void applyLanguage(value)
    setSetting.mutate({ key: 'Language', value })
  }

  const handleMenuStyleChange = (value: SecondaryMenuStyle) => {
    setSecondaryMenuStyle(value)
    setSetting.mutate({ key: 'SecondaryMenuStyle', value })
  }

  const handleNavStyleChange = (value: NavStyle) => {
    setNavStyle(value)
    setSetting.mutate({ key: 'NavStyle', value })
  }

  const handlePinnedNavItemsChange = (items: string[]) => {
    setPinnedNavItems(items)
    setSetting.mutate({ key: 'PinnedNavItems', value: JSON.stringify(items) })
  }

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-6 py-8">
            {/* Page Header */}
            <div className="mb-8">
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-50">{t('page.title')}</h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('page.subtitle')}</p>
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
                            {t(item.labelKey)}
                          </div>
                          <div className="truncate text-[11px] text-gray-400 dark:text-gray-500">
                            {t(item.descKey)}
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
                    assistantName={assistantName}
                    assistantPersona={assistantPersona}
                    theme={theme}
                    secondaryMenuStyle={secondaryMenuStyle}
                    navStyle={navStyle}
                    snapshot={snapshot}
                    onAppNameChange={handleAppNameChange}
                    onAppNameSave={handleAppNameSave}
                    onAssistantNameChange={handleAssistantNameChange}
                    onAssistantNameSave={handleAssistantNameSave}
                    onAssistantPersonaChange={handleAssistantPersonaChange}
                    onAssistantPersonaSave={handleAssistantPersonaSave}
                    onThemeChange={handleThemeChange}
                    onLanguageChange={handleLanguageChange}
                    onMenuStyleChange={handleMenuStyleChange}
                    onNavStyleChange={handleNavStyleChange}
                    onSettingChange={(key, value) => setSetting.mutate({ key, value })}
                    onNavigate={navigate}
                  />}

                  {activeSection === 'navigation' && <NavigationSettingsSection
                    pinnedNavItems={pinnedNavItems}
                    setPinnedNavItems={handlePinnedNavItemsChange}
                    onNavigate={navigate}
                  />}

                  {activeSection === 'models' && <DefaultModelsSection
                    snapshot={snapshot}
                    models={allModels}
                    onSettingChange={(key, value) => setSetting.mutate({ key, value })}
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

                  {activeSection === 'cost' && <CompressionSettings />}
                  {activeSection === 'memory' && <DreamSettings />}

                  {activeSection === 'trash' && <TrashSection onNavigate={navigate} />}

                  {activeSection === 'mcp' && <McpServerManager />}

                  {activeSection === 'about' && <AboutSection appName={appName} />}
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
  assistantName,
  assistantPersona,
  theme,
  secondaryMenuStyle,
  navStyle,
  snapshot,
  onAppNameChange,
  onAppNameSave,
  onAssistantNameChange,
  onAssistantNameSave,
  onAssistantPersonaChange,
  onAssistantPersonaSave,
  onThemeChange,
  onMenuStyleChange,
  onNavStyleChange,
  onLanguageChange,
  onSettingChange,
  onNavigate,
}: {
  appName: string
  assistantName: string
  assistantPersona: string
  theme: Theme
  secondaryMenuStyle: SecondaryMenuStyle
  navStyle: NavStyle
  snapshot: IAppSettingsSnapshot | undefined
  onAppNameChange: (v: string) => void
  onAppNameSave: () => void
  onAssistantNameChange: (v: string) => void
  onAssistantNameSave: () => void
  onAssistantPersonaChange: (v: string) => void
  onAssistantPersonaSave: () => void
  onThemeChange: (v: Theme) => void
  onMenuStyleChange: (v: SecondaryMenuStyle) => void
  onNavStyleChange: (v: NavStyle) => void
  onLanguageChange: (v: 'zh' | 'en') => void
  onSettingChange: (key: string, value: string) => void
  onNavigate: (path: string) => void
}) {
  const { t } = useTranslation('settings')
  const language: 'zh' | 'en' = snapshot?.language === 'en' ? 'en' : 'zh'
  return (
    <div className="space-y-8">
      {/* Display Name */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">{t('app.title')}</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('app.subtitle')}</p>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('app.displayName')}</label>
        <div className="flex max-w-sm items-center gap-2">
          <input
            type="text"
            value={appName}
            onChange={(e) => onAppNameChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAppNameSave()}
            className="flex-1 rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20"
            placeholder={t('app.displayNamePlaceholder')}
          />
          <button
            onClick={onAppNameSave}
            className="shrink-0 rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 active:scale-[0.98]"
          >
            {t('common:save')}
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">{t('app.displayNameHint')}</p>
      </div>

      {/* Assistant Name */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('app.assistantName')}</label>
        <div className="flex max-w-sm items-center gap-2">
          <input
            type="text"
            value={assistantName}
            onChange={(e) => onAssistantNameChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAssistantNameSave()}
            className="flex-1 rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20"
            placeholder={t('app.assistantNamePlaceholder')}
          />
          <button
            onClick={onAssistantNameSave}
            className="shrink-0 rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 active:scale-[0.98]"
          >
            {t('common:save')}
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">{t('app.assistantNameHint')}</p>
      </div>

      {/* Assistant Persona */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('app.persona')}</label>
        <div className="max-w-xl">
          <textarea
            value={assistantPersona}
            onChange={(e) => onAssistantPersonaChange(e.target.value)}
            rows={4}
            className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20"
            placeholder={t('app.personaPlaceholder')}
          />
          <div className="mt-2 flex items-center justify-between">
            <p className="text-xs text-gray-400 dark:text-gray-500">{t('app.personaHint')}</p>
            <button
              onClick={onAssistantPersonaSave}
              className="shrink-0 rounded-xl bg-blue-500 px-4 py-1.5 text-xs font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 active:scale-[0.98]"
            >
              {t('common:save')}
            </button>
          </div>
        </div>
      </div>

      {/* Theme Selector */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('app.theme')}</label>
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
                    {t(opt.labelKey)}
                  </div>
                  <div className="text-[11px] text-gray-400 dark:text-gray-500">{t(opt.descKey)}</div>
                </div>
                {isActive && (
                  <div className="absolute -top-px -right-px rounded-bl-lg rounded-tr-[10px] bg-blue-500 px-2 py-0.5 text-[10px] font-medium text-white">
                    {t('app.current')}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Language Selector */}
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('settings:language.title')}</label>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{t('settings:language.desc')}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {languageOptions.map((opt) => {
            const isActive = language === opt.key
            return (
              <button
                key={opt.key}
                onClick={() => onLanguageChange(opt.key)}
                className={`group relative flex flex-col items-center gap-2 rounded-xl border-2 px-4 py-4 transition-all duration-200 ${
                  isActive
                    ? 'border-blue-500 bg-blue-50/60 shadow-sm shadow-blue-500/10 dark:border-blue-400/60 dark:bg-blue-950/30'
                    : 'border-gray-200/80 hover:border-gray-300 hover:bg-gray-50 dark:border-white/[0.08] dark:hover:border-white/10 dark:hover:bg-white/[0.04]'
                }`}
              >
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg text-[13px] font-semibold transition-colors ${
                  isActive
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-500 group-hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-400'
                }`}>
                  {opt.badge}
                </div>
                <div className="text-center">
                  <div className={`text-sm font-medium ${isActive ? 'text-blue-700 dark:text-blue-200' : 'text-gray-700 dark:text-gray-300'}`}>
                    {t(opt.labelKey)}
                  </div>
                  <div className="text-[11px] text-gray-400 dark:text-gray-500">{t(opt.descKey)}</div>
                </div>
                {isActive && (
                  <div className="absolute -top-px -right-px rounded-bl-lg rounded-tr-[10px] bg-blue-500 px-2 py-0.5 text-[10px] font-medium text-white">
                    {t('app.current')}
                  </div>
                )}
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-gray-400 dark:text-gray-500">{t('common:languageHint')}</p>
      </div>

      {/* Secondary Menu Style Selector */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('app.menuStyle')}</label>
        <div className="grid grid-cols-2 gap-3">
          {menuStyleOptions.map((opt) => {
            const Icon = opt.icon
            const isActive = secondaryMenuStyle === opt.key
            return (
              <button
                key={opt.key}
                onClick={() => onMenuStyleChange(opt.key)}
                className={`group relative flex items-center gap-3 rounded-xl border-2 px-4 py-3.5 transition-all duration-200 ${
                  isActive
                    ? 'border-blue-500 bg-blue-50/60 shadow-sm shadow-blue-500/10 dark:border-blue-400/60 dark:bg-blue-950/30'
                    : 'border-gray-200/80 hover:border-gray-300 hover:bg-gray-50 dark:border-white/[0.08] dark:hover:border-white/10 dark:hover:bg-white/[0.04]'
                }`}
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  isActive
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-500 group-hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-400'
                }`}>
                  <Icon size={18} />
                </div>
                <div className="min-w-0 text-left">
                  <div className={`text-sm font-medium ${isActive ? 'text-blue-700 dark:text-blue-200' : 'text-gray-700 dark:text-gray-300'}`}>
                    {t(opt.labelKey)}
                  </div>
                  <div className="text-[11px] text-gray-400 dark:text-gray-500">{t(opt.descKey)}</div>
                </div>
                {isActive && (
                  <div className="absolute -top-px -right-px rounded-bl-lg rounded-tr-[10px] bg-blue-500 px-2 py-0.5 text-[10px] font-medium text-white">
                    {t('app.current')}
                  </div>
                )}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">{t('app.menuStyleHint')}</p>
      </div>

      {/* Nav Style Selector */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('app.navStyle')}</label>
        <div className="grid grid-cols-2 gap-3">
          {navStyleOptions.map((opt) => {
            const Icon = opt.icon
            const isActive = navStyle === opt.key
            return (
              <button
                key={opt.key}
                onClick={() => onNavStyleChange(opt.key)}
                className={`group relative flex items-center gap-3 rounded-xl border-2 px-4 py-3.5 transition-all duration-200 ${
                  isActive
                    ? 'border-blue-500 bg-blue-50/60 shadow-sm shadow-blue-500/10 dark:border-blue-400/60 dark:bg-blue-950/30'
                    : 'border-gray-200/80 hover:border-gray-300 hover:bg-gray-50 dark:border-white/[0.08] dark:hover:border-white/10 dark:hover:bg-white/[0.04]'
                }`}
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  isActive
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-500 group-hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-400'
                }`}>
                  <Icon size={18} />
                </div>
                <div className="min-w-0 text-left">
                  <div className={`text-sm font-medium ${isActive ? 'text-blue-700 dark:text-blue-200' : 'text-gray-700 dark:text-gray-300'}`}>
                    {t(opt.labelKey)}
                  </div>
                  <div className="text-[11px] text-gray-400 dark:text-gray-500">{t(opt.descKey)}</div>
                </div>
                {isActive && (
                  <div className="absolute -top-px -right-px rounded-bl-lg rounded-tr-[10px] bg-blue-500 px-2 py-0.5 text-[10px] font-medium text-white">
                    {t('app.current')}
                  </div>
                )}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">{t('app.navStyleHint')}</p>
      </div>

      {/* Knowledge Graph */}
      <div className="border-t border-gray-100 pt-8 dark:border-white/[0.06]">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t('app.graphTitle')}</h3>
          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{t('app.graphSubtitle')}</p>
        </div>
        <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/50 p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('app.graphAutoExtract')}</label>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {t('app.graphAutoExtractHint')}
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
          {t('app.graphManualPrefix')}{' '}
          <button onClick={() => onNavigate('/graph')} className="font-medium text-blue-500 hover:text-blue-600 dark:text-blue-400">
            {t('app.graphManualLink')}
          </button>
          {' '}{t('app.graphManualSuffix')}
        </p>
      </div>

      {/* Auto Embedding */}
      <div className="border-t border-gray-100 pt-8 dark:border-white/[0.06]">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t('app.embeddingTitle')}</h3>
          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{t('app.embeddingSubtitle')}</p>
        </div>
        <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/50 p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('app.autoEmbedding')}</label>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {t('app.autoEmbeddingHint')}
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
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t('app.contextTitle')}</h3>
          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{t('app.contextSubtitle')}</p>
        </div>
        <div className="max-w-xs">
          <input
            type="number"
            value={snapshot?.contextWindowSize?.toString() ?? ''}
            onChange={(e) => onSettingChange('ContextWindowSize', e.target.value || '')}
            placeholder={t('app.contextPlaceholder')}
            min={1}
            max={100}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-800"
          />
          <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
            {t('app.contextHint')}
          </p>
        </div>
      </div>

      {/* Close To Tray */}
      <div className="border-t border-gray-100 pt-8 dark:border-white/[0.06]">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t('app.trayTitle')}</h3>
          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{t('app.traySubtitle')}</p>
        </div>
        <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/50 p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('app.closeToTray')}</label>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {t('app.closeToTrayHint')}
            </p>
          </div>
          <button
            onClick={() => onSettingChange('CloseToTray', snapshot?.closeToTray === 'false' ? 'true' : 'false')}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
              snapshot?.closeToTray !== 'false' ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
            }`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition duration-200 ${
              snapshot?.closeToTray !== 'false' ? 'translate-x-5' : 'translate-x-0.5'
            }`} style={{ marginTop: '2px' }} />
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Navigation Settings Section ─── */

function NavigationSettingsSection({
  pinnedNavItems,
  setPinnedNavItems,
  onNavigate,
}: {
  pinnedNavItems: string[]
  setPinnedNavItems: (items: string[]) => void
  onNavigate: (path: string) => void
}) {
  const { t } = useTranslation('settings')
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">{t('navigation.title')}</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t('navigation.subtitle')}
        </p>
      </div>

      {/* Quick Jump */}
      <div className="grid grid-cols-4 gap-2">
        {configurableNavItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.path}
              onClick={() => onNavigate(item.path)}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2 text-sm text-gray-600 transition-all hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-gray-400 dark:hover:border-blue-500/50 dark:hover:bg-blue-950/20 dark:hover:text-blue-300"
            >
              <Icon size={14} />
              {t(item.labelKey)}
            </button>
          )
        })}
      </div>

      {/* Pin Toggles */}
      <div className="space-y-2">
        {configurableNavItems.map((item) => {
          const Icon = item.icon
          const isPinned = pinnedNavItems.includes(item.path)
          return (
            <div
              key={item.path}
              className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50/50 px-4 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.02]"
            >
              <div className="flex items-center gap-2">
                <Icon size={14} className="text-gray-400" />
                <span className="text-sm text-gray-700 dark:text-gray-300">{t(item.labelKey)}</span>
              </div>
              <button
                onClick={() => {
                  setPinnedNavItems(
                    isPinned
                      ? pinnedNavItems.filter((p) => p !== item.path)
                      : [...pinnedNavItems, item.path]
                  )
                }}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                  isPinned ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition duration-200 ${
                    isPinned ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                  style={{ marginTop: '2px' }}
                />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Default Models Section ─── */

function DefaultModelsSection({
  snapshot,
  models,
  onSettingChange,
}: {
  snapshot: IAppSettingsSnapshot | undefined
  models: { id: string; modelId: string; displayName: string; purpose: string; isVisible: boolean }[]
  onSettingChange: (key: string, value: string) => void
}) {
  const { t } = useTranslation('settings')
  const chatModels = models.filter((m) => m.purpose === 'chat' && m.isVisible)
  const embeddingModels = models.filter((m) => m.purpose === 'embedding' && m.isVisible)

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">{t('models.title')}</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('models.subtitle')}</p>
      </div>

      <div className="space-y-4">
        <DefaultModelSelect
          label={t('models.chat')}
          description={t('models.chatDesc')}
          value={snapshot?.defaultChatModelId || ''}
          models={chatModels}
          onChange={(v) => onSettingChange('DefaultChatModelId', v)}
        />
        <DefaultModelSelect
          label={t('models.chunk')}
          description={t('models.chunkDesc')}
          value={snapshot?.defaultChunkModelId || ''}
          models={chatModels}
          onChange={(v) => onSettingChange('DefaultChunkModelId', v)}
          placeholder={t('models.chunkPlaceholder')}
        />
        <DefaultModelSelect
          label={t('models.fast')}
          description={t('models.fastDesc')}
          value={snapshot?.defaultFastModelId || ''}
          models={chatModels}
          onChange={(v) => onSettingChange('DefaultFastModelId', v)}
        />
        <DefaultModelSelect
          label={t('models.embedding')}
          description={t('models.embeddingDesc')}
          value={snapshot?.defaultEmbeddingModelId || ''}
          models={embeddingModels}
          onChange={(v) => onSettingChange('DefaultEmbeddingModelId', v)}
        />
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
  placeholder,
}: {
  label: string
  description: string
  value: string
  models: { id: string; modelId: string; displayName: string }[]
  onChange: (value: string) => void
  placeholder?: string
}) {
  const { t } = useTranslation('settings')
  const placeholderText = placeholder ?? t('models.notSet')
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/50 p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
      <div className="flex-1">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
        <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{description}</p>
      </div>
      <Select
        value={value}
        onChange={onChange}
        options={[
          { value: '', label: placeholderText },
          ...models.map((m) => ({ value: m.id, label: `${m.displayName} (${m.modelId})` })),
        ]}
        placeholder={placeholderText}
        className="w-56"
      />
    </div>
  )
}

/* ─── Trash Section ─── */

function TrashSection({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t } = useTranslation('settings')
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">{t('trash.title')}</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('trash.subtitle')}</p>
      </div>
      <button
        onClick={() => onNavigate('/trash')}
        className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-5 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 hover:shadow-md hover:shadow-blue-500/30 active:scale-[0.98]"
      >
        <Trash2 size={15} />
        {t('trash.open')}
      </button>
    </section>
  )
}
