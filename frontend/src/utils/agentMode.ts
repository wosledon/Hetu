import i18n from '../i18n'

/** Agent 模式：交互式逐步确认 / 托管执行（Autopilot）自动执行（Code 模式专用） */
export const AGENT_MODES = [
  { value: 'interactive', labelKey: 'mode.interactive.label', descriptionKey: 'mode.interactive.description' },
  { value: 'autopilot', labelKey: 'mode.autopilot.label', descriptionKey: 'mode.autopilot.description' },
] as const

export type AgentRunMode = (typeof AGENT_MODES)[number]['value']

export const DEFAULT_AGENT_MODE: AgentRunMode = 'interactive'

export function parseAgentMode(value: string | null | undefined): AgentRunMode {
  const v = value?.trim().toLowerCase()
  return v === 'autopilot' ? 'autopilot' : DEFAULT_AGENT_MODE
}

export function agentModeMeta(mode: string): { label: string; cls: string; hint: string } {
  const found = AGENT_MODES.find((m) => m.value === mode) ?? AGENT_MODES[0]
  return {
    label: i18n.t(`agent:${found.labelKey}`),
    cls: mode === 'autopilot' ? 'text-emerald-500' : 'text-sky-500',
    hint: i18n.t(`agent:${found.descriptionKey}`),
  }
}
