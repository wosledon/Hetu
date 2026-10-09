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
import { consumeSseStream } from '../utils/sse'
import { parseAgentFrame } from '../utils/agentStream'

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

/// 流式执行工作流的 SSE 订阅。
/// onEvent 接收每个 SSE 事件对象，onError 接收流内错误帧或连接错误。
export async function streamWorkflowRun(
  workflowId: string,
  input: string | undefined,
  topicId: string | undefined,
  onEvent: (event: { type: string; [key: string]: unknown }) => void,
  onError: (err: string) => void,
  signal?: AbortSignal,
  toolApprovalMode?: string,
): Promise<void> {
  const url = topicId
    ? `/api/workflows/${workflowId}/run/topic/${topicId}/stream`
    : `/api/workflows/${workflowId}/run/stream`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, toolApprovalMode }),
      signal,
    })

    if (!response.ok || !response.body) {
      onError(`HTTP ${response.status}`)
      return
    }

    await consumeSseStream(
      response,
      ({ data }) => {
        // 帧解析统一走 utils/agentStream：错误帧、非 JSON 帧与 JSON 事件一套逻辑
        const { event, error, plainText } = parseAgentFrame(data)
        if (error != null) {
          onError(error)
          return
        }
        if (!event) {
          if (plainText != null) onEvent({ type: 'content', text: plainText })
          return
        }
        onEvent(event as unknown as { type: string; [key: string]: unknown })
      },
      { signal },
    )
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      onError((err as Error).message)
    }
  }
}
