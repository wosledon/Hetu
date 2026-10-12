import type { CSSProperties } from 'react'

/**
 * 外观（主题配色 + 画布背景）预设与落地。
 *
 * 主题配色：Tailwind v4 的色板 utilities 都引用 `--color-blue-*` / `--color-indigo-*`
 * 这两个 CSS 变量，因此在 :root 上整体换掉这两个 ramp 的色相，
 * 全软件的 blue-* / indigo-*（按钮、选中态、链接、焦点环）就一次性换色，无需逐处改类名。
 *
 * 画布背景：写在 body 上，AppLayout 根与各页主内容区保持透明，
 * 卡片（bg-white / dark:bg-gray-900）仍不透，所以背景从画布间隙透出来。
 */

/* ─── 主题配色 ─── */

/** Tailwind v4 默认 blue ramp（直接用默认值，保证「经典蓝」与原视觉一致） */
const BLUE_RAMP: Record<number, string> = {
  50: 'oklch(97% 0.014 254.604)',
  100: 'oklch(93.2% 0.032 255.585)',
  200: 'oklch(88.2% 0.059 254.128)',
  300: 'oklch(80.9% 0.105 251.813)',
  400: 'oklch(70.7% 0.165 254.624)',
  500: 'oklch(62.3% 0.214 259.815)',
  600: 'oklch(54.6% 0.245 262.881)',
  700: 'oklch(48.8% 0.243 264.376)',
  800: 'oklch(42.4% 0.199 265.638)',
  900: 'oklch(37.9% 0.146 265.522)',
  950: 'oklch(28.2% 0.091 267.935)',
}

/** 默认 indigo ramp：作为渐变第二色（from-blue-500 to-indigo-600 的第二端） */
const INDIGO_RAMP: Record<number, string> = {
  50: 'oklch(96.2% 0.018 272.314)',
  100: 'oklch(93% 0.034 272.788)',
  200: 'oklch(87% 0.065 274.039)',
  300: 'oklch(78.5% 0.115 274.713)',
  400: 'oklch(67.3% 0.182 276.935)',
  500: 'oklch(58.5% 0.233 277.117)',
  600: 'oklch(51.1% 0.262 276.966)',
  700: 'oklch(45.7% 0.24 277.023)',
  800: 'oklch(39.8% 0.195 277.366)',
  900: 'oklch(35.9% 0.144 278.697)',
  950: 'oklch(25.7% 0.09 281.288)',
}

export type AccentKey = 'blue' | 'violet' | 'cyan' | 'emerald' | 'amber' | 'rose'

interface AccentPreset {
  key: AccentKey
  /** 相对 blue 的色相偏移（度） */
  hueShift: number
  /** 彩度倍率：部分色相在 Tailwind 里天然低饱和，直接平移会过艳 */
  chroma: number
  /** 选择器上的预览色 */
  swatch: [string, string]
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { key: 'blue', hueShift: 0, chroma: 1, swatch: ['#3b82f6', '#4f46e5'] },
  { key: 'violet', hueShift: 33, chroma: 1, swatch: ['#8b5cf6', '#6d28d9'] },
  { key: 'cyan', hueShift: -45, chroma: 0.72, swatch: ['#06b6d4', '#0e7490'] },
  { key: 'emerald', hueShift: -97, chroma: 0.85, swatch: ['#10b981', '#047857'] },
  { key: 'amber', hueShift: -190, chroma: 0.95, swatch: ['#f59e0b', '#b45309'] },
  { key: 'rose', hueShift: -243, chroma: 1.08, swatch: ['#f43f5e', '#be123c'] },
]

const RAMP_VARS = Object.keys(BLUE_RAMP).flatMap((step) => [
  `--color-blue-${step}`,
  `--color-indigo-${step}`,
])

/** 把 oklch(...) 的色相平移、彩度缩放，生成换色后的 ramp */
function recolor(value: string, hueShift: number, chroma: number): string {
  return value.replace(
    /oklch\(\s*([\d.]+%)\s+([\d.]+)\s+([\d.]+)\s*\)/,
    (_, l, c, h) =>
      `oklch(${l} ${(parseFloat(c) * chroma).toFixed(3)} ${((parseFloat(h) + hueShift) % 360 + 360) % 360})`,
  )
}

/** 生成某配对的 CSS 变量表；blue 原样返回空表（保持 Tailwind 默认） */
function accentVars(preset: AccentPreset): Record<string, string> {
  if (preset.key === 'blue') return {}
  const vars: Record<string, string> = {}
  for (const step of Object.keys(BLUE_RAMP)) {
    vars[`--color-blue-${step}`] = recolor(BLUE_RAMP[Number(step)], preset.hueShift, preset.chroma)
    // indigo 作为渐变第二色，保持与主色约 17° 的色相差
    vars[`--color-indigo-${step}`] = recolor(INDIGO_RAMP[Number(step)], preset.hueShift + 17, preset.chroma)
  }
  return vars
}

/** 把主题配色写到 :root；blue = 移除覆盖，回到 Tailwind 默认 */
export function applyAccent(key: string): void {
  const root = document.documentElement
  const preset = ACCENT_PRESETS.find((p) => p.key === key) ?? ACCENT_PRESETS[0]
  for (const name of RAMP_VARS) root.style.removeProperty(name)
  for (const [name, value] of Object.entries(accentVars(preset))) {
    root.style.setProperty(name, value)
  }
}

/* ─── 画布背景 ─── */

export type BackgroundKey = 'solid' | 'dawn' | 'dusk' | 'grid' | 'dots' | 'aurora'

interface BackgroundPreset {
  key: BackgroundKey
  /** 明/暗两套画布样式 */
  style: (isDark: boolean) => CSSProperties
}

/** 网格纹理：细线 + 底色 */
function gridStyle(isDark: boolean): CSSProperties {
  const line = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.05)'
  return {
    backgroundColor: isDark ? '#0c0f1a' : '#f8f9fb',
    backgroundImage: `linear-gradient(to right, ${line} 1px, transparent 1px), linear-gradient(to bottom, ${line} 1px, transparent 1px)`,
    backgroundSize: '26px 26px',
  }
}

/** 圆点纹理 */
function dotsStyle(isDark: boolean): CSSProperties {
  const dot = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.07)'
  return {
    backgroundColor: isDark ? '#0c0f1a' : '#f8f9fb',
    backgroundImage: `radial-gradient(circle, ${dot} 1px, transparent 1px)`,
    backgroundSize: '22px 22px',
  }
}

/** 极光：底色上叠几团柔光 */
function auroraStyle(isDark: boolean): CSSProperties {
  return {
    backgroundColor: isDark ? '#0a0d18' : '#f6f8fd',
    backgroundImage: isDark
      ? 'radial-gradient(42% 38% at 12% 8%, rgba(124,92,255,0.28), transparent 70%), radial-gradient(38% 34% at 88% 12%, rgba(34,211,238,0.20), transparent 70%), radial-gradient(46% 42% at 70% 92%, rgba(59,130,246,0.18), transparent 72%)'
      : 'radial-gradient(42% 38% at 12% 8%, rgba(139,92,246,0.16), transparent 70%), radial-gradient(38% 34% at 88% 12%, rgba(34,211,238,0.14), transparent 70%), radial-gradient(46% 42% at 70% 92%, rgba(59,130,246,0.12), transparent 72%)',
  }
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  { key: 'solid', style: (isDark) => ({ backgroundColor: isDark ? '#0c0f1a' : '#f8f9fb' }) },
  {
    key: 'dawn',
    style: (isDark) => ({
      backgroundImage: isDark
        ? 'linear-gradient(135deg, #1a1030 0%, #0d1433 48%, #08222e 100%)'
        : 'linear-gradient(135deg, #fdf2ff 0%, #eef3ff 46%, #e7fbff 100%)',
    }),
  },
  {
    key: 'dusk',
    style: (isDark) => ({
      backgroundImage: isDark
        ? 'linear-gradient(160deg, #26172a 0%, #1b1033 52%, #0f1836 100%)'
        : 'linear-gradient(160deg, #fff2e8 0%, #f4e9ff 55%, #e8edff 100%)',
    }),
  },
  { key: 'grid', style: gridStyle },
  { key: 'dots', style: dotsStyle },
  { key: 'aurora', style: auroraStyle },
]

/** 把画布背景写到 body（AppLayout 根与页主内容区透明，卡片不透） */
export function applyBackground(key: string, isDark: boolean): void {
  const preset = BACKGROUND_PRESETS.find((p) => p.key === key) ?? BACKGROUND_PRESETS[0]
  const body = document.body
  const style = preset.style(isDark)
  // 先清掉内联背景，避免上一次的 backgroundImage 残留
  body.style.removeProperty('background-color')
  body.style.removeProperty('background-image')
  body.style.removeProperty('background-size')
  Object.assign(body.style, style)
}

/** 选择器预览用：把预设样式搬到缩略容器上 */
export function backgroundPreviewStyle(key: string, isDark: boolean): CSSProperties {
  const preset = BACKGROUND_PRESETS.find((p) => p.key === key) ?? BACKGROUND_PRESETS[0]
  return preset.style(isDark)
}
