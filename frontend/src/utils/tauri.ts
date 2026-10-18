/** Tauri 桌面环境探测与命令调用（浏览器开发模式下自动降级） */

interface TauriInternals {
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>
}

function internals(): TauriInternals | null {
  const w = window as unknown as { __TAURI_INTERNALS__?: TauriInternals }
  const t = w.__TAURI_INTERNALS__
  // 只认真正可用的壳：有些宿主（应用内浏览器等）会注入不含 invoke 的占位对象
  return t && typeof t.invoke === 'function' ? t : null
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

/** 是否是被 ACL 拒绝（当前构建未授权该插件能力，如老版本没有 updater 权限） */
export function isTauriAclError(message?: string): boolean {
  return !!message && /not allowed by ACL|not allowed/i.test(message)
}

/**
 * 打开应用内嵌网页窗口。
 * - 桌面壳：创建/聚焦独立 WebViewWindow（不受 X-Frame-Options 限制）
 * - 浏览器：退回系统新窗口
 */
export async function openAppWebview(url: string, title: string): Promise<'webview' | 'external'> {
  if (!isTauri()) {
    window.open(url, '_blank', 'noopener')
    return 'external'
  }
  try {
    // 命令成功时返回 null（Rust 的 Result<(), _>），不能用返回值判断成败
    await tauriInvoke('open_app_webview', { url, title })
    return 'webview'
  } catch {
    return 'external'
  }
}

/**
 * 打开网页应用（新的统一入口）。
 * - 桌面壳：优先系统 Chromium 浏览器的应用模式窗口：真实浏览器内核，
 *   Google 等站点不会像对待嵌入式 WebView 那样拒绝登录；每个站点独立配置目录，
 *   Cookie 跨重启保留。没有 Chromium 浏览器时退回内置 WebView 窗口。
 * - 浏览器：同步打开新标签页；调用方应在点击事件里直接调用，避免被弹窗拦截。
 */
export async function openAppWindow(url: string, title: string): Promise<'browser' | 'webview' | 'system' | 'failed'> {
  if (!isTauri()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return 'system'
  }
  try {
    const mode = await tauriInvoke<string>('open_app_window', { url, title })
    if (mode === 'browser' || mode === 'webview') return mode
  } catch { /* 老版本壳没有该命令，退回 open_app_webview */ }
  try {
    await tauriInvoke('open_app_webview', { url, title })
    return 'webview'
  } catch { /* 两条命令都不可用 */ }
  try {
    // open_external 成功时同样返回 null，以「是否抛错」判断
    await tauriInvoke('open_external', { url })
    return 'system'
  } catch {
    return 'failed'
  }
}

/** 壳命令等待上限：IPC 无响应时不能让点击变成"没反应" */
const SHELL_OPEN_TIMEOUT_MS = 1500

/**
 * 用系统默认浏览器打开外链。
 * - 桌面壳：webview 会拦掉 window.open / <a target="_blank">，必须走壳侧命令
 * - 浏览器：直接新标签页
 * 壳命令不可用或超时（老版本壳、IPC 降级）时退回应用内窗口，至少点得开。
 */
export function openExternal(url: string): void {
  if (!isTauri()) {
    window.open(url, '_blank', 'noopener')
    return
  }
  void (async () => {
    const opened = await Promise.race([
      tauriInvoke('open_external', { url }).then(() => true),
      new Promise<boolean>((resolve) => {
        window.setTimeout(() => resolve(false), SHELL_OPEN_TIMEOUT_MS)
      }),
    ]).catch(() => false)
    if (opened) return
    // 壳命令没响应：退回应用内窗口（open_app_webview 这条命令更早就有）
    const fallback = await openAppWebview(url, url)
    if (fallback === 'external') window.open(url, '_blank', 'noopener')
  })()
}
