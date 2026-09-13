/**
 * 服务端 `text/event-stream` 的统一消费逻辑。
 *
 * 后端（`SseStreamWriter` / `ChatTopicsController` / `GraphService`）统一以
 * `data: {payload}\n\n` 或 `event: {type}\ndata: {payload}\n\n` 推送事件，
 * 此前每个调用方都手写了一遍 reader 循环与跨 chunk 缓冲，这里收敛为一份实现。
 */

/** 流内错误帧前缀，如 `data: [ERROR] 模型未配置`。 */
export const SSE_ERROR_PREFIX = '[ERROR]'

export interface SseEvent {
  /** `event:` 字段，后端未指定时为空字符串 */
  event: string
  /** `data:` 字段内容（多行以 `\n` 连接），不含 `data: ` 前缀 */
  data: string
}

export interface ConsumeSseOptions {
  /** 中断信号：触发时取消底层 reader，让后端的 CancellationToken 感知取消 */
  signal?: AbortSignal
}

/**
 * 逐事件消费 SSE 响应体，直到流结束或 signal 中断。
 *
 * 调用方无需处理跨 chunk 的行缓冲；只有携带 `data:` 的完整事件会被回调。
 * 非 2xx 响应不在此处理，由调用方自行判断。
 */
export async function consumeSseStream(
  response: Response,
  onEvent: (event: SseEvent) => void,
  { signal }: ConsumeSseOptions = {},
): Promise<void> {
  if (!response.body) return

  const reader = response.body.getReader()
  const onAbort = () => {
    reader.cancel().catch(() => {})
  }
  signal?.addEventListener('abort', onAbort)

  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        emit(buffer.slice(0, boundary), onEvent)
        buffer = buffer.slice(boundary + 2)
      }
    }
    if (buffer.trim()) emit(buffer, onEvent)
  } finally {
    signal?.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}

function emit(block: string, onEvent: (event: SseEvent) => void): void {
  let event = ''
  const data: string[] = []
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (data.length > 0) onEvent({ event, data: data.join('\n') })
}
