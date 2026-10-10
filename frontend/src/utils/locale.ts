import i18n from '../i18n'

/** 界面语言对应的 BCP-47 标识（日期/数字/时间格式化都用它，跟随设置页的语言切换） */
export function uiLocale(): string {
  return i18n.language === 'en' ? 'en-US' : 'zh-CN'
}

function toDate(value?: string | number | Date | null): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(value?: string | number | Date | null, options?: Intl.DateTimeFormatOptions): string {
  const date = toDate(value)
  return date ? date.toLocaleDateString(uiLocale(), options) : ''
}

export function formatTime(value?: string | number | Date | null, options?: Intl.DateTimeFormatOptions): string {
  const date = toDate(value)
  return date ? date.toLocaleTimeString(uiLocale(), options ?? { hour: '2-digit', minute: '2-digit' }) : ''
}

export function formatDateTime(value?: string | number | Date | null, options?: Intl.DateTimeFormatOptions): string {
  const date = toDate(value)
  return date ? date.toLocaleString(uiLocale(), options) : ''
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(uiLocale(), options)
}
