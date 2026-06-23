import { NODE_TYPE_META } from './WorkflowNode'

interface NodePaletteProps {
  onAddNode: (type: string) => void
}

/// 左侧节点面板：点击或拖拽添加节点到画布
export default function NodePalette({ onAddNode }: NodePaletteProps) {
  return (
    <div className="flex w-44 flex-col gap-1 border-r border-gray-200 bg-white p-2 dark:border-white/[0.08] dark:bg-gray-900/50">
      <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400">节点类型</div>
      {NODE_TYPE_META.map(({ type, label, icon: Icon }) => (
        <button
          key={type}
          onClick={() => onAddNode(type)}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/workflow-node-type', type)
            e.dataTransfer.effectAllowed = 'move'
          }}
          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-left text-sm text-gray-700 transition-all hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:border-white/[0.08] dark:bg-gray-800 dark:text-gray-200 dark:hover:border-blue-500/40 dark:hover:bg-blue-500/10 dark:hover:text-blue-400"
        >
          <Icon size={15} className="shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      ))}
    </div>
  )
}
