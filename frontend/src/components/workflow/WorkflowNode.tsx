import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { WorkflowNodeTypes } from '../../types/workflow'
import { NODE_META_BY_TYPE, type IWorkflowNodeData } from './workflowNodeModel'

const STATUS_RING: Record<string, string> = {
  running: 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-gray-900 animate-pulse',
  success: 'ring-2 ring-green-500 ring-offset-2 dark:ring-offset-gray-900',
  failed: 'ring-2 ring-red-500 ring-offset-2 dark:ring-offset-gray-900',
}

function WorkflowNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as IWorkflowNodeData
  const meta = NODE_META_BY_TYPE[nodeData.type] ?? NODE_META_BY_TYPE[WorkflowNodeTypes.Agent]
  const Icon = meta.icon
  const status = nodeData.status ?? 'idle'
  const isStart = nodeData.type === WorkflowNodeTypes.Start
  const isEnd = nodeData.type === WorkflowNodeTypes.End
  const isCondition = nodeData.type === WorkflowNodeTypes.Condition
  const isParallel = nodeData.type === WorkflowNodeTypes.Parallel
  const isLoop = nodeData.type === WorkflowNodeTypes.Loop
  const isMerge = nodeData.type === WorkflowNodeTypes.Merge

  return (
    <div
      className={`relative flex min-w-[160px] max-w-[240px] flex-col gap-1 rounded-xl border-2 bg-white px-3 py-2.5 shadow-sm transition-all dark:bg-gray-800 ${meta.border} ${selected ? 'ring-2 ring-blue-500/50' : ''} ${STATUS_RING[status] ?? ''}`}
    >
      {/* 入口连接点（Start 无入口） */}
      {!isStart && <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-gray-300 !bg-white dark:!border-gray-500 dark:!bg-gray-700" />}

      <div className="flex items-center gap-2">
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${meta.bg}`}>
          <Icon size={16} className={meta.color} />
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
      {isMerge && (
        <div className="pt-1 text-[10px] text-gray-400">合并分支 ↑</div>
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
