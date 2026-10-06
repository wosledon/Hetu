import { get, put, post } from './api'

export interface IWebApp {
  id: string
  name: string
  url: string
  createdAt?: string
}

const KEY = 'WebApps'

/** 常用大模型网页对话预设（添加时可一键选择） */
export const WEB_APP_PRESETS: { name: string; url: string }[] = [
  { name: 'DeepSeek', url: 'https://chat.deepseek.com' },
  { name: '通义千问', url: 'https://www.tongyi.com/qianwen' },
  { name: 'Kimi', url: 'https://www.kimi.com' },
  { name: '豆包', url: 'https://www.doubao.com/chat' },
  { name: '智谱清言', url: 'https://chatglm.cn/main/alltoolsdetail' },
  { name: '文心一言', url: 'https://yiyan.baidu.com' },
  { name: '讯飞星火', url: 'https://xinghuo.xfyun.cn/desk' },
  { name: 'ChatGPT', url: 'https://chatgpt.com' },
  { name: 'Claude', url: 'https://claude.ai' },
  { name: 'Gemini', url: 'https://gemini.google.com' },
  { name: 'Grok', url: 'https://grok.com' },
  { name: 'Copilot', url: 'https://copilot.microsoft.com' },
]

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
