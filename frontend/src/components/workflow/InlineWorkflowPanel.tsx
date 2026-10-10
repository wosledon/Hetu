import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReactFlow, Background, Controls, MarkerType, type Node, type Edge, type NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Check, X, Loader2, CircleCheckBig, Circle, UserCheck, HelpCircle, ChevronLeft, ChevronRight, ListChecks } from 'lucide-react'
import WorkflowNodeComponent from './WorkflowNode'
import { toFlowNode, type IWorkflowNodeData } from './workflowNodeModel'
import type { IWorkflow, IWorkflowNode } from '../../types/workflow'
import { renderToolName } from '../../utils/toolRendering'
import QuestionFlow from '../tools/QuestionFlow'
import PlanFlow from '../tools/PlanFlow'
import type { InteractionPlan } from '../../stores/interactionStore'

const nodeTypes: NodeTypes = { workflowNode: WorkflowNodeComponent }

export interface WorkflowNodeState {
  nodeId: string
  label?: string
  nodeType?: string
  status: 'running' | 'success' | 'failed'
  output?: string
}

interface InlineWorkflowPanelProps {
  workflow: IWorkflow
  nodeStates: WorkflowNodeState[]
  pendingApproval: { nodeId: string; prompt: string; runId: string } | null
  workflowToolCall: { nodeId: string; toolCallId: string; name: string; arguments: string } | null
  onApprove: (runId: string, nodeId: string, approve: boolean) => void
  onToolApprove: (approved: boolean, answer?: string) => void
  isStreaming: boolean
  error?: string
}

export default function InlineWorkflowPanel({
  workflow, nodeStates, pendingApproval, workflowToolCall, onApprove, onToolApprove, isStreaming, error,
}: InlineWorkflowPanelProps) {
  const { t } = useTranslation('workflows')
  const [graphCollapsed, setGraphCollapsed] = useState(true)
  const hasInteraction = !!pendingApproval || !!workflowToolCall
  // 有交互面板时默认折叠流程图
  const showGraph = !hasInteraction || !graphCollapsed

  const stateMap = useMemo(() => {
    const map = new Map<string, WorkflowNodeState>()
    for (const s of nodeStates) map.set(s.nodeId, s)
    return map
  }, [nodeStates])

  const flowNodes = useMemo(() => {
    return workflow.nodes.map((n: IWorkflowNode) => {
      const state = stateMap.get(n.id)
      const flowNode = toFlowNode(n)
      return {
        ...flowNode,
        data: {
          ...flowNode.data,
          status: state?.status ?? 'idle',
          output: state?.output,
        } as IWorkflowNodeData,
      } as Node
    })
  }, [workflow.nodes, stateMap])

  const flowEdges = useMemo(() => {
    return workflow.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      markerEnd: { type: MarkerType.ArrowClosed },
      animated: stateMap.get(e.source)?.status === 'running',
      style: stateMap.get(e.source)?.status === 'running' ? { stroke: '#3b82f6', strokeWidth: 2 } : undefined,
    })) as Edge[]
  }, [workflow.edges, stateMap])

  return (
    <div className="rounded-xl border border-blue-200 bg-white dark:border-blue-800 dark:bg-gray-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-blue-100 bg-blue-50/60 px-3 py-2 dark:border-blue-900/40 dark:bg-blue-950/30">
        <CircleCheckBig size={14} className="text-blue-500" />
        <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">{t('inline.title', { name: workflow.name })}</span>
        {hasInteraction && (
          <button
            onClick={() => setGraphCollapsed(v => !v)}
            className="ml-auto flex items-center gap-0.5 text-[10px] text-blue-400 hover:text-blue-600"
          >
            {graphCollapsed ? <ChevronRight size={10} /> : <ChevronLeft size={10} />}
            {graphCollapsed ? t('inline.expandGraph') : t('inline.collapseGraph')}
          </button>
        )}
        {isStreaming && <Loader2 size={12} className="animate-spin text-blue-400 ml-auto" />}
      </div>

      {/* Flow graph - 有交互时默认折叠 */}
      {showGraph && (
        <div style={{ height: hasInteraction ? 120 : 260 }} className="w-full transition-all">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            zoomOnScroll={false}
            panOnScroll
          >
            <Background gap={12} size={1} />
            <Controls showInteractive={false} className="!shadow-none" />
          </ReactFlow>
        </div>
      )}

      {/* Human approval panel */}
      {pendingApproval && (
        <div className="flex items-center gap-2 border-t border-orange-200 bg-orange-50 px-3 py-2.5 dark:border-orange-800 dark:bg-orange-950/30">
          <UserCheck size={14} className="text-orange-500 shrink-0" />
          <span className="text-xs text-orange-700 dark:text-orange-300 flex-1 truncate">{pendingApproval.prompt}</span>
          <button
            onClick={() => onApprove(pendingApproval.runId, pendingApproval.nodeId, true)}
            className="flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
          >
            <Check size={11} /> {t('approval.approve')}
          </button>
          <button
            onClick={() => onApprove(pendingApproval.runId, pendingApproval.nodeId, false)}
            className="flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
          >
            <X size={11} /> {t('approval.reject')}
          </button>
        </div>
      )}

      {/* Agent tool call interaction panel */}
      {workflowToolCall && (() => {
        if (workflowToolCall.name === 'ask_question') {
          return <AskQuestionPanel arguments={workflowToolCall.arguments} onSubmit={(answer) => onToolApprove(true, answer)} />
        }
        if (workflowToolCall.name === 'plan') {
          return <WorkflowPlanPanel arguments={workflowToolCall.arguments} onSubmit={(approved, feedback) => onToolApprove(approved, feedback)} />
        }
        return (
          <div className="flex items-center gap-2 border-t border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-950/30">
            <Circle size={14} className="text-amber-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300">{renderToolName(workflowToolCall.name)}</div>
              {workflowToolCall.arguments !== '{}' && (() => {
                try {
                  const parsed = JSON.parse(workflowToolCall.arguments) as Record<string, unknown>
                  const title = parsed.title ? String(parsed.title) : ''
                  const content = parsed.content ? String(parsed.content) : ''
                  const display = title ? `${title}${content ? `：${content.slice(0, 60)}` : ''}` : content.slice(0, 80)
                  return display ? <div className="text-[11px] text-gray-400 truncate">{display}</div> : null
                } catch {
                  return <div className="text-[11px] text-gray-400 truncate">{workflowToolCall.arguments.slice(0, 120)}</div>
                }
              })()}
            </div>
            <button
              onClick={() => onToolApprove(true)}
              className="flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
            >
              <Check size={11} /> {t('approval.approve')}
            </button>
            <button
              onClick={() => onToolApprove(false)}
              className="flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
            >
              <X size={11} /> {t('approval.reject')}
            </button>
          </div>
        )
      })()}

      {error && (
        <div className="border-t border-red-100 bg-red-50 px-3 py-2 dark:border-red-900/40 dark:bg-red-950/20">
          <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
            <Circle size={11} className="text-red-500" />
            <span>{error}</span>
          </div>
        </div>
      )}
    </div>
  )
}


// AskQuestion 面板：解析 arguments 中的 questions，复用共享 QuestionFlow 作答组件
function AskQuestionPanel({ arguments: argsJson, onSubmit }: {
  arguments: string
  onSubmit: (answer: string) => void
}) {
  const { t } = useTranslation('workflows')
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({})
  const [currentIdx, setCurrentIdx] = useState(0)

  const questions = useMemo(() => {
    try {
      // arguments 可能是字符串化的 JSON，尝试双重解析
      let parsed = JSON.parse(argsJson) as Record<string, unknown>
      if (typeof parsed === 'string') parsed = JSON.parse(parsed) as Record<string, unknown>
      const qs = parsed?.questions as Array<{ header?: string; question?: string; options?: Array<{ label: string; description?: string }> }> | undefined
      return qs ?? []
    } catch { return [] }
  }, [argsJson])

  if (questions.length === 0) {
    return (
      <div className="flex items-center gap-2 border-t border-violet-200 bg-violet-50 px-3 py-2.5 dark:border-violet-800 dark:bg-violet-950/30">
        <HelpCircle size={14} className="text-violet-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-violet-700 dark:text-violet-300">{t('inline.waitingUserInput')}</div>
          <div className="text-[10px] text-gray-400 truncate">{argsJson.slice(0, 200)}</div>
        </div>
        <button onClick={() => onSubmit('')} className="flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"><Check size={11} /> {t('inline.submit')}</button>
      </div>
    )
  }

  const flowQuestions = questions.map((q, i) => ({
    id: String(i),
    toolCallId: '',
    header: q.header || t('inline.questionHeader', { n: i + 1 }),
    question: q.question || '',
    options: q.options,
  }))

  return (
    <div className="overflow-hidden border-t border-blue-200/70 bg-gradient-to-br from-blue-50/80 to-indigo-50/60 dark:border-blue-800/50 dark:from-blue-950/40 dark:to-indigo-950/30">
      <QuestionFlow
        questions={flowQuestions}
        currentIndex={currentIdx}
        answers={selectedAnswers}
        onAnswer={(qid, value) => setSelectedAnswers(prev => ({ ...prev, [qid]: value }))}
        onIndexChange={setCurrentIdx}
        onSubmitAll={() => onSubmit(JSON.stringify(questions.map((q2, i2) => ({ id: i2, question: q2.question, answer: selectedAnswers[String(i2)] ?? '' }))))}
      />
    </div>
  )
}

// 计划工具面板：解析 arguments 中的 title/summary/steps，复用共享 PlanFlow 确认组件
function WorkflowPlanPanel({ arguments: argsJson, onSubmit }: {
  arguments: string
  onSubmit: (approved: boolean, feedback: string) => void
}) {
  const { t } = useTranslation('workflows')
  const [feedback, setFeedback] = useState('')

  const plan = useMemo<InteractionPlan | null>(() => {
    try {
      let parsed = JSON.parse(argsJson) as Record<string, unknown>
      if (typeof parsed === 'string') parsed = JSON.parse(parsed) as Record<string, unknown>
      if (typeof parsed?.title !== 'string') return null
      const steps = Array.isArray(parsed.steps)
        ? (parsed.steps as Array<Record<string, unknown>>)
            .filter(s => s && typeof s.title === 'string')
            .map((s, i) => ({
              id: (typeof s.id === 'string' && s.id) || `p${i + 1}`,
              title: s.title as string,
              description: typeof s.description === 'string' ? s.description : undefined,
              status: 'pending' as const,
            }))
        : []
      return {
        toolCallId: '',
        title: parsed.title,
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        steps,
        feedback: '',
      }
    } catch { return null }
  }, [argsJson])

  if (!plan) {
    return (
      <div className="flex items-center gap-2 border-t border-teal-200 bg-teal-50 px-3 py-2.5 dark:border-teal-800 dark:bg-teal-950/30">
        <ListChecks size={14} className="text-teal-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-teal-700 dark:text-teal-300">{t('inline.waitingPlanConfirm')}</div>
          <div className="text-[10px] text-gray-400 truncate">{argsJson.slice(0, 200)}</div>
        </div>
        <button onClick={() => onSubmit(true, '')} className="flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"><Check size={11} /> {t('approval.approve')}</button>
        <button onClick={() => onSubmit(false, '')} className="flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"><X size={11} /> {t('approval.reject')}</button>
      </div>
    )
  }

  return (
    <div className="overflow-hidden border-t border-teal-200/70 bg-gradient-to-br from-teal-50/80 to-emerald-50/60 dark:border-teal-800/50 dark:from-teal-950/40 dark:to-emerald-950/30">
      <PlanFlow
        plan={{ ...plan, feedback }}
        onFeedback={setFeedback}
        onDecide={(approved) => onSubmit(approved, feedback)}
      />
    </div>
  )
}
