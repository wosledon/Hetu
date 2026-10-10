import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle, AppWindow, ArrowLeft, ExternalLink, Globe, Loader2, Pencil, Plus, RefreshCw, Trash2, X,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { appsService, normalizeUrl, getWebAppPresets } from '../services/appsService'
import type { IWebApp } from '../services/appsService'
import { isTauri, openAppWebview } from '../utils/tauri'

/** 从 URL 取展示用主机名 */
function hostOf(url: string): string {
  try {
    return new URL(normalizeUrl(url)).host
  } catch {
    return url
  }
}

/** 站点图标：后端抓取的真实 favicon，失败回退字母头像 */
function AppIcon({ name, url, className }: { name: string; url: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span className={`flex items-center justify-center rounded-lg text-base font-bold ${avatarClass(name)} ${className ?? ''}`}>
        {name.slice(0, 1)}
      </span>
    )
  }
  return (
    <img
      src={appsService.faviconUrl(normalizeUrl(url))}
      alt=""
      className={`rounded-lg bg-white object-contain ${className ?? ''}`}
      onError={() => setFailed(true)}
    />
  )
}

/** 卡片字母头像：取名称首字，按字符哈希分配色系 */
function avatarClass(name: string): string {
  const palettes = [
    'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300',
    'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300',
    'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300',
    'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300',
    'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300',
    'bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-300',
  ]
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 997
  return palettes[hash % palettes.length]
}

export default function AppsPage() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [openedApp, setOpenedApp] = useState<IWebApp | null>(null)
  const [editingApp, setEditingApp] = useState<IWebApp | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', url: '' })
  const [formError, setFormError] = useState('')
  const presets = getWebAppPresets()

  const { data: apps = [], isLoading } = useQuery({
    queryKey: ['webApps'],
    queryFn: appsService.getAll,
  })

  const saveMutation = useMutation({
    mutationFn: appsService.saveAll,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webApps'] })
      setShowForm(false)
      setEditingApp(null)
      setForm({ name: '', url: '' })
      setFormError('')
    },
  })

  const openCreate = () => {
    setEditingApp(null)
    setForm({ name: '', url: '' })
    setFormError('')
    setShowForm(true)
  }

  const openEdit = (app: IWebApp) => {
    setEditingApp(app)
    setForm({ name: app.name, url: app.url })
    setFormError('')
    setShowForm(true)
  }

  const handleSave = () => {
    const name = form.name.trim()
    const url = normalizeUrl(form.url)
    if (!name) { setFormError(t('apps.errorName')); return }
    if (!url) { setFormError(t('apps.errorUrl')); return }

    if (editingApp) {
      saveMutation.mutate(apps.map((a) => (a.id === editingApp.id ? { ...a, name, url } : a)))
      return
    }
    const app: IWebApp = { id: crypto.randomUUID(), name, url, createdAt: new Date().toISOString() }
    saveMutation.mutate([...apps, app])
  }

  const handleDelete = (app: IWebApp) => {
    saveMutation.mutate(apps.filter((a) => a.id !== app.id))
    if (openedApp?.id === app.id) setOpenedApp(null)
  }

  const applyPreset = (preset: { name: string; url: string }) => {
    if (apps.some((a) => normalizeUrl(a.url) === preset.url)) return
    saveMutation.mutate([...apps, { id: crypto.randomUUID(), ...preset, createdAt: new Date().toISOString() }])
  }

  /**
   * 打开应用：
   * - 先探测站点是否允许内嵌（大模型网页多为 CSP frame-ancestors 'none'，iframe 必被拒绝）
   * - 可内嵌 → 页内 iframe 视图；不可内嵌 → 桌面壳用应用内独立窗口，浏览器用系统新窗口
   */
  const handleOpen = async (app: IWebApp) => {
    const url = normalizeUrl(app.url)
    try {
      const probe = await appsService.checkEmbed(url)
      if (probe?.embeddable) {
        setOpenedApp(app)
        return
      }
    } catch { /* 探测失败按不可内嵌处理 */ }
    if (isTauri()) {
      await openAppWebview(url, app.name)
      return
    }
    window.open(url, '_blank', 'noopener')
  }

  /* ───────── 打开应用：全屏内嵌浏览器 ───────── */

  if (openedApp) {
    return (
      <EmbeddedAppView
        app={openedApp}
        onClose={() => setOpenedApp(null)}
      />
    )
  }

  return (
    <AppLayout showSidebar={false} mainContent={
      <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
        <div className="mx-auto max-w-6xl px-8 py-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-100 text-cyan-600 dark:bg-cyan-900/40 dark:text-cyan-300">
            <Globe size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('apps.title')}</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('apps.subtitle')}</p>
          </div>
          <button
            onClick={openCreate}
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full bg-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-cyan-700 active:scale-[0.97]"
          >
            <Plus size={16} />
            {t('apps.add')}
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-24"><Loader2 size={24} className="animate-spin text-cyan-500" /></div>
        ) : apps.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 py-16 text-center dark:border-gray-800">
            <Globe size={36} className="mx-auto mb-4 text-gray-300 dark:text-gray-600" />
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{t('apps.empty')}</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-gray-400">
              {t('apps.emptyHint')}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {presets.slice(0, 5).map((p) => (
                <button
                  key={p.url}
                  onClick={() => applyPreset(p)}
                  className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-[13px] font-medium text-gray-700 transition-all hover:border-cyan-300 hover:text-cyan-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                >
                  + {p.name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {apps.map((app) => (
                <div
                  key={app.id}
                  className="group relative flex flex-col rounded-2xl border border-gray-200 bg-white p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
                >
                  <button onClick={() => void handleOpen(app)} className="flex flex-col items-start gap-2.5 text-left">
                    <AppIcon name={app.name} url={app.url} className="h-10 w-10" />
                    <span className="w-full">
                      <span className="block truncate text-[13px] font-medium text-gray-800 dark:text-gray-100">{app.name}</span>
                      <span className="block truncate text-[11px] text-gray-400">{hostOf(app.url)}</span>
                    </span>
                  </button>
                  <div className="absolute right-2 top-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => openEdit(app)}
                      title={t('common:edit')}
                      aria-label={t('common:edit')}
                      className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => handleDelete(app)}
                      title={t('common:delete')}
                      aria-label={t('common:delete')}
                      className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-500 dark:hover:bg-gray-800"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8">
              <p className="mb-2.5 text-xs font-medium uppercase tracking-wider text-gray-400">{t('apps.presetsTitle')}</p>
              <div className="flex flex-wrap gap-2">
                {presets.filter((p) => !apps.some((a) => normalizeUrl(a.url) === p.url)).map((p) => (
                  <button
                    key={p.url}
                    onClick={() => applyPreset(p)}
                    className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-[13px] font-medium text-gray-600 transition-all hover:border-cyan-300 hover:text-cyan-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                  >
                    + {p.name}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* 添加 / 编辑弹窗 */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
                    <Globe size={16} className="text-cyan-600 dark:text-cyan-400" />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{editingApp ? t('apps.editTitle') : t('apps.add')}</h3>
                </div>
                <button onClick={() => setShowForm(false)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"><X size={18} /></button>
              </div>
              <div className="space-y-4 px-5 py-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('common:name')}</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder={t('apps.namePlaceholder')}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('apps.urlLabel')}</label>
                  <input
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                    placeholder="https://chat.deepseek.com"
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:bg-white dark:border-gray-600 dark:bg-gray-700"
                  />
                </div>
                {!editingApp && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">{t('apps.quickPick')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {presets.filter((p) => !apps.some((a) => normalizeUrl(a.url) === p.url)).slice(0, 6).map((p) => (
                        <button
                          key={p.url}
                          onClick={() => setForm({ name: p.name, url: p.url })}
                          className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-600 transition-colors hover:border-cyan-300 hover:text-cyan-600 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {formError && (
                  <p className="flex items-center gap-1.5 text-xs text-red-500"><AlertCircle size={12} />{formError}</p>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-gray-700">
                <button onClick={() => setShowForm(false)} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">{t('common:cancel')}</button>
                <button
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
                >
                  {saveMutation.isPending ? t('apps.saving') : editingApp ? t('common:save') : t('common:add')}
                </button>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    } />
  )
}

/** 内嵌浏览器视图（纯浏览器模式）：工具条 + iframe + 拒绝连接提示 */
function EmbeddedAppView({ app, onClose }: { app: IWebApp; onClose: () => void }) {
  const { t } = useTranslation('settings')
  const [frameKey, setFrameKey] = useState(0)
  const [timedOut, setTimedOut] = useState(false)
  const url = normalizeUrl(app.url)

  // iframe 被 X-Frame-Options / CSP 拒绝时不会抛错，只会停留空白；
  // 4 秒仍无加载完成即提示用户改用其他打开方式。
  useEffect(() => {
    setTimedOut(false)
    const timer = window.setTimeout(() => setTimedOut(true), 4000)
    return () => window.clearTimeout(timer)
  }, [frameKey, url])

  return (
    <AppLayout showSidebar={false} mainContent={
      /* 注意：mainContent 位于行向 flex 容器内，根节点必须 flex-1 + min-w-0 才能撑满宽度 */
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-gray-50 dark:bg-gray-950">
        {/* 工具条 */}
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-gray-200 bg-white px-3 dark:border-gray-800 dark:bg-gray-900">
          <button onClick={onClose} title={t('apps.backToList')} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800">
            <ArrowLeft size={14} />
            {t('apps.backLabel')}
          </button>
          <div className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700" />
          <button onClick={() => setFrameKey((k) => k + 1)} title={t('common:refresh')} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800">
            <RefreshCw size={14} />
          </button>
          <button onClick={() => void openAppWebview(url, app.name)} title={t('apps.openInAppWindow')} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800">
            <AppWindow size={14} />
          </button>
          <button onClick={() => window.open(url, '_blank', 'noopener')} title={t('apps.openInBrowser')} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800">
            <ExternalLink size={14} />
          </button>
          <div className="mx-1 flex min-w-0 flex-1 items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-800">
            <Globe size={12} className="shrink-0 text-gray-400" />
            <span className="min-w-0 flex-1 truncate text-[12px] text-gray-600 dark:text-gray-300">{url}</span>
          </div>
          <span className="shrink-0 text-[12px] font-medium text-gray-500 dark:text-gray-400">{app.name}</span>
        </div>

        {/* 提示条：4 秒未加载完成时说明内嵌被拒绝 */}
        {timedOut && (
          <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[12px] text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertCircle size={13} className="shrink-0" />
            <span className="min-w-0 flex-1">{t('apps.embedBlocked')}</span>
            <button
              onClick={() => void openAppWebview(url, app.name)}
              className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-amber-700"
            >
              {t('apps.openAppWindow')}
            </button>
          </div>
        )}

        {/* 网页 */}
        <div className="min-h-0 flex-1 bg-white dark:bg-[#0c0f1a]">
          <iframe
            key={frameKey}
            src={url}
            title={app.name}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </div>
    } />
  )
}
