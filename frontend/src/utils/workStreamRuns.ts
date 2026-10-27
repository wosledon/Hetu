// ─── 编码会话流的断线重连 ───
//
// 后端把 Agent 循环的生命周期从 HTTP 请求上摘了下来（WorkRunRegistry）：客户端断开
// （刷新页面、地址栏跳转、网络抖动）只解除挂载，循环继续跑完并照常落库。
// 于是前端会在两种情况下「不知道它在跑」：
//   1. SPA 切走页面——fetch 没断，运行继续，但组件卸载了，isStreaming 这类 state 丢了；
//   2. 刷新页面——本地登记清空，只能问后端要状态。
// 两种都靠这里的登记 + 后端 /run-status 恢复运行态，再由消息轮询把进度补上。

interface RunEntry {
  controller: AbortController
  /** 运行结束（收到 done 帧 / 流关闭）时的回调 */
  onDone?: () => void
}

const runs = new Map<string, RunEntry>()
const listeners = new Set<() => void>()
/** getSnapshot 的缓存值：引用不变，useSyncExternalStore 才不会陷入重渲染循环 */
let cachedIds: string[] = []

const notify = () => {
  cachedIds = Array.from(runs.keys())
  listeners.forEach((listener) => listener())
}

export const workStreamRuns = {
  register: (sessionId: string, controller: AbortController, onDone?: () => void) => {
    runs.set(sessionId, { controller, onDone })
    notify()
  },

  unregister: (sessionId: string) => {
    runs.delete(sessionId)
    notify()
  },

  /** 该会话是否还有在跑的流（含切走页面期间与刷新前） */
  isRunning: (sessionId: string) => runs.has(sessionId),

  /** 订阅在跑会话集合变化（供侧栏即时标记「进行中」，不用等下一轮轮询） */
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },

  /** 在跑的会话 id 快照（引用稳定，配合 useSyncExternalStore 使用） */
  snapshot: () => cachedIds,

  /**
   * 挂载到后端在跑的运行上（GET /stream，不发新一轮）。
   * 只用来守住运行结束的时刻——过程帧不进本地时间线：那些思考/工具调用同样落了库，
   * 由消息轮询与历史渲染展示，重放一遍反而会和落库消息重复。
   * 返回摘除函数：只摘自己挂上的这条，期间起的本地流不受影响。
   */
  attach: (sessionId: string, onDone: () => void): (() => void) => {
    const controller = new AbortController()
    runs.set(sessionId, { controller, onDone })
    notify()
    const finish = () => {
      if (runs.get(sessionId)?.controller === controller) runs.delete(sessionId)
      notify()
      onDone()
    }
    void (async () => {
      try {
        const response = await fetch(`/api/work-sessions/${sessionId}/stream`, {
          signal: controller.signal,
          headers: { Accept: 'text/event-stream' },
        })
        if (!response.ok || !response.body) { finish(); return }
        await pump(response.body, controller.signal, (frame) => {
          if (frame.includes('"type":"done"') || frame.includes('"type": "done"')) finish()
        })
        // 流自然结束（运行已跑完）也要收尾，否则会一直挂在运行态上
        finish()
      } catch {
        // 连接中断：后端运行不受影响，下次挂载会重新挂上
        finish()
      }
    })()
    return () => {
      if (runs.get(sessionId)?.controller !== controller) return
      controller.abort()
      runs.delete(sessionId)
      notify()
    }
  },

  cancel: (sessionId: string) => {
    runs.get(sessionId)?.controller.abort()
    runs.delete(sessionId)
    notify()
  },
}

/** 读 SSE 响应体，按空行切帧，把每帧的 data 段拼好交给 onFrame */
async function pump(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onFrame: (frame: string) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let sep = buffer.indexOf('\n\n')
      while (sep >= 0) {
        const raw = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        // SSE 一段里可能有多个 data: 行，按协议用 \n 连接
        const data = raw
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data) onFrame(data)
        sep = buffer.indexOf('\n\n')
      }
    }
  } catch {
    // 连接中断：正常路径，后端运行不受影响
  }
}
