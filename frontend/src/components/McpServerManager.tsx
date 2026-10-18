import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen, Brain, Check, Edit2, FolderOpen, GitBranch, GitPullRequest, Globe,
  ListChecks, Loader2, Play, Plus, RefreshCw, Trash2, Wrench, X,
} from 'lucide-react'
import { mcpService } from '../services/mcpService'
import { MCP_PRESETS, type McpPreset } from '../utils/mcpPresets'
import Select from './Select'
import type { IMcpServer, IMcpTool } from '../types'
import { Button, Card, IconButton, Input, Textarea } from './ui'

const defaultConfig = JSON.stringify(
  {
    command: 'node',
    args: ['path/to/mcp-server.js'],
    env: {},
  },
  null,
  2
)

const PRESET_ICONS: Record<string, typeof Wrench> = {
  filesystem: FolderOpen,
  git: GitBranch,
  fetch: Globe,
  memory: Brain,
  'sequential-thinking': ListChecks,
  playwright: Play,
  github: GitPullRequest,
  context7: BookOpen,
}

export default function McpServerManager({ embedded = false }: { embedded?: boolean }) {
  const queryClient = useQueryClient()
  const { t } = useTranslation('settings')
  const formRef = useRef<HTMLDivElement>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedServer, setSelectedServer] = useState<IMcpServer | null>(null)
  const [tools, setTools] = useState<IMcpTool[]>([])
  const [isLoadingTools, setIsLoadingTools] = useState(false)
  const [toolResult, setToolResult] = useState<{ toolName: string; content: string; isError: boolean } | null>(null)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({
    name: '',
    description: '',
    type: 'stdio' as 'stdio' | 'sse',
    connectionConfig: defaultConfig,
    isEnabled: true,
    sortOrder: 0,
  })

  const { data: servers = [] } = useQuery({
    queryKey: ['mcpServers'],
    queryFn: () => mcpService.getAll(),
  })

  const createMutation = useMutation({
    mutationFn: mcpService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] })
      setIsCreating(false)
      resetForm()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof mcpService.update>[1] }) =>
      mcpService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcpServers'] })
      setEditingId(null)
      resetForm()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: mcpService.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mcpServers'] }),
  })

  const resetForm = () => {
    setForm({
      name: '',
      description: '',
      type: 'stdio',
      connectionConfig: defaultConfig,
      isEnabled: true,
      sortOrder: 0,
    })
  }

  const startEdit = (server: IMcpServer) => {
    setEditingId(server.id)
    setForm({
      name: server.name,
      description: server.description,
      type: server.type,
      connectionConfig: server.connectionConfig,
      isEnabled: server.isEnabled,
      sortOrder: server.sortOrder,
    })
  }

  const handleSave = () => {
    if (!form.name.trim() || !form.connectionConfig.trim()) return
    if (/<path>|<token>/i.test(form.connectionConfig)) {
      setFormError(t('mcp.placeholderRequired'))
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setFormError('')
    const data = { ...form }
    if (editingId) {
      updateMutation.mutate({ id: editingId, data })
    } else {
      createMutation.mutate({
        name: form.name,
        description: form.description,
        type: form.type,
        connectionConfig: form.connectionConfig,
      })
    }
  }

  const applyPreset = (preset: McpPreset) => {
    setEditingId(null)
    setForm({
      name: t(preset.nameKey),
      description: t(preset.descKey),
      type: 'stdio',
      connectionConfig: preset.connectionConfig,
      isEnabled: true,
      sortOrder: 0,
    })
    setIsCreating(true)
    setFormError('')
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  const handleListTools = async (server: IMcpServer) => {
    setSelectedServer(server)
    setIsLoadingTools(true)
    setTools([])
    setToolResult(null)
    try {
      const result = await mcpService.listTools(server.id)
      setTools(result)
    } catch (error) {
      console.error('List tools error:', error)
    } finally {
      setIsLoadingTools(false)
    }
  }

  const handleCallTool = async (tool: IMcpTool) => {
    if (!selectedServer) return
    const argsText = window.prompt(t('mcp.callPrompt', { name: tool.name }), '{}')
    if (argsText === null) return

    try {
      const args = argsText ? JSON.parse(argsText) : {}
      const result = await mcpService.callTool(selectedServer.id, { toolName: tool.name, arguments: args })
      setToolResult({ toolName: tool.name, content: result.content, isError: result.isError })
    } catch (error) {
      setToolResult({
        toolName: tool.name,
        content: t('mcp.callFailed', { error: error instanceof Error ? error.message : t('mcp.unknownError') }),
        isError: true,
      })
    }
  }

  return (
    <section className="space-y-6">
      {/* Header / toolbar */}
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {t('mcp.configuredCount', { count: servers.length })}
          </p>
          {!isCreating && !editingId && (
            <Button variant="primary" tone="blue" size="sm" className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-[12px] font-medium text-white shadow-sm hover:bg-blue-600" onClick={() => { resetForm(); setIsCreating(true) }}>
              <Plus size={14} /> {t('mcp.customAdd')}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-slate-600 to-slate-800 text-white shadow-sm shadow-slate-500/20">
              <Wrench size={16} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">{t('mcp.title')}</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('mcp.subtitle')}</p>
            </div>
          </div>
          {!isCreating && !editingId && (
            <Button variant="primary" tone="blue" className="inline-flex items-center gap-1.5 rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 hover:shadow-md active:scale-[0.98]" onClick={() => { resetForm(); setIsCreating(true) }}>
              <Plus size={15} /> {t('mcp.add')}
            </Button>
          )}
        </div>
      )}

      {/* Form */}
      {(isCreating || editingId) && (
        <div ref={formRef} className="rounded-xl border border-blue-200/60 bg-blue-50/30 p-5 dark:border-blue-500/20 dark:bg-blue-950/10">
          <h3 className="mb-4 text-sm font-semibold text-gray-800 dark:text-gray-200">
            {editingId ? t('mcp.editServer') : t('mcp.createServer')}
          </h3>
          <div className="space-y-3">
            <Input
              type="text"
              placeholder={t('common:name')}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Input
              type="text"
              placeholder={t('common:description')}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <Select
              value={form.type}
              onChange={(value) => setForm({ ...form, type: value as 'stdio' | 'sse' })}
              options={[
                { value: 'stdio', label: 'stdio' },
                { value: 'sse', label: 'sse' },
              ]}
            />
            <Textarea tone="blue" size="lg" glass
              placeholder={t('mcp.configPlaceholder')}
              value={form.connectionConfig}
              onChange={(e) => { setForm({ ...form, connectionConfig: e.target.value }); if (formError) setFormError('') }}
              className="h-32 w-full resize-none font-mono"
            />
            {formError && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">{formError}</p>
            )}
            {editingId && (
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.03]">
                <input
                  type="checkbox"
                  checked={form.isEnabled}
                  onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500/20"
                />
                {t('common:enable')}
              </label>
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="primary" tone="blue" className="inline-flex items-center gap-1.5 rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 active:scale-[0.98]" onClick={handleSave}>
                <Check size={14} /> {t('common:save')}
              </Button>
              <Button variant="ghost" tone="gray" className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-400 dark:hover:bg-white/[0.04]" onClick={() => {
                  setIsCreating(false)
                  setEditingId(null)
                  resetForm()
                }}>
                <span className="inline-flex items-center gap-1.5"><X size={14} /> {t('common:cancel')}</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 常用 MCP 预设 */}
      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t('mcp.presetTitle')}</h3>
          <span className="text-[10px] text-gray-400 dark:text-gray-500">{t('mcp.presetHint')}</span>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {MCP_PRESETS.map((preset) => {
            const Icon = PRESET_ICONS[preset.id] ?? Wrench
            const added = servers.some((server) => server.name === t(preset.nameKey))
            return (
              <Card key={preset.id} className="p-3.5 transition-colors hover:border-white/40 dark:hover:border-white/10">
                <div className="flex items-start gap-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    <Icon size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12px] font-semibold text-gray-800 dark:text-gray-200">{t(preset.nameKey)}</span>
                      {preset.requires.map((req) => (
                        <span
                          key={req}
                          className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                            req === 'path' || req === 'token'
                              ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400'
                              : 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'
                          }`}
                        >
                          {t(`mcpPresets.requires.${req}`)}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{t(preset.descKey)}</p>
                  </div>
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <code className="min-w-0 truncate text-[10px] text-gray-400 dark:text-gray-500" title={preset.binary}>{preset.binary}</code>
                  <Button variant="secondary" size="sm" disabled={added} className="shrink-0 rounded-lg px-2 py-1 text-[11px]" onClick={() => applyPreset(preset)}>
                    {added ? <Check size={12} /> : <Plus size={12} />} {added ? t('mcp.added') : t('mcp.addPreset')}
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      </div>

      {servers.length > 0 && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t('mcp.configured')}</h3>
          <span className="text-[10px] tabular-nums text-gray-400">{servers.length}</span>
        </div>
      )}

      {/* Empty State */}
      {servers.length === 0 && !isCreating && (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 py-12 dark:border-white/[0.08]">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-white/[0.06]">
            <Wrench size={24} className="text-gray-400" />
          </div>
          <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">{t('mcp.empty')}</p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{t('mcp.emptyHint')}</p>
        </div>
      )}

      {/* Server Cards */}
      <div className="space-y-3">
        {servers.map((server) => (
          <Card
            key={server.id}
            padded={false}
            className={`shadow-sm transition-all dark:bg-white/[0.02] ${
              server.isEnabled
                ? ''
                : 'opacity-60'
            }`}
          >
            <div className="flex items-start justify-between px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{server.name}</span>
                  <span className="inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">
                    {server.type}
                  </span>
                  {!server.isEnabled && (
                    <span className="inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:bg-white/[0.06] dark:text-gray-500">
                      {t('common:disabled')}
                    </span>
                  )}
                </div>
                {server.description && (
                  <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{server.description}</p>
                )}
              </div>
              <div className="flex gap-1 ml-3">
                <IconButton variant="ghost" tone="gray" className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-white/[0.06] dark:hover:text-indigo-400" label={t('mcp.discoverTools')} onClick={() => handleListTools(server)}
                  
                  title={t('mcp.discoverTools')}>
                  <RefreshCw size={14} />
                </IconButton>
                <button
                  onClick={() => startEdit(server)}
                  className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-white/[0.06] dark:hover:text-indigo-400"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={() => deleteMutation.mutate(server.id)}
                  className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Tools Panel */}
      {selectedServer && (
        <Card className="p-5 shadow-sm dark:bg-white/[0.02]">
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-50 text-violet-500 dark:bg-violet-500/10 dark:text-violet-400">
              <Wrench size={13} />
            </div>
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t('mcp.toolsOf', { name: selectedServer.name })}</span>
          </div>

          {isLoadingTools && (
            <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
              <Loader2 size={14} className="animate-spin" />
              {t('mcp.loadingTools')}
            </div>
          )}

          <div className="space-y-2">
            {tools.map((tool) => (
              <div
                key={tool.name}
                className="group cursor-pointer rounded-lg border border-transparent px-3.5 py-2.5 transition-all hover:border-gray-200 hover:bg-gray-50 dark:hover:border-white/[0.06] dark:hover:bg-white/[0.03]"
                onClick={() => handleCallTool(tool)}
              >
                <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{tool.name}</div>
                <div className="text-xs text-gray-400 dark:text-gray-500">{tool.description}</div>
              </div>
            ))}
          </div>

          {toolResult && (
            <div
              className={`mt-4 rounded-xl border p-4 text-sm ${
                toolResult.isError
                  ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300'
                  : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300'
              }`}
            >
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider opacity-60">{toolResult.toolName}</div>
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs">{toolResult.content}</pre>
            </div>
          )}
        </Card>
      )}
    </section>
  )
}
