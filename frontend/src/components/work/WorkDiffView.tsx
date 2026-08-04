import { useMemo } from 'react'
import type { IWorkFileChange } from '../../types/work'

interface DiffLine {
  type: 'same' | 'del' | 'add'
  text: string
  oldLine?: number
  newLine?: number
}

/** 简单 LCS 行级 diff */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = (oldText ?? '').split('\n')
  const b = (newText ?? '').split('\n')
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'same', text: a[i], oldLine: i + 1, newLine: j + 1 })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: a[i], oldLine: i + 1 })
      i++
    } else {
      ops.push({ type: 'add', text: b[j], newLine: j + 1 })
      j++
    }
  }
  while (i < n) { ops.push({ type: 'del', text: a[i], oldLine: i + 1 }); i++ }
  while (j < m) { ops.push({ type: 'add', text: b[j], newLine: j + 1 }); j++ }
  return ops
}

interface WorkDiffViewProps {
  change: IWorkFileChange
}

export default function WorkDiffView({ change }: WorkDiffViewProps) {
  const lines = useMemo(() => lineDiff(change.oldContent ?? '', change.newContent), [change])
  const isCreate = change.action === 'create'

  const stats = useMemo(() => {
    let added = 0
    let removed = 0
    for (const l of lines) {
      if (l.type === 'add') added++
      else if (l.type === 'del') removed++
    }
    return { added, removed }
  }, [lines])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-3 py-1.5 dark:border-gray-800">
        {isCreate && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">新增文件</span>}
        <span className="text-[11px] text-emerald-600 dark:text-emerald-400">+{stats.added}</span>
        <span className="text-[11px] text-red-500 dark:text-red-400">-{stats.removed}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse font-mono text-[11px] leading-relaxed">
          <tbody>
            {lines.map((line, idx) => {
              const rowClass =
                line.type === 'add'
                  ? 'bg-emerald-50/80 dark:bg-emerald-950/30'
                  : line.type === 'del'
                    ? 'bg-red-50/80 dark:bg-red-950/30'
                    : ''
              const textClass = line.type === 'add'
                ? 'text-emerald-800 dark:text-emerald-300'
                : line.type === 'del'
                  ? 'text-red-700 dark:text-red-300'
                  : 'text-gray-700 dark:text-gray-300'
              return (
                <tr key={idx} className={rowClass}>
                  <td className="w-10 select-none border-r border-gray-100 px-2 text-right text-[10px] text-gray-400 dark:border-gray-800">
                    {line.oldLine ?? ''}
                  </td>
                  <td className="w-10 select-none border-r border-gray-100 px-2 text-right text-[10px] text-gray-400 dark:border-gray-800">
                    {line.newLine ?? ''}
                  </td>
                  <td className="w-5 select-none px-1 text-center text-[11px] font-bold">
                    {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}
                  </td>
                  <td className={`whitespace-pre px-2 ${textClass}`}>{line.text || ' '}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
