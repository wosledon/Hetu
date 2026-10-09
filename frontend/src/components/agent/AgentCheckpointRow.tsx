import { useState } from 'react'
import { History, Loader2, RotateCcw } from 'lucide-react'

export interface AgentCheckpointRowProps {
  label: string
  fileCount?: number
  /** 提供时才显示「回滚到此」按钮（编码会话独有能力） */
  onRestore?: () => void | Promise<void>
}

/**
 * 检查点行。对话页与任务看板只读展示，编码会话额外提供回滚。
 */
export default function AgentCheckpointRow({ label, fileCount, onRestore }: AgentCheckpointRowProps) {
  const [restoring, setRestoring] = useState(false)

  return (
    <div className="flex items-center gap-2 rounded-lg border border-sky-100 bg-sky-50/60 px-2.5 py-1.5 dark:border-sky-900/40 dark:bg-sky-950/20">
      <History size={12} className="shrink-0 text-sky-500" />
      <span className="min-w-0 flex-1 truncate text-[11px] text-sky-800 dark:text-sky-300">
        检查点 · {label}
        {fileCount != null && fileCount > 0 && `（${fileCount} 个文件）`}
      </span>
      {onRestore && (
        <button
          onClick={async () => {
            setRestoring(true)
            try {
              await onRestore()
            } finally {
              setRestoring(false)
            }
          }}
          disabled={restoring}
          title="回滚到此检查点"
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-sky-600 transition-colors hover:bg-sky-100 disabled:opacity-40 dark:text-sky-300 dark:hover:bg-sky-900/40"
        >
          {restoring ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
          回滚到此
        </button>
      )}
    </div>
  )
}
