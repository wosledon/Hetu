import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle, Globe, Info, Loader2, Pencil, Plus, Trash2, X,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { appsService, normalizeUrl, getWebAppPresets } from '../services/appsService'
import type { IWebApp } from '../services/appsService'
import { isTauri, openAppWindow, openExternal } from '../utils/tauri'
import { Button, Card, IconButton, Input, Modal, PageContainer } from '../components/ui'

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
  const desktop = isTauri()
  const [editingApp, setEditingApp] = useState<IWebApp | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', url: '' })
  const [formError, setFormError] = useState('')
  /** 内置 WebView 打开时的提醒（桌面壳里找不到 Chromium 浏览器才会走到） */
  const [webviewNotice, setWebviewNotice] = useState<{ name: string; url: string } | null>(null)
  const [openError, setOpenError] = useState('')
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
  }

  const applyPreset = (preset: { name: string; url: string }) => {
    if (apps.some((a) => normalizeUrl(a.url) === preset.url)) return
    saveMutation.mutate([...apps, { id: crypto.randomUUID(), ...preset, createdAt: new Date().toISOString() }])
  }

  /**
   * 桌面壳：交给壳侧开独立窗口。
   * 优先系统 Chromium 浏览器的应用模式（真实内核，登录可用），没有浏览器时才退回内置 WebView。
   * 浏览器：卡片本身就是 <a target="_blank">，点击直接由浏览器打开，不会走到这里。
   */
  const handleOpen = (app: IWebApp) => {
    const url = normalizeUrl(app.url)
    if (!url) return
    setOpenError('')
    void openAppWindow(url, app.name)
      .then((mode) => {
        if (mode === 'webview') setWebviewNotice({ name: app.name, url })
        else if (mode === 'failed') setOpenError(t('apps.openFailed'))
      })
      .catch(() => setOpenError(t('apps.openFailed')))
  }

  const cardBody = (app: IWebApp) => (
    <>
      <AppIcon name={app.name} url={app.url} className="h-10 w-10" />
      <span className="w-full">
        <span className="block truncate text-[13px] font-medium text-gray-800 dark:text-gray-100">{app.name}</span>
        <span className="block truncate text-[11px] text-gray-400">{hostOf(app.url)}</span>
      </span>
    </>
  )

  return (
    <AppLayout showSidebar={false} mainContent={
      <PageContainer>
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-100 text-cyan-600 dark:bg-cyan-900/40 dark:text-cyan-300">
          <Globe size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('apps.title')}</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('apps.subtitle')}</p>
        </div>
        <Button variant="primary" tone="cyan" pill className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full bg-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-cyan-700 active:scale-[0.97]" onClick={openCreate}>
          <Plus size={16} />
          {t('apps.add')}
        </Button>
      </div>

      {/* 打开方式说明：先讲清预期，避免把「登录不了」当成故障 */}
      <div className="mb-5 flex items-start gap-2 rounded-xl border border-cyan-200/70 bg-cyan-50/60 px-4 py-3 text-[12px] leading-relaxed text-cyan-800 dark:border-cyan-800/40 dark:bg-cyan-950/20 dark:text-cyan-200">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span className="min-w-0 flex-1">{desktop ? t('apps.windowHintDesktop') : t('apps.windowHintBrowser')}</span>
      </div>

      {webviewNotice && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertCircle size={14} className="shrink-0" />
          <span className="min-w-0 flex-1">{t('apps.webviewFallback', { name: webviewNotice.name })}</span>
          <Button variant="primary" tone="amber" className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-amber-700" onClick={() => openExternal(webviewNotice.url)}>
            {t('apps.openInBrowser')}
          </Button>
          <IconButton variant="ghost" tone="gray" className="shrink-0 rounded-md p-1 text-amber-700 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/30" label={t('common:close')} onClick={() => setWebviewNotice(null)}>
            <X size={13} />
          </IconButton>
        </div>
      )}

      {openError && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-300">
          <AlertCircle size={14} className="shrink-0" />
          <span className="min-w-0 flex-1">{openError}</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-24"><Loader2 size={24} className="animate-spin text-cyan-500" /></div>
      ) : apps.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-16 text-center dark:border-gray-800">
          <Globe size={36} className="mx-auto mb-4 text-gray-300 dark:text-gray-600" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{t('apps.empty')}</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-gray-400">
            {t('apps.emptyHint')}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {presets.slice(0, 5).map((p) => (
              <Button variant="secondary" pill className="rounded-full border border-gray-200 bg-white glass px-3.5 py-1.5 text-[13px] font-medium text-gray-700 transition-all hover:border-cyan-300 hover:text-cyan-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300" key={p.url}
                onClick={() => applyPreset(p)}>
                + {p.name}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {apps.map((app) => (
              <Card
                key={app.id}
                className="group relative flex flex-col p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/40 hover:shadow-md dark:hover:border-white/10"
              >
                {desktop ? (
                  <button type="button" onClick={() => handleOpen(app)} className="flex flex-col items-start gap-2.5 text-left">
                    {cardBody(app)}
                  </button>
                ) : (
                  <a
                    href={normalizeUrl(app.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col items-start gap-2.5 text-left"
                  >
                    {cardBody(app)}
                  </a>
                )}
                <div className="absolute right-2 top-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <IconButton variant="ghost" tone="gray" className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800" label={t('common:edit')} onClick={() => openEdit(app)}
                    title={t('common:edit')}
                    aria-label={t('common:edit')}>
                    <Pencil size={13} />
                  </IconButton>
                  <IconButton variant="ghost" tone="gray" className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-500 dark:hover:bg-gray-800" label={t('common:delete')} onClick={() => handleDelete(app)}
                    title={t('common:delete')}
                    aria-label={t('common:delete')}>
                    <Trash2 size={13} />
                  </IconButton>
                </div>
              </Card>
            ))}
          </div>

          <div className="mt-8">
            <p className="mb-2.5 text-xs font-medium uppercase tracking-wider text-gray-400">{t('apps.presetsTitle')}</p>
            <div className="flex flex-wrap gap-2">
              {presets.filter((p) => !apps.some((a) => normalizeUrl(a.url) === p.url)).map((p) => (
                <Button variant="secondary" pill className="rounded-full border border-gray-200 bg-white glass px-3.5 py-1.5 text-[13px] font-medium text-gray-600 transition-all hover:border-cyan-300 hover:text-cyan-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300" key={p.url}
                  onClick={() => applyPreset(p)}>
                  + {p.name}
                </Button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* 添加 / 编辑弹窗 */}
      {showForm && (
        <Modal open onClose={() => setShowForm(false)} dismissible={false} className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-700">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
                  <Globe size={16} className="text-cyan-600 dark:text-cyan-400" />
                </div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{editingApp ? t('apps.editTitle') : t('apps.add')}</h3>
              </div>
              <button onClick={() => setShowForm(false)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label={t('common:close')}><X size={18} /></button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('common:name')}</label>
                <Input tone="cyan"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t('apps.namePlaceholder')}
                  className="w-full"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('apps.urlLabel')}</label>
                <Input tone="cyan"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                  placeholder="https://chat.deepseek.com"
                  className="w-full"
                />
              </div>
              {!editingApp && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">{t('apps.quickPick')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {presets.filter((p) => !apps.some((a) => normalizeUrl(a.url) === p.url)).slice(0, 6).map((p) => (
                      <Button variant="secondary" pill surface="modal" className="rounded-full border border-gray-200 bg-white glass px-2.5 py-1 text-[11px] text-gray-600 transition-colors hover:border-cyan-300 hover:text-cyan-600 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300" key={p.url}
                        onClick={() => setForm({ name: p.name, url: p.url })}>
                        {p.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              {formError && (
                <p className="flex items-center gap-1.5 text-xs text-red-500"><AlertCircle size={12} />{formError}</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-gray-700">
              <Button variant="ghost" tone="gray" className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700" onClick={() => setShowForm(false)}>{t('common:cancel')}</Button>
              <Button variant="primary" tone="cyan" className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50" onClick={handleSave}
                disabled={saveMutation.isPending}>
                {saveMutation.isPending ? t('apps.saving') : editingApp ? t('common:save') : t('common:add')}
              </Button>
            </div>
        </Modal>
      )}
      </PageContainer>
    } />
  )
}
