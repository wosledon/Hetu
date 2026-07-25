import { useMemo } from 'react'
import { ReactFlow, Background, Controls, MarkerType, type Node, type Edge, type NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Check, X, Loader2, CircleCheckBig, Circle, UserCheck } from 'lucide-react'
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
  workflowToolCall: { toolCallId: string; name: string; arguments: string } | null
  onApprove: (runId: string, nodeId: string, approve: boolean) => void
  onToolApprove: (approved: boolean) => void
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
        const isAskQuestion = workflowToolCall.name === 'ask_question'
        return (
          <div className={`flex items-center gap-2 border-t px-3 py-2.5 ${
            isAskQuestion
              ? 'border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/30'
              : 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
          }`}>
            <Circle size={14} className={isAskQuestion ? 'text-violet-500 shrink-0' : 'text-amber-500 shrink-0'} />
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
              <Check size={11} /> {isAskQuestion ? '提交' : '通过'}
            </button>
            <button
              onClick={() => onToolApprove(false)}
              className="flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
            >
              <X size={11} /> {isAskQuestion ? '跳过' : '拒绝'}
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
