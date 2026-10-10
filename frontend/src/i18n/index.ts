import i18n, { type Resource } from 'i18next'
import { initReactI18next } from 'react-i18next'

export type AppLanguage = 'zh' | 'en'

/**
 * 文案资源按「语言/命名空间」拆分在 locales/ 下，靠 glob 自动收集：
 * 新增页面只需加一对 locales/zh/<area>.ts 与 locales/en/<area>.ts，无需注册。
 */
const modules = import.meta.glob<{ default: Record<string, unknown> }>('./locales/*/*.ts', { eager: true })

function collect(lng: AppLanguage): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [path, mod] of Object.entries(modules)) {
    const m = /\/locales\/(zh|en)\/([^/]+)\.ts$/.exec(path)
    if (!m || m[1] !== lng || !mod?.default) continue
    out[m[2]] = mod.default
  }
  return out
}

export const LANGUAGE_STORAGE_KEY = 'hetu-language'

/** 首次进入：优先本地记录，其次浏览器语言（中文环境走 zh，其余走 en） */
export function detectLanguage(): AppLanguage {
  const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY)
  if (saved === 'zh' || saved === 'en') return saved
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function currentLanguage(): AppLanguage {
  return i18n.language === 'en' ? 'en' : 'zh'
}

i18n.use(initReactI18next).init({
  resources: { zh: collect('zh'), en: collect('en') } as Resource,
  lng: detectLanguage(),
  fallbackLng: 'zh',
  defaultNS: 'common',
  keySeparator: '.',
  interpolation: { escapeValue: false },
  returnNull: false,
})

/** 切换语言：立即生效 + 记住选择 + 同步 html lang（请求头由 api 拦截器带上） */
export async function applyLanguage(lng: AppLanguage) {
  await i18n.changeLanguage(lng)
  localStorage.setItem(LANGUAGE_STORAGE_KEY, lng)
  document.documentElement.lang = lng === 'zh' ? 'zh-CN' : 'en'
}

document.documentElement.lang = currentLanguage() === 'zh' ? 'zh-CN' : 'en'

export default i18n
