import { useTranslation } from 'react-i18next'
import { FilePlus2, FileX2, FilePen } from 'lucide-react'

const FILE_ACTION_META: Record<string, { labelKey: string; cls: string; Icon: typeof FilePen }> = {
  create: { labelKey: 'fileChange.create', cls: 'text-emerald-600 dark:text-emerald-400', Icon: FilePlus2 },
  delete: { labelKey: 'fileChange.delete', cls: 'text-rose-600 dark:text-rose-400', Icon: FileX2 },
  write: { labelKey: 'fileChange.write', cls: 'text-amber-600 dark:text-amber-400', Icon: FilePen },
}

export interface AgentFileChangeRowProps {
  path: string
  action: string
  onOpenPath?: (path: string) => void
}

/**
 * 文件变更行。对话页（工作流写入）、编码会话、任务看板详情共用。
 */
export default function AgentFileChangeRow({ path, action, onOpenPath }: AgentFileChangeRowProps) {
  const { t } = useTranslation('agent')
  const meta = FILE_ACTION_META[action] ?? FILE_ACTION_META.write
  const { Icon } = meta

  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-1.5 dark:border-gray-800 dark:bg-gray-800/40">
      <Icon size={12} className={`shrink-0 ${meta.cls}`} />
      <span className={`shrink-0 text-[10px] font-medium ${meta.cls}`}>{t(meta.labelKey)}</span>
      {onOpenPath ? (
        <button
          onClick={() => onOpenPath(path)}
          title={t('fileChange.openInEditor')}
          className="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-gray-400 underline-offset-2 hover:text-blue-500 hover:underline"
        >
          {path}
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-gray-400">{path}</span>
      )}
    </div>
  )
}
