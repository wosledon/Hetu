/**
 * 编码会话在跑的流登记（模块级，不随组件卸载丢失）。
 *
 * SPA 内部跳转不会中断 fetch：切去别的页面时 /stream 请求仍然开着，Agent 循环继续跑、
 * 消息继续落库。但 WorkSessionArea 已卸载，isStreaming 这类 state 跟着丢了——回到 /code
 * 时看到的是「空闲」且不轮询，用户以为会话断了。
 *
 * 这里只存 AbortController：用来在重挂载后判断「这个会话还有流在跑」（恢复轮询与运行态），
 * 也让「停止」按钮在重挂载后依然能作用到原来那个 controller。
 */

const runs = new Map<string, AbortController>()

export const workStreamRuns = {
  register: (sessionId: string, controller: AbortController) => runs.set(sessionId, controller),
  unregister: (sessionId: string) => runs.delete(sessionId),
  /** 该会话是否还有在跑的流（含切走页面期间） */
  isRunning: (sessionId: string) => runs.has(sessionId),
  cancel: (sessionId: string) => {
    runs.get(sessionId)?.abort()
    runs.delete(sessionId)
  },
}
