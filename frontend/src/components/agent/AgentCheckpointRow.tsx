import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { History, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '../ui'

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
  const { t } = useTranslation('agent')
  const [restoring, setRestoring] = useState(false)

  return (
    <div className="flex min-h-11 items-center gap-2.5 rounded-xl border border-sky-200/70 bg-sky-50/45 px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-sky-400/15 dark:bg-sky-500/[0.05]">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
        <History size={13} />
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-sky-800 dark:text-sky-200">
        {t('checkpoint.label', { label })}
        {fileCount != null && fileCount > 0 && t('checkpoint.files', { n: fileCount })}
      </span>
      {onRestore && (
        <Button variant="ghost" tone="sky" className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-sky-600 transition-colors hover:bg-sky-100 disabled:opacity-40 dark:text-sky-300 dark:hover:bg-sky-900/40" onClick={async () => {
            setRestoring(true)
            try {
              await onRestore()
            } finally {
              setRestoring(false)
            }
          }}
          disabled={restoring}
          title={t('checkpoint.restoreTitle')}>
          {restoring ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
          {t('checkpoint.restore')}
        </Button>
      )}
    </div>
  )
}
