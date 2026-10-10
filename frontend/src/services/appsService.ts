import i18n from '../i18n'
import { get, put, post } from './api'

export interface IWebApp {
  id: string
  name: string
  url: string
  createdAt?: string
}

const KEY = 'WebApps'

/** 常用大模型网页对话预设（添加时可一键选择） */
export function getWebAppPresets(): { name: string; url: string }[] {
  return [
    { name: i18n.t('settings:apps.presets.deepseek'), url: 'https://chat.deepseek.com' },
    { name: i18n.t('settings:apps.presets.tongyi'), url: 'https://www.tongyi.com/qianwen' },
    { name: i18n.t('settings:apps.presets.kimi'), url: 'https://www.kimi.com' },
    { name: i18n.t('settings:apps.presets.doubao'), url: 'https://www.doubao.com/chat' },
    { name: i18n.t('settings:apps.presets.chatglm'), url: 'https://chatglm.cn/main/alltoolsdetail' },
    { name: i18n.t('settings:apps.presets.ernie'), url: 'https://yiyan.baidu.com' },
    { name: i18n.t('settings:apps.presets.spark'), url: 'https://xinghuo.xfyun.cn/desk' },
    { name: i18n.t('settings:apps.presets.chatgpt'), url: 'https://chatgpt.com' },
    { name: i18n.t('settings:apps.presets.claude'), url: 'https://claude.ai' },
    { name: i18n.t('settings:apps.presets.gemini'), url: 'https://gemini.google.com' },
    { name: i18n.t('settings:apps.presets.grok'), url: 'https://grok.com' },
    { name: i18n.t('settings:apps.presets.copilot'), url: 'https://copilot.microsoft.com' },
  ]
}

/** 规范化 URL：缺少协议时补 https */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/** 网页应用：存放在 AppSettings 的 WebApps 键下（JSON 数组） */
export const appsService = {
  getAll: async (): Promise<IWebApp[]> => {
    const setting = await get<{ value?: string } | null>(`/settings/${KEY}`)
    if (!setting?.value) return []
    try {
      const parsed = JSON.parse(setting.value) as IWebApp[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  },
  saveAll: (apps: IWebApp[]) => put<void>('/settings', { key: KEY, value: JSON.stringify(apps) }),
  /** 探测站点是否允许 iframe 内嵌（后端代读响应头） */
  checkEmbed: (url: string) => post<{ embeddable: boolean; reason: string }>('/apps/check-embed', { url }),
  /** 站点图标地址（后端解析 link rel=icon 并缓存；失败时前端回退字母头像） */
  faviconUrl: (url: string) => `/api/apps/favicon?url=${encodeURIComponent(url)}`,
}
