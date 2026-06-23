import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Play, Bot, GitBranch, Square, Repeat, Split, Wrench, UserCheck, Workflow as WorkflowIcon } from 'lucide-react'
import { WorkflowNodeTypes, type IWorkflowNode } from '../../types/workflow'

export interface IWorkflowNodeData {
  label: string
  type: string
  agentId?: string
  config?: string
  status?: 'idle' | 'running' | 'success' | 'failed'
  [key: string]: unknown
}

const NODE_STYLES: Record<string, { icon: typeof Play; color: string; bg: string; border: string }> = {
  [WorkflowNodeTypes.Start]: { icon: Play, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-500/10', border: 'border-green-300 dark:border-green-500/30' },
  [WorkflowNodeTypes.Agent]: { icon: Bot, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-500/10', border: 'border-blue-300 dark:border-blue-500/30' },
  [WorkflowNodeTypes.Condition]: { icon: GitBranch, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10', border: 'border-amber-300 dark:border-amber-500/30' },
  [WorkflowNodeTypes.End]: { icon: Square, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-500/10', border: 'border-red-300 dark:border-red-500/30' },
  [WorkflowNodeTypes.Loop]: { icon: Repeat, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-500/10', border: 'border-purple-300 dark:border-purple-500/30' },
  [WorkflowNodeTypes.Parallel]: { icon: Split, color: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-50 dark:bg-cyan-500/10', border: 'border-cyan-300 dark:border-cyan-500/30' },
  [WorkflowNodeTypes.Tool]: { icon: Wrench, color: 'text-gray-600 dark:text-gray-300', bg: 'bg-gray-50 dark:bg-gray-500/10', border: 'border-gray-300 dark:border-gray-500/30' },
  [WorkflowNodeTypes.Human]: { icon: UserCheck, color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-500/10', border: 'border-orange-300 dark:border-orange-500/30' },
  [WorkflowNodeTypes.SubWorkflow]: { icon: WorkflowIcon, color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-500/10', border: 'border-indigo-300 dark:border-indigo-500/30' },
}

const STATUS_RING: Record<string, string> = {
  running: 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-gray-900 animate-pulse',
  success: 'ring-2 ring-green-500 ring-offset-2 dark:ring-offset-gray-900',
  failed: 'ring-2 ring-red-500 ring-offset-2 dark:ring-offset-gray-900',
}

function WorkflowNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as IWorkflowNodeData
  const style = NODE_STYLES[nodeData.type] ?? NODE_STYLES[WorkflowNodeTypes.Agent]
  const Icon = style.icon
  const status = nodeData.status ?? 'idle'
  const isStart = nodeData.type === WorkflowNodeTypes.Start
  const isEnd = nodeData.type === WorkflowNodeTypes.End
  const isCondition = nodeData.type === WorkflowNodeTypes.Condition
  const isParallel = nodeData.type === WorkflowNodeTypes.Parallel
  const isLoop = nodeData.type === WorkflowNodeTypes.Loop

  return (
    <div
      className={`relative flex min-w-[160px] max-w-[240px] flex-col gap-1 rounded-xl border-2 bg-white px-3 py-2.5 shadow-sm transition-all dark:bg-gray-800 ${style.border} ${selected ? 'ring-2 ring-blue-500/50' : ''} ${STATUS_RING[status] ?? ''}`}
    >
      {/* 入口连接点（Start 无入口） */}
      {!isStart && <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-gray-300 !bg-white dark:!border-gray-500 dark:!bg-gray-700" />}

      <div className="flex items-center gap-2">
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${style.bg}`}>
          <Icon size={16} className={style.color} />
        </div>
        <span className="flex-1 truncate text-sm font-medium text-gray-800 dark:text-gray-100">
          {nodeData.label || nodeData.type}
        </span>
      </div>

      {/* Condition/Loop/Parallel 显示分支 handle */}
      {isCondition && (
        <div className="flex justify-end gap-3 pt-1 text-[10px] text-gray-400">
          <span>真</span>
          <span>假</span>
        </div>
      )}
      {isLoop && (
        <div className="flex justify-end gap-3 pt-1 text-[10px] text-gray-400">
          <span>循环体</span>
          <span>退出</span>
        </div>
      )}
      {isParallel && (
        <div className="pt-1 text-[10px] text-gray-400">并行分支 ↓</div>
      )}

      {/* 出口连接点（End 无出口） */}
      {!isEnd && (
        <>
          {isCondition ? (
            <>
              <Handle type="source" position={Position.Right} id="true" className="!top-[60%] !h-3 !w-3 !border-2 !border-green-400 !bg-green-300" />
              <Handle type="source" position={Position.Right} id="false" className="!top-[80%] !h-3 !w-3 !border-2 !border-red-400 !bg-red-300" />
            </>
          ) : isLoop ? (
            <>
              <Handle type="source" position={Position.Right} id="body" className="!top-[60%] !h-3 !w-3 !border-2 !border-purple-400 !bg-purple-300" />
              <Handle type="source" position={Position.Right} id="exit" className="!top-[80%] !h-3 !w-3 !border-2 !border-gray-400 !bg-gray-300" />
            </>
          ) : (
            <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-gray-300 !bg-white dark:!border-gray-500 dark:!bg-gray-700" />
          )}
        </>
      )}
    </div>
  )
}

export default memo(WorkflowNodeComponent)

/// 节点类型元数据（供 NodePalette 使用）
export const NODE_TYPE_META: { type: string; label: string; icon: typeof Play }[] = [
  { type: WorkflowNodeTypes.Start, label: '开始', icon: Play },
  { type: WorkflowNodeTypes.Agent, label: 'Agent', icon: Bot },
  { type: WorkflowNodeTypes.Condition, label: '条件分支', icon: GitBranch },
  { type: WorkflowNodeTypes.Loop, label: '循环', icon: Repeat },
  { type: WorkflowNodeTypes.Parallel, label: '并行', icon: Split },
  { type: WorkflowNodeTypes.Tool, label: '工具', icon: Wrench },
  { type: WorkflowNodeTypes.Human, label: '人工审批', icon: UserCheck },
  { type: WorkflowNodeTypes.SubWorkflow, label: '子工作流', icon: WorkflowIcon },
  { type: WorkflowNodeTypes.End, label: '结束', icon: Square },
]

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
    type: n.data.type as WorkflowNodeType,
    label: n.data.label,
    agentId: n.data.agentId,
    config: n.data.config,
    x: n.position.x,
    y: n.position.y,
  }
}

type WorkflowNodeType = IWorkflowNode['type']
