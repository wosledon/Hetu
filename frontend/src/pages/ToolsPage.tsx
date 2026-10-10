import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import AppLayout from '../components/AppLayout'
import { toolService, type IToolCatalogItem } from '../services/toolService'
import { renderToolGroup } from '../utils/toolRendering'
import { ChevronDown, ChevronRight, Search, Terminal, Wrench, ShieldCheck, ShieldAlert, Eye, Zap } from 'lucide-react'

/** 人格（会话场景）标签：内置工具目录里标注每个工具可被哪些人格使用 */
const PROFILE_META: Record<string, { labelKey: string; cls: string }> = {
  knowledge: { labelKey: 'toolsPage.profile.knowledge', cls: 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300' },
  work: { labelKey: 'toolsPage.profile.work', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300' },
  desktop: { labelKey: 'toolsPage.profile.desktop', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
  cowork: { labelKey: 'toolsPage.profile.cowork', cls: 'bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300' },
}

const RISK_META: Record<string, { labelKey: string; cls: string; Icon: typeof Eye }> = {
  read: { labelKey: 'toolsPage.risk.read', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300', Icon: Eye },
  write: { labelKey: 'toolsPage.risk.write', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300', Icon: ShieldCheck },
  execute: { labelKey: 'toolsPage.risk.execute', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300', Icon: ShieldAlert },
}

const APPROVAL_META: Record<string, { labelKey: string; cls: string }> = {
  auto: { labelKey: 'toolsPage.approval.auto', cls: 'text-emerald-600 dark:text-emerald-400' },
  ask: { labelKey: 'toolsPage.approval.ask', cls: 'text-amber-600 dark:text-amber-400' },
  bypass: { labelKey: 'toolsPage.approval.bypass', cls: 'text-rose-600 dark:text-rose-400' },
}

function ToolCard({ tool }: { tool: IToolCatalogItem }) {
  const { t } = useTranslation('agents')
  const [open, setOpen] = useState(false)
  const risk = RISK_META[tool.risk] ?? RISK_META.write
  const approval = APPROVAL_META[tool.defaultApproval] ?? APPROVAL_META.ask
  const schema = useMemo(() => {
    if (!tool.parametersSchema) return ''
    try {
      return JSON.stringify(JSON.parse(tool.parametersSchema), null, 2)
    } catch {
      return tool.parametersSchema
    }
  }, [tool.parametersSchema])

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          <Wrench size={14} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <code className="text-[13px] font-semibold text-gray-800 dark:text-gray-100">{tool.name}</code>
            <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${risk.cls}`}>
              <risk.Icon size={10} />
              {t(risk.labelKey)}
            </span>
            <span className={`text-[10px] font-medium ${approval.cls}`}>{t(approval.labelKey)}</span>
          </div>

          <p className="mt-1.5 text-xs leading-relaxed text-gray-600 dark:text-gray-300">{tool.description}</p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">{renderToolGroup(tool.group)}</span>
            {tool.profiles.map((p) => {
              const meta = PROFILE_META[p]
              const cls = meta?.cls ?? 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
              return <span key={p} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>{meta ? t(meta.labelKey) : p}</span>
            })}
            {tool.profiles.length === 0 && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-400 dark:bg-gray-800">{t('toolsPage.noProfiles')}</span>
            )}
          </div>

          {(tool.usageGuideline || schema) && (
            <>
              <button
                onClick={() => setOpen((v) => !v)}
                className="mt-2 flex items-center gap-1 text-[11px] text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {t('toolsPage.parametersAndGuidelines')}
              </button>

              {open && (
                <div className="mt-2 flex flex-col gap-2">
                  {tool.usageGuideline && (
                    <div className="rounded-lg bg-gray-50 px-3 py-2 text-[11px] leading-relaxed text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
                      {tool.usageGuideline}
                    </div>
                  )}
                  {schema && (
                    <pre className="max-h-64 overflow-auto rounded-lg bg-gray-50 px-3 py-2 text-[10px] leading-relaxed text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
                      {schema}
                    </pre>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ToolsPage() {
  const { t } = useTranslation('agents')
  const [keyword, setKeyword] = useState('')
  const [group, setGroup] = useState('')
  const [profile, setProfile] = useState('')

  const { data: tools = [], isLoading } = useQuery({
    queryKey: ['toolCatalog'],
    queryFn: toolService.getAll,
    staleTime: 5 * 60 * 1000,
  })

  const groups = useMemo(
    () => Array.from(new Set(tools.map((t) => t.group))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    [tools],
  )

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return tools.filter((t) => {
      if (group && t.group !== group) return false
      if (profile && !t.profiles.includes(profile)) return false
      if (!q) return true
      return t.name.toLowerCase().includes(q)
        || t.description.toLowerCase().includes(q)
        || (t.usageGuideline ?? '').toLowerCase().includes(q)
    })
  }, [tools, keyword, group, profile])

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
          <div className="mx-auto max-w-5xl px-8 py-8">
        <div className="mb-5 flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 shadow-sm shadow-slate-500/20">
            <Terminal size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('toolsPage.title')}</h1>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('toolsPage.subtitle', { n: tools.length })}
            </p>
          </div>
        </div>

        <div className="mb-4 flex flex-col gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={t('toolsPage.searchPlaceholder')}
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-xs outline-none transition-colors placeholder:text-gray-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => { setGroup(''); setProfile('') }}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${!group && !profile ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}`}
            >
              {t('common:all')} {tools.length}
            </button>
            {(['knowledge', 'work', 'desktop', 'cowork'] as const).filter((p) => tools.some((t) => t.profiles.includes(p))).map((p) => (
              <button
                key={p}
                onClick={() => { setProfile(profile === p ? '' : p); setGroup('') }}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${profile === p ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}`}
              >
                {PROFILE_META[p] ? t(PROFILE_META[p].labelKey) : p}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {groups.map((g) => (
              <button
                key={g}
                onClick={() => { setGroup(group === g ? '' : g); setProfile('') }}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${group === g ? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900' : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}`}
              >
                {renderToolGroup(g)} {tools.filter((t) => t.group === g).length}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-xs text-gray-400">{t('common:loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-gray-400">
            <Zap size={20} />
            <span className="text-xs">{t('toolsPage.noToolsMatch')}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {filtered.map((t) => <ToolCard key={t.name} tool={t} />)}
          </div>
        )}
          </div>
        </div>
      }
    />
  )
}
