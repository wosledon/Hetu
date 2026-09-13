export interface DiffLine {
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
