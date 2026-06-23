export interface IAgent {
  id: string
  name: string
  description: string
  category: string
  systemPrompt: string
  modelId?: string
  toolNames: string[]
  mcpServerIds: string[]
  skillIds: string[]
  toolApprovals: Record<string, string>
  maxToolCallsPerTurn: number
  maxAgentIterations: number
  isEnabled: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CreateAgentRequest {
  name: string
  description: string
  category: string
  systemPrompt: string
  modelId?: string
  toolNames: string[]
  mcpServerIds: string[]
  skillIds: string[]
  toolApprovals: Record<string, string>
  maxToolCallsPerTurn: number
  maxAgentIterations: number
  isEnabled: boolean
  sortOrder: number
}

export type UpdateAgentRequest = CreateAgentRequest
