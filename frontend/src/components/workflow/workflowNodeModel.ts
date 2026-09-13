import { Play, Bot, GitBranch, Square, Repeat, Split, GitMerge, Wrench, UserCheck, Workflow as WorkflowIcon } from 'lucide-react'
import { WorkflowNodeTypes, type IWorkflowNode } from '../../types/workflow'

export interface IWorkflowNodeData {
  label: string
  type: string
  agentId?: string
  config?: string
  status?: 'idle' | 'running' | 'success' | 'failed'
  [key: string]: unknown
}

export interface IWorkflowNodeMeta {
  type: string
  label: string
  icon: typeof Play
  color: string
  bg: string
  border: string
}

/// 节点类型元数据：画布节点样式与左侧面板的共同来源
export const NODE_TYPE_META: IWorkflowNodeMeta[] = [
  { type: WorkflowNodeTypes.Start, label: '开始', icon: Play, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-500/10', border: 'border-green-300 dark:border-green-500/30' },
  { type: WorkflowNodeTypes.Agent, label: 'Agent', icon: Bot, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-500/10', border: 'border-blue-300 dark:border-blue-500/30' },
  { type: WorkflowNodeTypes.Condition, label: '条件分支', icon: GitBranch, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10', border: 'border-amber-300 dark:border-amber-500/30' },
  { type: WorkflowNodeTypes.Loop, label: '循环', icon: Repeat, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-500/10', border: 'border-purple-300 dark:border-purple-500/30' },
  { type: WorkflowNodeTypes.Parallel, label: '并行', icon: Split, color: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-50 dark:bg-cyan-500/10', border: 'border-cyan-300 dark:border-cyan-500/30' },
  { type: WorkflowNodeTypes.Merge, label: '合并', icon: GitMerge, color: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-50 dark:bg-teal-500/10', border: 'border-teal-300 dark:border-teal-500/30' },
  { type: WorkflowNodeTypes.Tool, label: '工具', icon: Wrench, color: 'text-gray-600 dark:text-gray-300', bg: 'bg-gray-50 dark:bg-gray-500/10', border: 'border-gray-300 dark:border-gray-500/30' },
  { type: WorkflowNodeTypes.Human, label: '人工审批', icon: UserCheck, color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-500/10', border: 'border-orange-300 dark:border-orange-500/30' },
  { type: WorkflowNodeTypes.SubWorkflow, label: '子工作流', icon: WorkflowIcon, color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-500/10', border: 'border-indigo-300 dark:border-indigo-500/30' },
  { type: WorkflowNodeTypes.End, label: '结束', icon: Square, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-500/10', border: 'border-red-300 dark:border-red-500/30' },
]

export const NODE_META_BY_TYPE: Record<string, IWorkflowNodeMeta> = Object.fromEntries(NODE_TYPE_META.map((m) => [m.type, m]))

/// 将后端 IWorkflowNode 转为 ReactFlow Node
export function toFlowNode(n: IWorkflowNode) {
  return {
    id: n.id,
    type: 'workflowNode',
    position: { x: n.x, y: n.y },
    data: {
      label: n.label,
      type: n.type,
      agentId: n.agentId,
      config: n.config,
    } as IWorkflowNodeData,
  }
}

/// 将 ReactFlow Node 转回后端 IWorkflowNode
export function fromFlowNode(n: { id: string; position: { x: number; y: number }; data: IWorkflowNodeData }): IWorkflowNode {
  return {
    id: n.id,
    type: n.data.type as IWorkflowNode['type'],
    label: n.data.label,
    agentId: n.data.agentId,
    config: n.data.config,
    x: n.position.x,
    y: n.position.y,
  }
}
