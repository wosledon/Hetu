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

/** 壳命令等待上限：IPC 无响应时不能让点击变成"没反应" */
const SHELL_OPEN_TIMEOUT_MS = 1500

/**
 * 用系统默认浏览器打开外链。
 * - 桌面壳：webview 会拦掉 window.open / <a target="_blank">，必须走壳侧命令
 * - 浏览器：直接新标签页
 * 壳命令不可用时退回 window.open（Tauri 里可能被拦截，但至少尝试过）。
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
    if (!opened) window.open(url, '_blank', 'noopener')
  })()
}
