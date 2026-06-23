import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Save, Plus, Pencil, Trash2 } from 'lucide-react'
import { agentService } from '../../services/agentService'
import { aiModelService } from '../../services/aiProviderService'
import { mcpService } from '../../services/mcpService'
import type { IAgent, CreateAgentRequest } from '../../types/agent'
import type { IAiModel, IMcpServer } from '../../types'
import Select from '../Select'

const AVAILABLE_TOOLS = [
  { name: 'search_notes', label: '搜索笔记', category: '检索' },
  { name: 'read_note', label: '读取笔记', category: '检索' },
  { name: 'search_web', label: '网络搜索', category: '检索' },
  { name: 'search_memory', label: '搜索记忆', category: '检索' },
  { name: 'search_graph', label: '搜索图谱', category: '检索' },
  { name: 'create_note', label: '创建笔记', category: '写入' },
  { name: 'update_note', label: '更新笔记', category: '写入' },
  { name: 'create_memory', label: '保存记忆', category: '写入' },
  { name: 'ask_question', label: '向用户提问', category: '交互' },
  { name: 'todo', label: '任务管理', category: '交互' },
  { name: 'create_scheduled_task', label: '创建定时任务', category: '执行' },
  { name: 'run_command', label: '执行命令', category: '执行' },
] as const

const inputClass =
  'w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2 text-sm outline-none transition-all focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20'
const labelClass = 'mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400'

const emptyForm: CreateAgentRequest = {
  name: '',
  description: '',
  category: '自定义',
  systemPrompt: '',
  modelId: undefined,
  toolNames: [],
  mcpServerIds: [],
  skillIds: [],
  toolApprovals: {},
  maxToolCallsPerTurn: 5,
  maxAgentIterations: 15,
  isEnabled: true,
  sortOrder: 0,
}

interface AgentModalProps {
  open: boolean
  onClose: () => void
  editingAgent?: IAgent | null
}

export default function AgentModal({ open, onClose, editingAgent }: AgentModalProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CreateAgentRequest>(emptyForm)

  const { data: models = [] } = useQuery({ queryKey: ['aiModels'], queryFn: aiModelService.getAll })
  const { data: mcpServers = [] } = useQuery({ queryKey: ['mcpServers'], queryFn: mcpService.getAll })

  const chatModels = (models as IAiModel[]).filter((m) => m.purpose === 'chat')

  useEffect(() => {
    if (editingAgent) {
      setForm({
        name: editingAgent.name,
        description: editingAgent.description,
        category: editingAgent.category,
        systemPrompt: editingAgent.systemPrompt,
        modelId: editingAgent.modelId,
        toolNames: editingAgent.toolNames ?? [],
        mcpServerIds: editingAgent.mcpServerIds ?? [],
        skillIds: editingAgent.skillIds ?? [],
        toolApprovals: editingAgent.toolApprovals ?? {},
        maxToolCallsPerTurn: editingAgent.maxToolCallsPerTurn,
        maxAgentIterations: editingAgent.maxAgentIterations,
        isEnabled: editingAgent.isEnabled,
        sortOrder: editingAgent.sortOrder,
      })
    } else {
      setForm(emptyForm)
    }
  }, [editingAgent, open])

  const createMut = useMutation({
    mutationFn: (data: CreateAgentRequest) => agentService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      onClose()
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CreateAgentRequest }) => agentService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      onClose()
    },
  })

  if (!open) return null

  const toggleTool = (name: string) => {
    setForm((f) => ({
      ...f,
      toolNames: f.toolNames.includes(name)
        ? f.toolNames.filter((t) => t !== name)
        : [...f.toolNames, name],
    }))
  }

  const toggleMcp = (id: string) => {
    setForm((f) => ({
      ...f,
      mcpServerIds: f.mcpServerIds.includes(id)
        ? f.mcpServerIds.filter((t) => t !== id)
        : [...f.mcpServerIds, id],
    }))
  }

  const handleSave = () => {
    if (!form.name.trim() || !form.systemPrompt.trim()) return
    if (editingAgent) {
      updateMut.mutate({ id: editingAgent.id, data: form })
    } else {
      createMut.mutate(form)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-white/[0.08]">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            {editingAgent ? '编辑 Agent' : '新建 Agent'}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>名称 *</label>
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Agent 名称" />
            </div>
            <div>
              <label className={labelClass}>分类</label>
              <input className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="自定义" />
            </div>
          </div>

          <div>
            <label className={labelClass}>描述</label>
            <input className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="一句话描述" />
          </div>

          <div>
            <label className={labelClass}>系统提示词 *</label>
            <textarea
              className={`${inputClass} h-28 resize-none font-mono text-xs`}
              value={form.systemPrompt}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              placeholder="你是一个专业的..."
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelClass}>对话模型</label>
              <Select
                value={form.modelId ?? ''}
                onChange={(v) => setForm({ ...form, modelId: v || undefined })}
                options={[{ value: '', label: '默认模型' }, ...chatModels.map((m) => ({ value: m.id, label: m.displayName }))]}
                searchable
              />
            </div>
            <div>
              <label className={labelClass}>单轮工具上限</label>
              <input type="number" className={inputClass} value={form.maxToolCallsPerTurn} onChange={(e) => setForm({ ...form, maxToolCallsPerTurn: parseInt(e.target.value) || 5 })} />
            </div>
            <div>
              <label className={labelClass}>最大迭代</label>
              <input type="number" className={inputClass} value={form.maxAgentIterations} onChange={(e) => setForm({ ...form, maxAgentIterations: parseInt(e.target.value) || 15 })} />
            </div>
          </div>

          <div>
            <label className={labelClass}>工具</label>
            <div className="flex flex-wrap gap-1.5">
              {AVAILABLE_TOOLS.map((t) => (
                <button
                  key={t.name}
                  onClick={() => toggleTool(t.name)}
                  className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
                    form.toolNames.includes(t.name)
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelClass}>MCP 服务器</label>
            <div className="flex flex-wrap gap-1.5">
              {(mcpServers as IMcpServer[]).filter((s) => s.isEnabled).length === 0 && (
                <span className="text-xs text-gray-400">暂无已启用的 MCP 服务器</span>
              )}
              {(mcpServers as IMcpServer[]).filter((s) => s.isEnabled).map((s) => (
                <button
                  key={s.id}
                  onClick={() => toggleMcp(s.id)}
                  className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
                    form.mcpServerIds.includes(s.id)
                      ? 'bg-indigo-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-white/[0.08]">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]">
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!form.name.trim() || !form.systemPrompt.trim()}
            className="flex items-center gap-1.5 rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
          >
            <Save size={15} /> 保存
          </button>
        </div>
      </div>
    </div>
  )
}

/// Agent 列表管理组件（嵌入式，可放在工作流编辑器侧栏）
export function AgentListManager({ onEdit }: { onEdit?: (agent: IAgent) => void }) {
  const queryClient = useQueryClient()
  const { data: agents = [] } = useQuery({ queryKey: ['agents'], queryFn: agentService.getAll })
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<IAgent | null>(null)

  const deleteMut = useMutation({
    mutationFn: (id: string) => agentService.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  })

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Agent 列表</span>
        <button
          onClick={() => { setEditing(null); setShowModal(true) }}
          className="flex items-center gap-1 rounded-lg bg-blue-500 px-2.5 py-1 text-xs text-white hover:bg-blue-600"
        >
          <Plus size={13} /> 新建
        </button>
      </div>
      <div className="space-y-1">
        {agents.length === 0 && <p className="text-xs text-gray-400">暂无 Agent</p>}
        {agents.map((a) => (
          <div key={a.id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5 dark:border-white/[0.08]">
            <span className={`h-2 w-2 shrink-0 rounded-full ${a.isEnabled ? 'bg-green-500' : 'bg-gray-300'}`} />
            <span className="flex-1 truncate text-sm text-gray-700 dark:text-gray-200">{a.name}</span>
            <button onClick={() => { setEditing(a); setShowModal(true); onEdit?.(a) }} className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]">
              <Pencil size={13} />
            </button>
            <button onClick={() => confirm(`删除 Agent "${a.name}"？`) && deleteMut.mutate(a.id)} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <AgentModal open={showModal} onClose={() => setShowModal(false)} editingAgent={editing} />
    </div>
  )
}
