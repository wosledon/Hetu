import { isTauri } from '../utils/tauri'

/**
 * 桌面端自动更新（Tauri updater）。
 *
 * 更新源在 shell 的 tauri conf 里配置，endpoints 按顺序尝试：
 *   1. GitHub Releases（latest*.json）
 *   2. ghproxy.net 镜像（镜像清单里的资源直链也带镜像前缀）
 *   3. gh-proxy.com 镜像
 * 因此 GitHub 不通时会自动改走镜像，下载同样走通。
 */
export interface UpdateInfo {
  /** 新版本号 */
  version: string
  /** 当前版本号 */
  currentVersion: string
  /** 发布时间（Rust 端给的字符串） */
  date?: string
  /** 更新说明 */
  notes?: string
}

export type UpdateProgress = { downloaded: number; total?: number }

interface UpdaterUpdate {
  version: string
  currentVersion: string
  date?: string
  body?: string
  downloadAndInstall: (cb: (event: UpdaterEvent) => void) => Promise<void>
}

type UpdaterEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished'; data: Record<string, never> }

export const updateService = {
  /** 是否支持自动更新（只有桌面壳里有 updater；浏览器开发模式没有） */
  supported: () => isTauri(),

  /** 检测更新；无更新返回 null，网络/配置问题抛错 */
  async check(timeoutMs = 20000): Promise<UpdateInfo | null> {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = (await check({ timeout: timeoutMs })) as UpdaterUpdate | null
    if (!update) return null
    return {
      version: update.version,
      currentVersion: update.currentVersion,
      date: update.date,
      notes: update.body,
    }
  },

  /** 下载并安装（Windows 走 NSIS passive 模式，Linux 替换 AppImage） */
  async install(onProgress: (progress: UpdateProgress) => void, timeoutMs = 20000): Promise<void> {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = (await check({ timeout: timeoutMs })) as UpdaterUpdate | null
    if (!update) throw new Error('update-not-found')

    let downloaded = 0
    let total: number | undefined
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength
        onProgress({ downloaded: 0, total })
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength
        onProgress({ downloaded, total })
      } else {
        onProgress({ downloaded: total ?? downloaded, total })
      }
    })
  },

  /** 安装完成后重启应用 */
  async restart(): Promise<void> {
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  },
}
