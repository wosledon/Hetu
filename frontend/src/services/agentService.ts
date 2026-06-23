import { get, post, put, del } from './api'
import type { IAgent, CreateAgentRequest, UpdateAgentRequest } from '../types/agent'

export const agentService = {
  getAll: () => get<IAgent[]>('/agents'),
  getById: (id: string) => get<IAgent>(`/agents/${id}`),
  create: (data: CreateAgentRequest) => post<IAgent>('/agents', data),
  update: (id: string, data: UpdateAgentRequest) => put<IAgent>(`/agents/${id}`, data),
  delete: (id: string) => del<void>(`/agents/${id}`),
}
