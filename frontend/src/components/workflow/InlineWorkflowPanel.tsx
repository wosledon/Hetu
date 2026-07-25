import { useMemo, useState } from 'react'
import { ReactFlow, Background, Controls, MarkerType, type Node, type Edge, type NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Check, X, Loader2, CircleCheckBig, Circle, UserCheck, HelpCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import WorkflowNodeComponent, { toFlowNode } from './WorkflowNode'
import type { IWorkflow, IWorkflowNode } from '../../types/workflow'
import type { IWorkflowNodeData } from './WorkflowNode'

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
        <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">工作流：{workflow.name}</span>
        {isStreaming && <Loader2 size={12} className="animate-spin text-blue-400 ml-auto" />}
      </div>

      {/* Flow graph */}
      <div style={{ height: 260 }} className="w-full">
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

      {/* Human approval panel */}
      {pendingApproval && (
        <div className="flex items-center gap-2 border-t border-orange-200 bg-orange-50 px-3 py-2.5 dark:border-orange-800 dark:bg-orange-950/30">
          <UserCheck size={14} className="text-orange-500 shrink-0" />
          <span className="text-xs text-orange-700 dark:text-orange-300 flex-1 truncate">{pendingApproval.prompt}</span>
          <button
            onClick={() => onApprove(pendingApproval.runId, pendingApproval.nodeId, true)}
            className="flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
          >
            <Check size={11} /> 通过
          </button>
          <button
            onClick={() => onApprove(pendingApproval.runId, pendingApproval.nodeId, false)}
            className="flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
          >
            <X size={11} /> 拒绝
          </button>
        </div>
      )}

      {/* Agent tool call interaction panel */}
      {workflowToolCall && (() => {
        if (workflowToolCall.name === 'ask_question') {
          return <AskQuestionPanel arguments={workflowToolCall.arguments} onSubmit={(answer) => onToolApprove(true, answer)} onSkip={() => onToolApprove(false)} />
        }
        return (
          <div className="flex items-center gap-2 border-t border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-950/30">
            <Circle size={14} className="text-amber-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300">{workflowToolCall.name}</div>
              {workflowToolCall.arguments !== '{}' && (
                <div className="text-[11px] text-gray-400 truncate">{workflowToolCall.arguments.slice(0, 120)}</div>
              )}
            </div>
            <button
              onClick={() => onToolApprove(true)}
              className="flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"
            >
              <Check size={11} /> 通过
            </button>
            <button
              onClick={() => onToolApprove(false)}
              className="flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
            >
              <X size={11} /> 拒绝
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

// AskQuestion 面板：解析 arguments 中的 questions，渲染选项按钮
function AskQuestionPanel({ arguments: argsJson, onSubmit, onSkip }: {
  arguments: string
  onSubmit: (answer: string) => void
  onSkip: () => void
}) {
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({})
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
          <div className="text-xs text-violet-700 dark:text-violet-300">等待用户输入...</div>
          <div className="text-[10px] text-gray-400 truncate">{argsJson.slice(0, 200)}</div>
        </div>
        <button onClick={() => onSubmit('')} className="flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700"><Check size={11} /> 提交</button>
        <button onClick={onSkip} className="flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"><X size={11} /> 跳过</button>
      </div>
    )
  }

  return (
    <div className="overflow-hidden border-t border-blue-200/70 bg-gradient-to-br from-blue-50/80 to-indigo-50/60 dark:border-blue-800/50 dark:from-blue-950/40 dark:to-indigo-950/30">
      {(() => {
        const qi = Math.min(currentIdx, questions.length - 1)
        const q = questions[qi]
        if (!q) return null
        const selected = selectedAnswers[qi]
        const hasAnswer = !!selected
        const isLast = qi === questions.length - 1
        const isFirst = qi === 0
        const allAnswered = questions.every((_, i) => selectedAnswers[i])

        return (
          <div key={qi}>
            {/* Header */}
            <div className="flex items-center gap-2 border-b border-blue-100/80 bg-white/40 px-4 py-2.5 dark:border-blue-900/30 dark:bg-gray-900/20">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400">
                <HelpCircle size={14} />
              </div>
              <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                {q.header || `问题 ${qi + 1}`}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <div className="flex items-center gap-1">
                  {questions.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setCurrentIdx(i)}
                      className={`h-1.5 rounded-full transition-all ${
                        i === qi
                          ? 'w-5 bg-blue-500'
                          : selectedAnswers[i]
                            ? 'w-1.5 bg-blue-400 hover:w-3'
                            : 'w-1.5 bg-gray-300 hover:w-3 dark:bg-gray-600'
                      }`}
                    />
                  ))}
                </div>
                <span className="ml-1 text-[10px] text-gray-500 tabular-nums dark:text-gray-400">
                  {Object.keys(selectedAnswers).length} / {questions.length}
                </span>
              </div>
            </div>

            {/* Body */}
            <div className="px-4 py-3">
              <p className="mb-3 text-sm leading-relaxed text-gray-800 dark:text-gray-200">
                {q.question}
              </p>

              {/* Options */}
              {q.options && q.options.length > 0 && (() => {
                const maxLabelLen = Math.max(...q.options.map(o => (o.label || '').length))
                const hasDescription = q.options.some(o => o.description)
                const useListLayout = maxLabelLen > 8 || q.options.length > 4 || hasDescription
                if (useListLayout) {
                  return (
                    <div className="mb-3 flex flex-col gap-1.5">
                      {q.options.map((opt, oi) => (
                        <button
                          key={oi}
                          onClick={() => {
                            setSelectedAnswers(prev => ({ ...prev, [qi]: opt.label }))
                            if (!isLast) setTimeout(() => setCurrentIdx(i => Math.min(questions.length - 1, i + 1)), 150)
                          }}
                          className={`group flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-xs transition-all ${
                            selected === opt.label
                              ? 'border-blue-500 bg-blue-50 shadow-sm dark:bg-blue-950/40'
                              : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/50 dark:border-gray-700 dark:bg-gray-800/60 dark:hover:border-blue-700 dark:hover:bg-blue-900/20'
                          }`}
                        >
                          <span className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                            selected === opt.label
                              ? 'border-blue-500 bg-blue-500'
                              : 'border-gray-300 group-hover:border-blue-400 dark:border-gray-600'
                          }`}>
                            {selected === opt.label && <Check size={10} className="text-white" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className={`font-medium leading-relaxed ${
                              selected === opt.label ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200'
                            }`}>
                              {opt.label}
                            </div>
                            {opt.description && (
                              <div className="mt-0.5 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                                {opt.description}
                              </div>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )
                }
                return (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {q.options.map((opt, oi) => (
                      <button
                        key={oi}
                        onClick={() => {
                          setSelectedAnswers(prev => ({ ...prev, [qi]: opt.label }))
                          if (!isLast) setTimeout(() => setCurrentIdx(i => Math.min(questions.length - 1, i + 1)), 150)
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                          selected === opt.label
                            ? 'border-blue-500 bg-blue-500 text-white shadow-sm'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300 dark:hover:border-blue-700 dark:hover:bg-blue-900/30'
                        }`}
                      >
                        {selected === opt.label && <Check size={12} />}
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                )
              })()}

              {/* Custom input */}
              <input
                type="text"
                placeholder={hasAnswer && q.options?.some(o => o.label === selected) ? '或输入自定义回答（回车下一题）' : '输入回答...（回车下一题）'}
                value={q.options?.some(o => o.label === selected) ? '' : (selected || '')}
                onChange={(e) => setSelectedAnswers(prev => ({ ...prev, [qi]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && selected) {
                    e.preventDefault()
                    if (isLast && allAnswered) {
                      onSubmit(JSON.stringify(questions.map((q2, i2) => ({ id: i2, question: q2.question, answer: selectedAnswers[i2] ?? '' }))))
                    } else if (!isLast) {
                      setCurrentIdx(i => Math.min(questions.length - 1, i + 1))
                    }
                  }
                }}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none transition-colors placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200/50 dark:border-gray-700 dark:bg-gray-800/60 dark:placeholder:text-gray-500 dark:focus:ring-blue-900/40"
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-blue-100/80 bg-white/40 px-3 py-2 dark:border-blue-900/30 dark:bg-gray-900/20">
              <button
                onClick={() => setCurrentIdx(i => Math.max(0, i - 1))}
                disabled={isFirst}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  isFirst
                    ? 'cursor-not-allowed text-gray-300 dark:text-gray-600'
                    : 'text-gray-600 hover:bg-blue-100/50 dark:text-gray-300 dark:hover:bg-blue-900/30'
                }`}
              >
                <ChevronLeft size={14} /> 上一题
              </button>
              <span className="text-[10px] text-gray-400">
                {qi + 1} / {questions.length}
              </span>
              {!isLast ? (
                <button
                  onClick={() => setCurrentIdx(i => Math.min(questions.length - 1, i + 1))}
                  disabled={!hasAnswer}
                  className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    hasAnswer
                      ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-sm'
                      : 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
                  }`}
                >
                  下一题 <ChevronRight size={14} />
                </button>
              ) : (
                <button
                  onClick={() => onSubmit(JSON.stringify(questions.map((q2, i2) => ({ id: i2, question: q2.question, answer: selectedAnswers[i2] ?? '' }))))}
                  disabled={!allAnswered}
                  className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    allAnswered
                      ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-sm'
                      : 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
                  }`}
                >
                  <Check size={14} /> 提交全部
                </button>
              )}
              <button
                onClick={onSkip}
                className="flex items-center gap-1 rounded-md bg-gray-400 px-2 py-1 text-xs text-white hover:bg-gray-500"
              >
                <X size={11} /> 跳过
              </button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
