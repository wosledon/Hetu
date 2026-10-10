import i18n from '../i18n'

/** 内置兜底档位：模型未声明可选档位时使用 */
export const REASONING_EFFORT_LEVELS = ['low', 'medium', 'high'] as const

/** 常见推理强度档位对应的文案键（models.dev reasoning_options: effort 覆盖这些取值） */
const EFFORT_KEYS: Record<string, string> = {
  off: 'reasoning.levels.off',
  none: 'reasoning.levels.off',
  minimal: 'reasoning.levels.minimal',
  low: 'reasoning.levels.low',
  medium: 'reasoning.levels.medium',
  high: 'reasoning.levels.high',
  xhigh: 'reasoning.levels.xhigh',
  max: 'reasoning.levels.max',
}

/** 强度档位的文案；数字档位按 token 预算展示，其余原样 */
export function reasoningEffortLabel(effort: string): string {
  const key = EFFORT_KEYS[effort]
  if (key) return i18n.t(`agent:${key}`)
  return /^\d+$/.test(effort) ? i18n.t('agent:reasoning.tokenBudget', { n: effort }) : effort
}

/** 解析模型上保存的档位列表（逗号/分号/空格分隔） */
export function parseEffortValues(raw?: string | null): string[] {
  if (!raw) return []
  return [...new Set(
    raw
      .split(/[,;，；|\s]+/)
      .map((v) => v.trim().toLowerCase())
      .filter((v) => v.length > 0),
  )]
}

/**
 * 当前模型可用的推理强度档位：
 * 优先用模型配置（models.dev 导入的 reasoning_options.effort），缺失时回落到内置三档。
 */
export function reasoningEffortOptions(model?: { reasoningEfforts?: string | null } | null): string[] {
  const values = parseEffortValues(model?.reasoningEfforts)
  return values.length > 0 ? values : [...REASONING_EFFORT_LEVELS]
}

/**
 * 当前模型的默认强度：模型配置值在候选内则用它，否则取候选中位（与模型配置页的推导一致）。
 */
export function reasoningEffortDefault(model?: {
  reasoningEffort?: string | null
  reasoningEfforts?: string | null
} | null): string {
  const options = reasoningEffortOptions(model)
  const configured = (model?.reasoningEffort ?? '').trim().toLowerCase()
  if (configured && options.includes(configured)) return configured
  if (options.includes('medium')) return 'medium'
  return options[Math.floor(options.length / 2)]
}
