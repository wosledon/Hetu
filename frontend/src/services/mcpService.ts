import { get, post, put, del } from './api';
import type { IMcpServer, IMcpTool } from '../types';

export interface CreateMcpServerRequest {
  name: string;
  description: string;
  type: 'stdio' | 'sse';
  connectionConfig: string;
}

export interface UpdateMcpServerRequest extends CreateMcpServerRequest {
  isEnabled: boolean;
  sortOrder: number;
}

export interface CallMcpToolRequest {
  toolName: string;
  arguments?: Record<string, unknown>;
}

export interface CallMcpToolResult {
  content: string;
  isError: boolean;
}

export const mcpService = {
  getAll: () => get<IMcpServer[]>('/mcp-servers'),
  getById: (id: string) => get<IMcpServer>(`/mcp-servers/${id}`),
  create: (data: CreateMcpServerRequest) => post<IMcpServer>('/mcp-servers', data),
  update: (id: string, data: UpdateMcpServerRequest) => put<IMcpServer>(`/mcp-servers/${id}`, data),
  delete: (id: string) => del<void>(`/mcp-servers/${id}`),
  listTools: (id: string) => get<IMcpTool[]>(`/mcp-servers/${id}/tools`),
  callTool: (id: string, data: CallMcpToolRequest) => post<CallMcpToolResult>(`/mcp-servers/${id}/tools/call`, data),
};
