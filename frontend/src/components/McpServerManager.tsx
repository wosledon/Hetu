import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Edit2, Check, X, Wrench, RefreshCw } from 'lucide-react'
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
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">MCP Server</h2>
        {!isCreating && !editingId && (
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-1 text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
          >
            <Plus size={14} />
            新增
          </button>
        )}
      </div>

      {(isCreating || editingId) && (
        <div className="space-y-2 p-3 border border-gray-200 dark:border-gray-700 rounded-md">
          <input
            type="text"
            placeholder="名称"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent text-sm"
          />
          <input
            type="text"
            placeholder="描述"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent text-sm"
          />
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as 'stdio' | 'sse' })}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent text-sm"
          >
            <option value="stdio">stdio</option>
            <option value="sse">sse</option>
          </select>
          <textarea
            placeholder='连接配置 JSON：{ "command": "...", "args": [], "env": {} }'
            value={form.connectionConfig}
            onChange={(e) => setForm({ ...form, connectionConfig: e.target.value })}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-transparent text-sm h-32 resize-none font-mono"
          />
          {editingId && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isEnabled}
                onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })}
              />
              启用
            </label>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="flex items-center gap-1 text-sm px-3 py-1.5 bg-emerald-600 text-white rounded-md hover:bg-emerald-700"
            >
              <Check size={14} />
              保存
            </button>
            <button
              onClick={() => {
                setIsCreating(false)
                setEditingId(null)
                resetForm()
              }}
              className="flex items-center gap-1 text-sm px-3 py-1.5 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200"
            >
              <X size={14} />
              取消
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {servers.length === 0 && <div className="text-sm text-gray-400 text-center py-4">暂无 MCP Server</div>}
        {servers.map((server) => (
          <div
            key={server.id}
            className={`p-3 border rounded-md ${
              server.isEnabled
                ? 'border-gray-200 dark:border-gray-700'
                : 'border-gray-100 dark:border-gray-800 opacity-60'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <div className="font-medium text-sm">{server.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{server.description}</div>
                <div className="text-xs text-gray-400 mt-1">类型：{server.type}</div>
              </div>
              <div className="flex gap-1 ml-2">
                <button
                  onClick={() => handleListTools(server)}
                  className="p-1 text-gray-500 hover:text-indigo-600"
                  title="发现工具"
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  onClick={() => startEdit(server)}
                  className="p-1 text-gray-500 hover:text-indigo-600"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={() => deleteMutation.mutate(server.id)}
                  className="p-1 text-gray-500 hover:text-red-600"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {selectedServer && (
        <div className="border-t border-gray-200 dark:border-gray-800 pt-3 space-y-3">
          <div className="flex items-center gap-2">
            <Wrench size={14} />
            <span className="text-sm font-medium">{selectedServer.name} 的工具</span>
          </div>

          {isLoadingTools && <div className="text-sm text-gray-400">加载工具中...</div>}

          <div className="space-y-2">
            {tools.map((tool) => (
              <div
                key={tool.name}
                className="p-2 border border-gray-200 dark:border-gray-700 rounded-md text-sm hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                onClick={() => handleCallTool(tool)}
              >
                <div className="font-medium">{tool.name}</div>
                <div className="text-xs text-gray-500">{tool.description}</div>
              </div>
            ))}
          </div>

          {toolResult && (
            <div
              className={`p-3 rounded-md text-sm ${
                toolResult.isError
                  ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-200'
                  : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-200'
              }`}
            >
              <div className="font-medium mb-1">{toolResult.toolName}</div>
              <pre className="whitespace-pre-wrap break-words font-mono text-xs">{toolResult.content}</pre>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
