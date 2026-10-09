/** 推理强度档位（与后端 ReasoningEffort 取值一致） */
export const REASONING_EFFORT_LEVELS = ['low', 'medium', 'high'] as const

export const REASONING_EFFORT_LABELS: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
}

/** 强度档位的中文标签 */
export function reasoningEffortLabel(effort: string): string {
  return REASONING_EFFORT_LABELS[effort] ?? '中'
}
