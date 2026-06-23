import { useState, useRef, useCallback } from 'react'
import { X, Play, CheckCircle, XCircle, Loader, UserCheck } from 'lucide-react'
import type { IWorkflow, IWorkflowEvent } from '../../types/workflow'
import { streamWorkflowRun, workflowService } from '../../services/workflowService'

interface RunDialogProps {
  workflow: IWorkflow
  topicId?: string
  onClose: () => void
}

interface NodeState {
  nodeId: string
  label?: string
  nodeType?: string
  status: 'running' | 'success' | 'failed'
  output?: string
  error?: string
}

export default function RunDialog({ workflow, topicId, onClose }: RunDialogProps) {
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [nodeStates, setNodeStates] = useState<NodeState[]>([])
  const [finalOutput, setFinalOutput] = useState<string | null>(null)
  const [finalStatus, setFinalStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingApproval, setPendingApproval] = useState<{ nodeId: string; prompt: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const handleEvent = useCallback((evt: IWorkflowEvent) => {
    switch (evt.type) {
      case 'node_started':
        setNodeStates((prev) => [...prev, { nodeId: evt.nodeId!, label: evt.label, nodeType: evt.nodeType, status: 'running' }])
        break
      case 'node_completed':
        setNodeStates((prev) => prev.map((n) => n.nodeId === evt.nodeId ? { ...n, status: 'success', output: evt.output } : n))
        break
      case 'node_failed':
        setNodeStates((prev) => prev.map((n) => n.nodeId === evt.nodeId ? { ...n, status: 'failed', error: evt.error } : n))
        break
      case 'run_completed':
        setFinalOutput(evt.output ?? '')
        setFinalStatus('Succeeded')
        setRunning(false)
        break
      case 'run_failed':
        setError(evt.error ?? '执行失败')
        setFinalStatus('Failed')
        setRunning(false)
        break
      case 'run_result':
        if (evt.result) {
          setFinalStatus(evt.result.status)
          if (evt.result.output) setFinalOutput(evt.result.output)
          if (evt.result.error) setError(evt.result.error)
        }
        setRunning(false)
        break
    }
  }, [])

  const handleRun = async () => {
    setRunning(true)
    setError(null)
    setFinalOutput(null)
    setFinalStatus(null)
    setNodeStates([])
    setPendingApproval(null)

    const controller = new AbortController()
    abortRef.current = controller

    await streamWorkflowRun(
      workflow.id,
      input || undefined,
      topicId,
      handleEvent,
      (err) => { setError(err); setRunning(false) },
      controller.signal,
    )
  }

  const handleApprove = async (approve: boolean) => {
    if (!pendingApproval) return
    await workflowService.approve('', pendingApproval.nodeId, approve)
    setPendingApproval(null)
  }

  const handleCancel = () => {
    abortRef.current?.abort()
    setRunning(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-white/[0.08]">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">运行工作流 — {workflow.name}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">输入参数</label>
            <textarea
              className="h-20 w-full resize-none rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03]"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入工作流的起始参数（可选）"
              disabled={running}
            />
          </div>

          {/* 节点执行进度 */}
          {nodeStates.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-gray-500">执行进度</div>
              {nodeStates.map((n, i) => (
                <div key={`${n.nodeId}-${i}`} className="flex items-start gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-white/[0.08]">
                  {n.status === 'running' && <Loader size={15} className="mt-0.5 animate-spin text-blue-500" />}
                  {n.status === 'success' && <CheckCircle size={15} className="mt-0.5 text-green-500" />}
                  {n.status === 'failed' && <XCircle size={15} className="mt-0.5 text-red-500" />}
                  <div className="flex-1">
                    <div className="font-medium text-gray-700 dark:text-gray-200">{n.label ?? n.nodeType}</div>
                    {n.output && <div className="mt-0.5 max-h-20 overflow-y-auto rounded bg-gray-50 p-1.5 font-mono text-xs text-gray-600 dark:bg-white/[0.03] dark:text-gray-300">{n.output.slice(0, 500)}{n.output.length > 500 ? '...' : ''}</div>}
                    {n.error && <div className="mt-0.5 text-xs text-red-500">{n.error}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 审批请求 */}
          {pendingApproval && (
            <div className="flex items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 dark:border-orange-500/20 dark:bg-orange-500/10">
              <UserCheck size={18} className="text-orange-500" />
              <div className="flex-1 text-sm text-orange-700 dark:text-orange-400">{pendingApproval.prompt}</div>
              <button onClick={() => handleApprove(true)} className="rounded-lg bg-green-500 px-3 py-1 text-xs text-white hover:bg-green-600">通过</button>
              <button onClick={() => handleApprove(false)} className="rounded-lg bg-red-500 px-3 py-1 text-xs text-white hover:bg-red-600">拒绝</button>
            </div>
          )}

          {/* 最终输出 */}
          {finalOutput !== null && (
            <div>
              <div className="mb-1 text-xs font-medium text-gray-500">最终输出</div>
              <pre className="max-h-48 overflow-y-auto rounded-xl bg-gray-800 p-3 text-xs text-gray-100 dark:bg-black/40">{finalOutput}</pre>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-white/[0.08]">
          {running ? (
            <button onClick={handleCancel} className="rounded-xl px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10">取消运行</button>
          ) : (
            <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]">关闭</button>
          )}
          {!running && finalStatus === null && (
            <button onClick={handleRun} className="flex items-center gap-1.5 rounded-xl bg-green-500 px-4 py-2 text-sm font-medium text-white hover:bg-green-600">
              <Play size={15} /> 运行
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
