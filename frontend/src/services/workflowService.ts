import { get, post, put, del } from './api'
import type {
  IWorkflow,
  CreateWorkflowRequest,
  UpdateWorkflowRequest,
  IValidationResult,
  IRunWorkflowRequest,
  IWorkflowRun,
  IWorkflowRunDetail,
} from '../types/workflow'

export const workflowService = {
  getAll: () => get<IWorkflow[]>('/workflows'),
  getById: (id: string) => get<IWorkflow>(`/workflows/${id}`),
  create: (data: CreateWorkflowRequest) => post<IWorkflow>('/workflows', data),
  update: (id: string, data: UpdateWorkflowRequest) => put<IWorkflow>(`/workflows/${id}`, data),
  delete: (id: string) => del<void>(`/workflows/${id}`),
  duplicate: (id: string) => post<IWorkflow>(`/workflows/${id}/duplicate`),
  validate: (id: string) => get<IValidationResult>(`/workflows/${id}/validate`),
  run: (id: string, data: IRunWorkflowRequest) => post<{ runId: string; status: string; output?: string; error?: string }>(`/workflows/${id}/run`, data),
  getRun: (runId: string) => get<IWorkflowRunDetail>(`/workflows/runs/${runId}`),
  getRuns: (id: string) => get<IWorkflowRun[]>(`/workflows/${id}/runs`),
  approve: (runId: string, nodeId: string, approve: boolean) =>
    post<void>(`/workflows/runs/${runId}/approve`, { nodeId, approve }),
}

/// 流式执行工作流的 SSE 订阅。返回取消函数。
/// onEvent 接收每个 SSE 事件对象。
export async function streamWorkflowRun(
  workflowId: string,
  input: string | undefined,
  topicId: string | undefined,
  onEvent: (event: { type: string; [key: string]: unknown }) => void,
  onError: (err: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const url = topicId
    ? `/api/workflows/${workflowId}/run/topic/${topicId}/stream`
    : `/api/workflows/${workflowId}/run/stream`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
      signal,
    })

    if (!response.ok || !response.body) {
      onError(`HTTP ${response.status}`)
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6)
          try {
            const evt = JSON.parse(jsonStr)
            onEvent(evt)
          } catch {
            // 非 JSON（如 [ERROR] 消息）
            if (jsonStr.startsWith('[ERROR]')) onError(jsonStr.slice(7).trim())
          }
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      onError((err as Error).message)
    }
  }
}
