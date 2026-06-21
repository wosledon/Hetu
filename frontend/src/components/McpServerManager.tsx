import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Edit2, Check, X, Wrench, RefreshCw, Loader2 } from 'lucide-react'
import { mcpService } from '../services/mcpService'
import type { IMcpServer, IMcpTool } from '../types'

const defaultConfig = JSON.stringify(
  {
    command: 'node',
    args: ['path/to/mcp-server.js'],
    env: {},
  },
  null,
  2
)

const inputClass = 'w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm outline-none transition-all placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20'
const selectClass = 'w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm outline-none transition-all focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20'

export default function McpServerManager() {
  const queryClient = useQueryClient()
  const [isCreating, setIsCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedServer, setSelectedServer] = useState<IMcpServer | null>(null)
  const [tools, setTools] = useState<IMcpTool[]>([])
  const [isLoadingTools, setIsLoadingTools] = useState(false)
  const [toolResult, setToolResult] = useState<{ toolName: string; content: string; isError: boolean } | null>(null)
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
    const argsText = window.prompt(`调用 ${tool.name}，请输入 JSON 参数：`, '{}')
    if (argsText === null) return

    try {
      const args = argsText ? JSON.parse(argsText) : {}
      const result = await mcpService.callTool(selectedServer.id, { toolName: tool.name, arguments: args })
      setToolResult({ toolName: tool.name, content: result.content, isError: result.isError })
    } catch (error) {
      setToolResult({
        toolName: tool.name,
        content: '调用失败：' + (error instanceof Error ? error.message : '未知错误'),
        isError: true,
      })
    }
  }

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-sm shadow-violet-500/25">
            <Wrench size={16} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">MCP Server</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">管理工具服务连接</p>
          </div>
        </div>
        {!isCreating && !editingId && (
          <button
            onClick={() => setIsCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 hover:shadow-md active:scale-[0.98]"
          >
            <Plus size={15} /> 新增
          </button>
        )}
      </div>

      {/* Form */}
      {(isCreating || editingId) && (
        <div className="rounded-xl border border-blue-200/60 bg-blue-50/30 p-5 dark:border-blue-500/20 dark:bg-blue-950/10">
          <h3 className="mb-4 text-sm font-semibold text-gray-800 dark:text-gray-200">
            {editingId ? '编辑 Server' : '新增 Server'}
          </h3>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="名称"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
            />
            <input
              type="text"
              placeholder="描述"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className={inputClass}
            />
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as 'stdio' | 'sse' })}
              className={selectClass}
            >
              <option value="stdio">stdio</option>
              <option value="sse">sse</option>
            </select>
            <textarea
              placeholder='连接配置 JSON：{ "command": "...", "args": [], "env": {} }'
              value={form.connectionConfig}
              onChange={(e) => setForm({ ...form, connectionConfig: e.target.value })}
              className="h-32 w-full resize-none rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-3 font-mono text-sm outline-none transition-all placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20"
            />
            {editingId && (
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.03]">
                <input
                  type="checkbox"
                  checked={form.isEnabled}
                  onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500/20"
                />
                启用
              </label>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 active:scale-[0.98]"
              >
                <Check size={14} /> 保存
              </button>
              <button
                onClick={() => {
                  setIsCreating(false)
                  setEditingId(null)
                  resetForm()
                }}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-400 dark:hover:bg-white/[0.04]"
              >
                <span className="inline-flex items-center gap-1.5"><X size={14} /> 取消</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {servers.length === 0 && !isCreating && (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 py-12 dark:border-white/[0.08]">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-white/[0.06]">
            <Wrench size={24} className="text-gray-400" />
          </div>
          <p className="mt-3 text-sm font-medium text-gray-500 dark:text-gray-400">暂无 MCP Server</p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">点击上方按钮新增</p>
        </div>
      )}

      {/* Server Cards */}
      <div className="space-y-3">
        {servers.map((server) => (
          <div
            key={server.id}
            className={`rounded-xl border bg-white shadow-sm transition-all dark:bg-white/[0.02] ${
              server.isEnabled
                ? 'border-gray-200/80 dark:border-white/[0.08]'
                : 'border-gray-100 opacity-60 dark:border-white/[0.04]'
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
                      已禁用
                    </span>
                  )}
                </div>
                {server.description && (
                  <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{server.description}</p>
                )}
              </div>
              <div className="flex gap-1 ml-3">
                <button
                  onClick={() => handleListTools(server)}
                  className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-indigo-600 dark:hover:bg-white/[0.06] dark:hover:text-indigo-400"
                  title="发现工具"
                >
                  <RefreshCw size={14} />
                </button>
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
          </div>
        ))}
      </div>

      {/* Tools Panel */}
      {selectedServer && (
        <div className="rounded-xl border border-gray-200/80 bg-white p-5 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.02]">
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-50 text-violet-500 dark:bg-violet-500/10 dark:text-violet-400">
              <Wrench size={13} />
            </div>
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{selectedServer.name} 的工具</span>
          </div>

          {isLoadingTools && (
            <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
              <Loader2 size={14} className="animate-spin" />
              加载工具中...
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
        </div>
      )}
    </section>
  )
}
