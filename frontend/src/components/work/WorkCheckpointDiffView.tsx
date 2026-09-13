import { useState } from 'react'
import { FilePlus, FileX, PenLine, FileCode } from 'lucide-react'
import type { IWorkCheckpointDiff, IWorkFileChange } from '../../types/work'
import WorkDiffView from './WorkDiffView'

interface WorkCheckpointDiffViewProps {
  diff: IWorkCheckpointDiff
}

const ACTION_META: Record<string, { label: string; icon: React.ReactNode; text: string }> = {
  create: { label: '新增', icon: <FilePlus size={12} className="text-emerald-500" />, text: 'text-emerald-600 dark:text-emerald-400' },
  delete: { label: '删除', icon: <FileX size={12} className="text-rose-500" />, text: 'text-rose-600 dark:text-rose-400' },
  write: { label: '改动', icon: <PenLine size={12} className="text-amber-500" />, text: 'text-amber-600 dark:text-amber-400' },
  unchanged: { label: '未变', icon: <FileCode size={12} className="text-gray-400" />, text: 'text-gray-400' },
}

/** 检查点快照与当前工作区的差异：左侧文件列表 + 右侧逐行 diff。 */
export default function WorkCheckpointDiffView({ diff }: WorkCheckpointDiffViewProps) {
  const changed = diff.files.filter((f) => f.action !== 'unchanged')
  const firstIndex = diff.files.findIndex((f) => f.action !== 'unchanged')
  const [selected, setSelected] = useState(firstIndex >= 0 ? firstIndex : 0)
  const file = diff.files[selected]

  const asChange: IWorkFileChange | undefined = file
    ? {
        id: `${diff.checkpointId}:${file.path}`,
        projectId: '',
        filePath: file.path,
        action: file.action === 'delete' ? 'delete' : file.action === 'create' ? 'create' : 'write',
        oldContent: file.oldContent,
        newContent: file.newContent ?? '',
        createdAt: '',
      }
    : undefined

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-56 shrink-0 flex-col border-r border-gray-100 dark:border-gray-800">
        <div className="shrink-0 border-b border-gray-100 px-2 py-1.5 text-[11px] text-gray-500 dark:border-gray-800">
          <div className="truncate font-medium text-gray-700 dark:text-gray-200">{diff.label}</div>
          <div className="text-[10px] text-gray-400">{changed.length} 个文件与快照不同</div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {diff.files.length === 0 && <div className="px-2 py-6 text-center text-[11px] text-gray-400">快照为空</div>}
          {diff.files.map((f, i) => {
            const meta = ACTION_META[f.action] ?? ACTION_META.write
            return (
              <button
                key={f.path}
                onClick={() => setSelected(i)}
                className={`mb-0.5 flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left transition-colors ${i === selected ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-gray-100 dark:hover:bg-white/[0.04]'}`}
              >
                {meta.icon}
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-700 dark:text-gray-200">{f.path}</span>
                <span className={`shrink-0 text-[10px] ${meta.text}`}>{meta.label}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        {asChange ? <WorkDiffView change={asChange} /> : <div className="flex h-full items-center justify-center text-xs text-gray-400">无文件可比较</div>}
      </div>
    </div>
  )
}
