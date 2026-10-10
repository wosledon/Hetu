import { useCallback, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import i18n from '../i18n'
import { workflowService, streamWorkflowRun } from '../services/workflowService'
import { chatMessageService } from '../services/chatService'
import type { IWorkflow, IWorkflowEvent } from '../types/workflow'
import type { WorkflowNodeState } from '../components/workflow/InlineWorkflowPanel'

interface PendingApproval { nodeId: string; prompt: string; runId: string }
interface WorkflowToolCall { nodeId: string; toolCallId: string; name: string; arguments: string }

/**
 * 工作流运行状态与交互（节点状态 / Human 审批 / Agent 工具交互），对话与会话页共用。
 * topicId 传入时结果写入该话题，Code 会话不传（工作流独立运行）。
 */
export function useWorkflowRun(onOutput?: (text: string) => void) {
  const { data: workflows = [] } = useQuery({ queryKey: ['workflows'], queryFn: workflowService.getAll })
  const [workflow, setWorkflow] = useState<IWorkflow | null>(null)
  const [nodes, setNodes] = useState<WorkflowNodeState[]>([])
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)
  const [toolCall, setToolCall] = useState<WorkflowToolCall | null>(null)
  const [error, setError] = useState('')
  const runIdRef = useRef('')

  const run = useCallback(async (input: string, topicId?: string, toolApprovalMode?: string) => {
    if (!workflow) return
    setNodes([])
    runIdRef.current = ''
    setPendingApproval(null)
    setToolCall(null)
    setError('')

    const controller = new AbortController()
    try {
      await streamWorkflowRun(workflow.id, input, topicId,
        (evt: IWorkflowEvent) => {
          switch (evt.type) {
            case 'run_started':
              if (evt.runId) runIdRef.current = evt.runId
              break
            case 'node_started':
              setNodes((prev) => {
                const existing = prev.find(n => n.nodeId === evt.nodeId)
                if (existing) return prev.map(n => n.nodeId === evt.nodeId ? { ...n, status: 'running' } : n)
                return [...prev, { nodeId: evt.nodeId!, label: evt.label, nodeType: evt.nodeType, status: 'running' }]
              })
              break
            case 'node_completed':
              setNodes((prev) => prev.map((n) => n.nodeId === evt.nodeId ? { ...n, status: 'success', output: evt.output } : n))
              break
            case 'node_failed':
              setNodes((prev) => prev.map((n) => n.nodeId === evt.nodeId ? { ...n, status: 'failed', output: evt.error } : n))
              break
            case 'human_approval_required':
              setPendingApproval({ nodeId: evt.nodeId!, prompt: evt.prompt ?? i18n.t('workflows:run.defaultApprovalPrompt'), runId: evt.runId ?? runIdRef.current })
              break
            case 'agent_tool_call':
              setToolCall({ nodeId: evt.nodeId!, toolCallId: evt.toolCallId!, name: evt.name ?? '', arguments: evt.arguments ?? '{}' })
              break
            case 'run_completed':
              onOutput?.(evt.output ?? i18n.t('workflows:run.completed'))
              break
            case 'run_failed':
              setError(evt.error ?? '')
              onOutput?.(i18n.t('workflows:run.failedWith', { error: evt.error ?? '' }))
              break
            case 'run_result':
              if (evt.result?.error) setError(evt.result.error)
              onOutput?.(evt.result?.output ?? evt.result?.error ?? i18n.t('workflows:run.completed'))
              break
          }
        },
        (err) => onOutput?.(i18n.t('workflows:run.failedWith', { error: err })),
        controller.signal,
        toolApprovalMode)
    } catch {
      onOutput?.(i18n.t('workflows:run.exception'))
    }
  }, [workflow, onOutput])

  /** Human 节点审批 */
  const approve = useCallback(async (runId: string, nodeId: string, approve: boolean) => {
    setPendingApproval(null)
    try {
      await workflowService.approve(runId, nodeId, approve)
    } catch {
      // 忽略：后端会按时超时
    }
  }, [])

  /** 工作流内 Agent 工具交互（复用 chat-messages 的 answer/plan/approve 端点） */
  const submitToolInteraction = useCallback(async (approved: boolean, answer?: string) => {
    if (!toolCall) return
    const sessionId = `workflow-${runIdRef.current}-${toolCall.nodeId}`
    setToolCall(null)
    try {
      if (toolCall.name === 'ask_question') {
        await chatMessageService.submitAnswer(sessionId, toolCall.toolCallId, answer ?? '')
      } else if (toolCall.name === 'plan') {
        await chatMessageService.submitPlanDecision(sessionId, toolCall.toolCallId, approved, answer ?? '')
      } else {
        await chatMessageService.submitApproval(sessionId, toolCall.toolCallId, approved)
      }
    } catch {
      // 忽略：后端会按时超时
    }
  }, [toolCall])

  return {
    workflows,
    workflow,
    setWorkflow,
    nodes,
    pendingApproval,
    toolCall,
    error,
    run,
    approve,
    submitToolInteraction,
  }
}
