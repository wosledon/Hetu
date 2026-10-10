import { create } from 'zustand'
import { updateService, type UpdateInfo } from '../services/updateService'

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'installed' | 'up-to-date' | 'error'

interface UpdateState {
  status: UpdateStatus
  info: UpdateInfo | null
  /** 已下载字节 / 总字节（未知时 total 为 undefined） */
  downloaded: number
  total?: number
  error?: string
  /** 用户点了「稍后」：本次会话不再弹横幅 */
  dismissed: boolean
  check: (silent?: boolean) => Promise<void>
  install: () => Promise<void>
  restart: () => Promise<void>
  dismiss: () => void
}

/**
 * 更新状态（内存态，不持久化）：
 * 启动自动检测一次，设置页与顶部横幅共用同一份状态。
 */
export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: 'idle',
  info: null,
  downloaded: 0,
  dismissed: false,

  check: async (silent = false) => {
    if (!updateService.supported()) return
    if (get().status === 'checking' || get().status === 'downloading') return
    set({ status: 'checking', error: undefined })
    try {
      // 静默检测用更短的超时：三个更新源（GitHub + 两个镜像）串行尝试，避免后台等待过久
      const info = await updateService.check(silent ? 12000 : 20000)
      set(info ? { status: 'available', info, dismissed: false } : { status: 'up-to-date', info: null })
    } catch (err) {
      // 静默检测（启动时）失败不打扰用户：GitHub 与镜像都不通时保持 idle
      set({ status: silent ? 'idle' : 'error', error: err instanceof Error ? err.message : String(err) })
    }
  },

  install: async () => {
    if (get().status === 'downloading') return
    set({ status: 'downloading', downloaded: 0, total: undefined, error: undefined })
    try {
      await updateService.install(({ downloaded, total }) => set({ downloaded, total }))
      set({ status: 'installed' })
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  },

  restart: async () => {
    await updateService.restart()
  },

  dismiss: () => set({ dismissed: true }),
}))
