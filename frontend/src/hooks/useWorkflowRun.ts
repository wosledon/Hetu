import { useCallback, useEffect, useRef, useState } from 'react'
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
 * topicId 传入时结果写入该话题；workSessionId 传入时绑定 Code 项目上下文并写入会话。
 */
export function useWorkflowRun(onOutput?: (text: string) => void, initialWorkflowId?: string, abortOnUnmount = false) {
  const { data: workflows = [] } = useQuery({ queryKey: ['workflows'], queryFn: workflowService.getAll })
  const [workflowId, setWorkflowId] = useState(initialWorkflowId ?? '')
  const workflow = workflows.find(w => w.id === workflowId) ?? null
  const [nodes, setNodes] = useState<WorkflowNodeState[]>([])
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)
  const [toolCall, setToolCall] = useState<WorkflowToolCall | null>(null)
  const [error, setError] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const runIdRef = useRef('')
  const controllerRef = useRef<AbortController | null>(null)

  const setWorkflow = useCallback((next: IWorkflow | null) => setWorkflowId(next?.id ?? ''), [])
  const stop = useCallback(() => controllerRef.current?.abort(), [])

  useEffect(() => () => {
    if (abortOnUnmount) controllerRef.current?.abort()
  }, [abortOnUnmount])

  const run = useCallback(async (input: string, topicId?: string, permissionMode?: string, workSessionId?: string, agentMode?: string, modelId?: string) => {
    if (!workflow || controllerRef.current) return false
    setNodes([])
    runIdRef.current = ''
    setPendingApproval(null)
    setToolCall(null)
    setError('')
    onOutput?.('')

    const controller = new AbortController()
    controllerRef.current = controller
    setIsRunning(true)
    let completed = false
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
            case 'agent_tool_result':
              if (evt.toolCallId) {
                setToolCall((current) => current?.toolCallId === evt.toolCallId ? null : current)
              }
              break
            case 'run_completed':
              completed = true
              onOutput?.(evt.output ?? i18n.t('workflows:run.completed'))
              break
            case 'run_failed':
              setError(evt.error ?? '')
              onOutput?.(i18n.t('workflows:run.failedWith', { error: evt.error ?? '' }))
              break
            case 'run_result':
              completed = evt.result?.status === 'Succeeded'
              if (evt.result?.error) setError(evt.result.error)
              onOutput?.(evt.result?.output ?? evt.result?.error ?? i18n.t('workflows:run.completed'))
              break
          }
        },
        (err) => {
          setError(err)
          onOutput?.(i18n.t('workflows:run.failedWith', { error: err }))
        },
        controller.signal,
        permissionMode,
        workSessionId,
        agentMode,
        modelId)
    } catch {
      if (!controller.signal.aborted) onOutput?.(i18n.t('workflows:run.exception'))
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setIsRunning(false)
      }
    }
    return completed
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
    isRunning,
    stop,
    run,
    approve,
    submitToolInteraction,
  }
}
