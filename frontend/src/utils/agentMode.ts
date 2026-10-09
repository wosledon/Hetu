/** Agent 模式：交互式逐步确认 / 自动巡航（Autopilot）自动执行（Code 模式专用） */
export const AGENT_MODES = [
  { value: 'interactive', label: '交互式', description: '每个写操作都按审批模式确认后再执行' },
  { value: 'autopilot', label: '自动巡航', description: '自动执行写操作，不再逐步确认（Autopilot）' },
] as const

export type AgentRunMode = (typeof AGENT_MODES)[number]['value']

export const DEFAULT_AGENT_MODE: AgentRunMode = 'interactive'

export function parseAgentMode(value: string | null | undefined): AgentRunMode {
  const v = value?.trim().toLowerCase()
  return v === 'autopilot' ? 'autopilot' : DEFAULT_AGENT_MODE
}

export function agentModeMeta(mode: string): { label: string; cls: string; hint: string } {
  const found = AGENT_MODES.find((m) => m.value === mode) ?? AGENT_MODES[0]
  return mode === 'autopilot'
    ? { label: found.label, cls: 'text-emerald-500', hint: found.description }
    : { label: found.label, cls: 'text-sky-500', hint: found.description }
}
