import { HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr'

/**
 * 后端 → 前端的 SignalR 主动推送通道（hub 路径 /hubs/ui）。
 *
 * 与 SSE 流互补：SSE 只在前端发起的请求流里回帧，SignalR 让后端在任意时刻
 * 都能触发界面行为（如智能体 open_panel 唤起浏览器 / PR 面板）。
 * 开发环境经 vite 代理转发，生产/桌面端与后端同源直连。
 */

type UiActionHandler = (payload: Record<string, unknown>) => void

const handlers = new Map<string, Set<UiActionHandler>>()
let connection: HubConnection | null = null

/** 订阅一种 uiAction 动作；返回取消订阅函数 */
export function onUiAction(type: string, handler: UiActionHandler): () => void {
  let set = handlers.get(type)
  if (!set) {
    set = new Set()
    handlers.set(type, set)
  }
  set.add(handler)
  return () => {
    set.delete(handler)
  }
}

/** 建立连接（幂等，应用启动时调用一次）；断线自动重连，初始失败按 5s 重试 */
export function startUiSignalR(): void {
  if (connection) return
  const conn = new HubConnectionBuilder()
    .withUrl('/hubs/ui')
    .configureLogging(LogLevel.Warning)
    .withAutomaticReconnect()
    .build()

  conn.on('uiAction', (msg: unknown) => {
    if (!msg || typeof msg !== 'object') return
    const { type, payload } = msg as { type?: unknown; payload?: unknown }
    if (typeof type !== 'string') return
    const actionPayload = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    handlers.get(type)?.forEach((handler) => handler(actionPayload))
  })

  connection = conn
  const connect = () => {
    void conn.start().catch(() => {
      setTimeout(connect, 5000)
    })
  }
  connect()
}
