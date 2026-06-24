import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { GitBranch, Plus, Play, Pencil, Copy, Trash2, Workflow as WorkflowIcon } from 'lucide-react'
import AppLayout from '../components/AppLayout'
import { workflowService } from '../services/workflowService'
import { promptPresetService } from '../services/promptPresetService'
import type { IWorkflow } from '../types/workflow'
import type { IPromptPreset } from '../types'
import WorkflowEditor from '../components/workflow/WorkflowEditor'
import RunDialog from '../components/workflow/RunDialog'

const AVAILABLE_TOOLS = [
  { name: 'search_notes', label: '搜索笔记' },
  { name: 'read_note', label: '读取笔记' },
  { name: 'search_web', label: '网络搜索' },
  { name: 'search_memory', label: '搜索记忆' },
  { name: 'search_graph', label: '搜索图谱' },
  { name: 'create_note', label: '创建笔记' },
  { name: 'update_note', label: '更新笔记' },
  { name: 'create_memory', label: '保存记忆' },
  { name: 'ask_question', label: '向用户提问' },
  { name: 'todo', label: '任务管理' },
  { name: 'create_scheduled_task', label: '创建定时任务' },
  { name: 'run_command', label: '执行命令' },
]

export default function WorkflowsPage() {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [runningWorkflow, setRunningWorkflow] = useState<IWorkflow | null>(null)

  const { data: workflows = [] } = useQuery({ queryKey: ['workflows'], queryFn: workflowService.getAll })
  const { data: promptPresets = [] } = useQuery({ queryKey: ['promptPresets'], queryFn: promptPresetService.getAll })

  const createMut = useMutation({
    mutationFn: () =>
      workflowService.create({
        name: '新工作流',
        description: '',
        nodes: [
          { id: 'start_1', type: 'start', label: '开始', x: 100, y: 200 },
          { id: 'end_1', type: 'end', label: '结束', x: 500, y: 200 },
        ],
        edges: [{ id: 'e1', source: 'start_1', target: 'end_1' }],
        isEnabled: true,
        sortOrder: 0,
      }),
    onSuccess: (wf) => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      setEditingId(wf.id)
    },
  })

  const duplicateMut = useMutation({
    mutationFn: (id: string) => workflowService.duplicate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => workflowService.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
  })

  const editingWorkflow = workflows.find((w) => w.id === editingId)

  if (editingWorkflow) {
    return (
      <AppLayout
        showSidebar={false}
        mainContent={
          <WorkflowEditor
            workflow={editingWorkflow}
            agents={promptPresets as IPromptPreset[]}
            workflows={workflows}
            availableTools={AVAILABLE_TOOLS}
            onBack={() => setEditingId(null)}
            onRun={(wf) => setRunningWorkflow(wf)}
          />
        }
      />
    )
  }

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3 dark:border-white/[0.08] dark:bg-gray-900/50">
            <div className="flex items-center gap-2">
              <GitBranch size={20} className="text-blue-500" />
              <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100">工作流</h1>
              <span className="text-xs text-gray-400">编排 Agent 的可视化流程</span>
            </div>
            <button
              onClick={() => createMut.mutate()}
              className="flex items-center gap-1.5 rounded-xl bg-blue-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-600"
            >
              <Plus size={15} /> 新建工作流
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {workflows.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 dark:bg-white/[0.06]">
                  <WorkflowIcon size={32} className="text-gray-400" />
                </div>
                <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200">还没有工作流</h2>
                <p className="mt-1 text-sm text-gray-400">创建一个工作流，编排 Agent 完成多步骤任务</p>
                <button
                  onClick={() => createMut.mutate()}
                  className="mt-4 flex items-center gap-1.5 rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
                >
                  <Plus size={16} /> 新建工作流
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {workflows.map((wf) => (
                  <div
                    key={wf.id}
                    className="group flex flex-col rounded-xl border border-gray-200 bg-white p-4 transition-all hover:border-blue-300 hover:shadow-md dark:border-white/[0.08] dark:bg-gray-800 dark:hover:border-blue-500/40"
                  >
                    <div className="mb-2 flex items-start justify-between">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-500/10">
                        <WorkflowIcon size={18} className="text-blue-500" />
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${wf.isEnabled ? 'bg-green-100 text-green-600 dark:bg-green-500/10 dark:text-green-400' : 'bg-gray-100 text-gray-400 dark:bg-white/[0.06]'}`}>
                        {wf.isEnabled ? '启用' : '禁用'}
                      </span>
                    </div>
                    <h3 className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{wf.name}</h3>
                    <p className="mt-0.5 line-clamp-2 text-xs text-gray-400">{wf.description || '暂无描述'}</p>
                    <div className="mt-2 flex items-center gap-3 text-[10px] text-gray-400">
                      <span>{wf.nodes.length} 节点</span>
                      <span>v{wf.version}</span>
                    </div>
                    <div className="mt-3 flex items-center gap-1 border-t border-gray-100 pt-2 dark:border-white/[0.06]">
                      <button onClick={() => setRunningWorkflow(wf)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-green-600 hover:bg-green-50 dark:hover:bg-green-500/10" title="运行">
                        <Play size={13} /> 运行
                      </button>
                      <button onClick={() => setEditingId(wf.id)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10" title="编辑">
                        <Pencil size={13} /> 编辑
                      </button>
                      <button onClick={() => duplicateMut.mutate(wf.id)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]" title="复制">
                        <Copy size={13} />
                      </button>
                      <div className="flex-1" />
                      <button
                        onClick={() => confirm(`删除工作流 "${wf.name}"？`) && deleteMut.mutate(wf.id)}
                        className="rounded-lg p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                        title="删除"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {runningWorkflow && (
            <RunDialog workflow={runningWorkflow} onClose={() => setRunningWorkflow(null)} />
          )}
        </div>
      }
    />
  )
}
