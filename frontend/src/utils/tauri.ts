/** Tauri 桌面环境探测与命令调用（浏览器开发模式下自动降级） */

interface TauriInternals {
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>
}

function internals(): TauriInternals | null {
  const w = window as unknown as { __TAURI_INTERNALS__?: TauriInternals }
  return w.__TAURI_INTERNALS__ ?? null
}

/** 是否运行在 Tauri 桌面壳中（而非普通浏览器） */
export function isTauri(): boolean {
  return internals() !== null
}

/** 调用 Tauri 命令；非桌面环境返回 null */
export async function tauriInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  const t = internals()
  if (!t) return null
  return t.invoke<T>(cmd, args)
}

/**
 * 打开应用内嵌网页窗口。
 * - 桌面壳：创建/聚焦独立 WebViewWindow（不受 X-Frame-Options 限制，大模型网页可用）
 * - 浏览器：退回系统新窗口
 */
export async function openAppWebview(url: string, title: string): Promise<'webview' | 'external'> {
  try {
    const result = await tauriInvoke('open_app_webview', { url, title })
    if (result !== null) return 'webview'
  } catch { /* 命令不可用时走外部打开 */ }
  window.open(url, '_blank', 'noopener')
  return 'external'
}
