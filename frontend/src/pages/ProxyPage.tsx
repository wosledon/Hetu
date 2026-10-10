import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Waypoints, Copy, Check, Route as RouteIcon, Zap, Plus, Trash2, Globe, Braces,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import Select from '../components/Select'
import { proxyService, type IProxyConfig } from '../services/proxyService'
import { aiProviderService } from '../services/aiProviderService'

const CATEGORIES = [
  { value: 'simple', labelKey: 'proxy.categories.simple' },
  { value: 'complex', labelKey: 'proxy.categories.complex' },
  { value: 'code', labelKey: 'proxy.categories.code' },
  { value: 'creative', labelKey: 'proxy.categories.creative' },
  { value: 'math', labelKey: 'proxy.categories.math' },
  { value: 'default', labelKey: 'proxy.categories.fallback' },
]

interface ModelOption {
  value: string
  label: string
}

/** 复制按钮（带反馈） */
function CopyBtn({ text, label }: { text: string; label?: string }) {
  const { t } = useTranslation('settings')
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      onClick={copy}
      className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
        copied
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-300'
      }`}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? t('common:copied') : label ?? t('common:copy')}
    </button>
  )
}

/** 单张代理配置卡 */
function ProxyCard({
  mode,
  modelOptions,
}: {
  mode: 'route' | 'shadow'
  modelOptions: ModelOption[]
}) {
  const queryClient = useQueryClient()
  const { t } = useTranslation('settings')
  const [formOverride, setFormOverride] = useState<IProxyConfig | null>(null)
  const [dirty, setDirty] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  const { data: configs = [] } = useQuery({ queryKey: ['proxyConfig'], queryFn: proxyService.getAll })
  const server = configs.find((c) => c.mode === mode)

  const serverForm = useMemo(
    () =>
      server
        ? {
            ...server,
            routeRules: server.routeRules.length > 0
              ? server.routeRules
              : [{ category: 'default', targetModelKey: '', sortOrder: 0 }],
          }
        : null,
    [server],
  )
  const form = formOverride ?? serverForm

  // 影子代理：切换目标模型即时生效，仅模型 ID 需手动保存；路由代理作为整体，任何改动都需保存
  const directSave = mode === 'shadow'

  const saveMut = useMutation({
    mutationFn: proxyService.save,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proxyConfig'] })
      setDirty(false)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    },
  })

  const patch = (p: Partial<IProxyConfig>) => {
    if (!form) return
    const next = { ...form, ...p }
    setFormOverride(next)
    if (directSave && !('modelKey' in p)) {
      // 选择类改动即时保存；若模型 ID 有未保存编辑，则按服务端原值落库
      const pendingKey = next.modelKey !== (serverForm?.modelKey ?? next.modelKey)
      saveMut.mutate(pendingKey ? { ...next, modelKey: serverForm!.modelKey } : next)
      return
    }
    setDirty(true)
  }

  if (!form) {
    return <div className="py-16 text-center text-sm text-gray-400">{t('common:loading')}</div>
  }

  const modelKeyPending = directSave && !!serverForm && form.modelKey !== serverForm.modelKey
  const pending = directSave ? modelKeyPending : dirty
  const canSave = !!form.modelKey.trim() && pending && !saveMut.isPending
  const statusText = saveMut.isPending
    ? t('proxy.saving')
    : pending
      ? form.modelKey.trim()
        ? directSave ? t('proxy.unsavedModelId') : t('proxy.unsaved')
        : t('proxy.modelIdRequired')
      : savedFlash
        ? t('common:saved')
        : t('proxy.upToDate')

  return (
    <div className="space-y-6">
      {/* 对外模型 ID */}
      <section>
        <div className="mb-1.5 flex items-baseline justify-between">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('proxy.modelKey')}</label>
          <span className="text-[11px] text-gray-400 dark:text-gray-500">{t('proxy.modelKeyHint')}</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-2.5 transition-all focus-within:border-blue-400 dark:border-gray-800 dark:bg-white/[0.03]">
          <Braces size={14} className="shrink-0 text-gray-400" />
          <input
            value={form.modelKey}
            onChange={(e) => patch({ modelKey: e.target.value })}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent font-mono text-sm text-gray-800 outline-none dark:text-gray-100"
          />
          <CopyBtn text={form.modelKey} />
        </div>
      </section>

      {/* 影子模式：目标模型 */}
      {mode === 'shadow' && (
        <section>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('proxy.shadowTarget')}</label>
            <span className="text-[11px] text-gray-400 dark:text-gray-500">{t('proxy.shadowTargetHint')}</span>
          </div>
          <Select
            value={form.shadowTargetModelKey ?? ''}
            onChange={(v) => patch({ shadowTargetModelKey: v })}
            options={modelOptions}
            placeholder={t('proxy.chooseModel')}
            searchable
          />
        </section>
      )}

      {/* 路由模式 */}
      {mode === 'route' && (
        <>
          <section>
            <div className="mb-1.5 flex items-baseline justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('proxy.classifier')}</label>
              <span className="text-[11px] text-gray-400 dark:text-gray-500">{t('proxy.classifierHint')}</span>
            </div>
            <Select
              value={form.routeClassifierModelKey ?? ''}
              onChange={(v) => patch({ routeClassifierModelKey: v })}
              options={[{ value: '', label: t('proxy.classifierNone') }, ...modelOptions]}
              placeholder={t('proxy.classifierPlaceholder')}
              searchable
            />
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('proxy.routeRules')}</label>
              <button
                onClick={() => patch({ routeRules: [...form.routeRules, { category: 'simple', targetModelKey: '', sortOrder: form.routeRules.length }] })}
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-blue-500 transition-colors hover:bg-blue-50 dark:hover:bg-blue-500/10"
              >
                <Plus size={13} /> {t('proxy.addRule')}
              </button>
            </div>
            <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
              {form.routeRules.map((rule, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-2.5 bg-white px-3.5 py-3 dark:bg-transparent ${idx > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''}`}
                >
                  <div className="w-28 shrink-0">
                    <Select
                      value={rule.category}
                      onChange={(v) => patch({ routeRules: form.routeRules.map((r, i) => (i === idx ? { ...r, category: v } : r)) })}
                      options={CATEGORIES.map((c) => ({ value: c.value, label: t(c.labelKey) }))}
                    />
                  </div>
                  <span className="shrink-0 text-gray-300 dark:text-gray-600">→</span>
                  <div className="min-w-0 flex-1">
                    <Select
                      value={rule.targetModelKey}
                      onChange={(v) => patch({ routeRules: form.routeRules.map((r, i) => (i === idx ? { ...r, targetModelKey: v } : r)) })}
                      options={modelOptions}
                      placeholder={t('proxy.targetModel')}
                      searchable
                    />
                  </div>
                  <button
                    onClick={() => patch({ routeRules: form.routeRules.filter((_, i) => i !== idx) })}
                    className="shrink-0 rounded-full p-1.5 text-red-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                    title={t('proxy.deleteRule')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">{t('proxy.routeRulesHint')}</p>
          </section>
        </>
      )}

      {/* 保存栏 */}
      <div className="flex items-center justify-between border-t border-gray-100 pt-4 dark:border-gray-800">
        <span className="text-[11px] text-gray-400 dark:text-gray-500">{statusText}</span>
        <button
          onClick={() => saveMut.mutate(form)}
          disabled={!canSave}
          className="rounded-full bg-gradient-to-r from-blue-500 to-cyan-600 px-5 py-2 text-sm font-medium text-white shadow-sm shadow-blue-500/20 transition-all hover:shadow-md active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          {saveMut.isPending ? t('proxy.saving') : t('proxy.saveConfig')}
        </button>
      </div>
    </div>
  )
}

export default function ProxyPage() {
  const { t } = useTranslation('settings')
  const [tab, setTab] = useState<'shadow' | 'route'>('shadow')
  const { data: providers = [] } = useQuery({ queryKey: ['aiProviders'], queryFn: aiProviderService.getAll })

  const modelOptions = useMemo(() => {
    const opts: ModelOption[] = []
    for (const p of providers) {
      if (!p.isEnabled) continue
      for (const m of p.models) {
        if (m.purpose !== 'chat') continue
        opts.push({ value: `${p.id}:${m.modelId}`, label: `${p.name} / ${m.displayName || m.modelId}` })
      }
    }
    return opts
  }, [providers])

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const endpoints = [
    { label: t('proxy.openaiCompat'), value: `${origin}/v1` },
    { label: t('proxy.anthropicCompat'), value: `${origin}/v1/anthropic` },
  ]

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
          <div className="mx-auto max-w-6xl px-8 py-8">
            {/* 页头 */}
            <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 shadow-sm shadow-blue-500/20">
                  <Waypoints size={20} className="text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('proxy.title')}</h1>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('proxy.subtitle')}</p>
                </div>
              </div>
              <div className="ml-auto flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                <span><b className="text-sm font-semibold text-gray-700 dark:text-gray-200">{modelOptions.length}</b> {t('proxy.availableModelsSuffix')}</span>
                <span className="h-3.5 w-px bg-gray-200 dark:bg-gray-700" />
                <span><b className="text-sm font-semibold text-blue-600 dark:text-blue-400">2</b> {t('proxy.protocolsSuffix')}</span>
              </div>
            </div>

            {/* 选项卡 */}
            <div className="mb-6 flex items-center gap-1 rounded-full bg-gray-100/80 p-1 dark:bg-white/[0.06]">
              {([
                { key: 'shadow' as const, labelKey: 'proxy.tabShadow', icon: Zap },
                { key: 'route' as const, labelKey: 'proxy.tabRoute', icon: RouteIcon },
              ]).map((tabItem) => {
                const Icon = tabItem.icon
                return (
                  <button
                    key={tabItem.key}
                    onClick={() => setTab(tabItem.key)}
                    className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-medium transition-all ${
                      tab === tabItem.key
                        ? 'bg-white text-gray-800 shadow-sm dark:bg-white/10 dark:text-gray-100'
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    }`}
                  >
                    <Icon size={14} />
                    {t(tabItem.labelKey)}
                  </button>
                )
              })}
            </div>

            <div className="space-y-4">
              {/* 接入地址 */}
              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-3 flex items-center gap-2">
                  <Globe size={14} className="text-blue-500" />
                  <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{t('proxy.endpointTitle')}</h2>
                  <span className="text-[11px] text-gray-400 dark:text-gray-500">{t('proxy.endpointHint')}</span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {endpoints.map((e) => (
                    <div key={e.label} className="flex items-center gap-2 rounded-xl bg-gray-50/80 px-3.5 py-2.5 dark:bg-white/[0.03]">
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 text-[11px] text-gray-400 dark:text-gray-500">{e.label}</div>
                        <code className="block truncate font-mono text-xs text-gray-700 dark:text-gray-300">{e.value}</code>
                      </div>
                      <CopyBtn text={e.value} />
                    </div>
                  ))}
                </div>
              </div>

              {/* 配置卡 */}
              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                <ProxyCard key={tab} mode={tab} modelOptions={modelOptions} />
              </div>
            </div>
          </div>
        </div>
      }
    />
  )
}
