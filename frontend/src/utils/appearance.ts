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

export type BackgroundKey = 'solid' | 'palette' | 'dawn' | 'dusk' | 'grid' | 'dots' | 'aurora'

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
  /** 跟随区域：不额外上色，画布直接取区域配色里的内容底色（实际样式在 applyBackground 里按调色板计算） */
  { key: 'palette', style: (isDark) => ({ backgroundColor: isDark ? '#0c0f1a' : '#f8f9fb' }) },
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

const solidPreset = () => BACKGROUND_PRESETS.find((p) => p.key === 'solid') ?? BACKGROUND_PRESETS[1]

/** 把画布背景写到 body（AppLayout 根与页主内容区透明，卡片不透）
 *  key=palette 时画布取当前区域配色的内容底色，随区域配色一起变化。 */
export function applyBackground(key: string, isDark: boolean, regionPalette?: string): void {
  const body = document.body
  const root = document.documentElement
  // 先清掉内联背景，避免上一次的 backgroundImage 残留
  body.style.removeProperty('background-color')
  body.style.removeProperty('background-image')
  body.style.removeProperty('background-size')
  root.style.removeProperty('background-color')
  if (key === 'palette') {
    // 内容色本身太接近白，和内容区叠加后会「看不出跟随」；用列表栏色做画布，
    // 内容区再叠内容色，既保持清晰又能明显带出区域色调
    const preset = REGION_PALETTES.find((p) => p.key === regionPalette) ?? REGION_PALETTES[0]
    const colors = isDark ? preset.dark : preset.light
    root.style.backgroundColor = isDark ? '#0c0f1a' : '#f8f9fb'
    body.style.backgroundColor = colors.list
    return
  }
  const preset = BACKGROUND_PRESETS.find((p) => p.key === key) ?? solidPreset()
  Object.assign(body.style, preset.style(isDark))
}

/** 选择器预览用：把预设样式搬到缩略容器上；「跟随区域」按当前调色板的内容色渲染 */
export function backgroundPreviewStyle(key: string, isDark: boolean, regionPalette?: string): CSSProperties {
  if (key === 'palette') {
    const preset = REGION_PALETTES.find((p) => p.key === regionPalette) ?? REGION_PALETTES[0]
    const colors = isDark ? preset.dark : preset.light
    return {
      backgroundColor: isDark ? '#0c0f1a' : '#f8f9fb',
      backgroundImage: `linear-gradient(${colors.list}, ${colors.list})`,
    }
  }
  const preset = BACKGROUND_PRESETS.find((p) => p.key === key) ?? solidPreset()
  return preset.style(isDark)
}

/* ─── 工作区区域配色 ─── */

export type RegionPaletteKey = 'default' | 'mist' | 'sand' | 'sage' | 'lilac' | 'graphite'

/** 每个布局区域一张色，亮/暗各一套；只做表面色调，文字与强调色仍由主题控制 */
export interface RegionColors {
  /** 导航栏（顶栏 / 导轨） */
  nav: string
  /** 次级栏（项目 / 设置导航） */
  secondary: string
  /** 列表栏（会话 / 笔记 / 任务列表） */
  list: string
  /** 内容区底色 */
  content: string
  /** 卡片：亚克力开启时材质底色 */
  cardGlass: string
  /** 卡片：亚克力关闭时宿主底色 */
  cardSolid: string
  /** 条目卡片（tile）底色 */
  cardSoft: string
}

interface RegionPalettePreset {
  key: RegionPaletteKey
  light: RegionColors
  dark: RegionColors
}

export const REGION_PALETTES: RegionPalettePreset[] = [
  {
    key: 'default',
    light: {
      nav: 'rgba(238, 241, 245, 0.96)',
      secondary: 'rgba(246, 248, 251, 0.88)',
      list: 'rgba(252, 253, 254, 0.74)',
      content: 'rgba(255, 255, 255, 0.55)',
      cardGlass: 'rgba(255, 255, 255, 0.50)',
      cardSolid: 'rgba(255, 255, 255, 0.92)',
      cardSoft: 'rgba(253, 254, 255, 0.82)',
    },
    dark: {
      nav: 'rgba(13, 17, 25, 0.94)',
      secondary: 'rgba(18, 23, 33, 0.86)',
      list: 'rgba(22, 28, 39, 0.74)',
      content: 'rgba(25, 31, 43, 0.58)',
      cardGlass: 'rgba(255, 255, 255, 0.10)',
      cardSolid: 'rgba(32, 39, 53, 0.75)',
      cardSoft: 'rgba(255, 255, 255, 0.05)',
    },
  },
  {
    key: 'mist',
    light: {
      nav: 'rgba(190, 210, 240, 0.88)',
      secondary: 'rgba(220, 234, 252, 0.70)',
      list: 'rgba(238, 245, 254, 0.60)',
      content: 'rgba(250, 252, 255, 0.40)',
      cardGlass: 'rgba(255, 255, 255, 0.42)',
      cardSolid: 'rgba(255, 255, 255, 0.86)',
      cardSoft: 'rgba(250, 253, 255, 0.72)',
    },
    dark: {
      nav: 'rgba(13, 22, 42, 0.90)',
      secondary: 'rgba(23, 35, 60, 0.70)',
      list: 'rgba(18, 28, 48, 0.60)',
      content: 'rgba(11, 16, 28, 0.40)',
      cardGlass: 'rgba(36, 48, 76, 0.28)',
      cardSolid: 'rgba(28, 40, 64, 0.62)',
      cardSoft: 'rgba(36, 48, 76, 0.20)',
    },
  },
  {
    key: 'sand',
    light: {
      nav: 'rgba(238, 224, 200, 0.88)',
      secondary: 'rgba(247, 239, 225, 0.72)',
      list: 'rgba(251, 246, 237, 0.60)',
      content: 'rgba(253, 251, 246, 0.40)',
      cardGlass: 'rgba(255, 252, 246, 0.44)',
      cardSolid: 'rgba(255, 252, 246, 0.86)',
      cardSoft: 'rgba(253, 248, 240, 0.74)',
    },
    dark: {
      nav: 'rgba(38, 31, 20, 0.90)',
      secondary: 'rgba(50, 41, 28, 0.70)',
      list: 'rgba(38, 31, 22, 0.60)',
      content: 'rgba(20, 16, 10, 0.40)',
      cardGlass: 'rgba(60, 49, 34, 0.28)',
      cardSolid: 'rgba(52, 43, 30, 0.62)',
      cardSoft: 'rgba(60, 49, 34, 0.20)',
    },
  },
  {
    key: 'sage',
    light: {
      nav: 'rgba(196, 222, 204, 0.88)',
      secondary: 'rgba(224, 239, 229, 0.72)',
      list: 'rgba(240, 248, 243, 0.60)',
      content: 'rgba(250, 253, 251, 0.40)',
      cardGlass: 'rgba(255, 255, 255, 0.42)',
      cardSolid: 'rgba(250, 254, 252, 0.86)',
      cardSoft: 'rgba(245, 251, 247, 0.74)',
    },
    dark: {
      nav: 'rgba(13, 28, 20, 0.90)',
      secondary: 'rgba(23, 41, 32, 0.70)',
      list: 'rgba(18, 33, 26, 0.60)',
      content: 'rgba(10, 19, 14, 0.40)',
      cardGlass: 'rgba(36, 56, 45, 0.28)',
      cardSolid: 'rgba(29, 46, 37, 0.62)',
      cardSoft: 'rgba(36, 56, 45, 0.20)',
    },
  },
  {
    key: 'lilac',
    light: {
      nav: 'rgba(212, 201, 244, 0.88)',
      secondary: 'rgba(235, 229, 252, 0.72)',
      list: 'rgba(246, 242, 254, 0.60)',
      content: 'rgba(252, 251, 255, 0.40)',
      cardGlass: 'rgba(255, 255, 255, 0.42)',
      cardSolid: 'rgba(255, 254, 255, 0.86)',
      cardSoft: 'rgba(251, 249, 255, 0.74)',
    },
    dark: {
      nav: 'rgba(25, 20, 48, 0.90)',
      secondary: 'rgba(37, 31, 64, 0.70)',
      list: 'rgba(28, 23, 48, 0.60)',
      content: 'rgba(15, 12, 26, 0.40)',
      cardGlass: 'rgba(56, 46, 88, 0.28)',
      cardSolid: 'rgba(44, 37, 70, 0.62)',
      cardSoft: 'rgba(56, 46, 88, 0.20)',
    },
  },
  {
    key: 'graphite',
    light: {
      nav: 'rgba(214, 221, 231, 0.90)',
      secondary: 'rgba(236, 240, 245, 0.74)',
      list: 'rgba(246, 248, 251, 0.62)',
      content: 'rgba(252, 253, 255, 0.42)',
      cardGlass: 'rgba(255, 255, 255, 0.46)',
      cardSolid: 'rgba(255, 255, 255, 0.88)',
      cardSoft: 'rgba(249, 250, 252, 0.76)',
    },
    dark: {
      nav: 'rgba(22, 25, 32, 0.90)',
      secondary: 'rgba(32, 37, 46, 0.74)',
      list: 'rgba(25, 29, 37, 0.62)',
      content: 'rgba(14, 16, 21, 0.42)',
      cardGlass: 'rgba(255, 255, 255, 0.11)',
      cardSolid: 'rgba(36, 40, 48, 0.64)',
      cardSoft: 'rgba(255, 255, 255, 0.06)',
    },
  },
]

/** 校验持久化值，避免旧缓存 / 手改配置把未知 key 传进来 */
export function isRegionPaletteKey(value: string | undefined): value is RegionPaletteKey {
  return REGION_PALETTES.some((preset) => preset.key === value)
}

const REGION_VAR_MAP: Record<keyof RegionColors, string> = {
  nav: '--region-nav',
  secondary: '--region-secondary',
  list: '--region-list',
  content: '--region-content',
  cardGlass: '--region-card-glass',
  cardSolid: '--region-card-solid',
  cardSoft: '--region-card-soft',
}

/**
 * 把区域配色写到 :root。default 直接移除内联覆盖，回到 index.css 的原始值，
 * 保证未选配色时与改造前完全一致。
 */
export function applyRegionPalette(key: string, isDark: boolean): void {
  const root = document.documentElement
  for (const name of Object.values(REGION_VAR_MAP)) root.style.removeProperty(name)
  const preset = REGION_PALETTES.find((p) => p.key === key) ?? REGION_PALETTES[0]
  if (preset.key === 'default') return
  const colors = isDark ? preset.dark : preset.light
  for (const [field, name] of Object.entries(REGION_VAR_MAP)) {
    root.style.setProperty(name, colors[field as keyof RegionColors])
  }
}

/* ─── 字体与缩放 ─── */

export type FontFamilyKey = 'system' | 'sans' | 'serif'

export const FONT_FAMILY_PRESETS: { key: FontFamilyKey; stack: string }[] = [
  // 与 index.css 的 :root 默认字体保持一致，切回「系统默认」即恢复原视觉
  {
    key: 'system',
    stack: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  {
    key: 'sans',
    stack: "-apple-system, 'PingFang SC', 'HarmonyOS Sans SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
  },
  {
    key: 'serif',
    stack: "Georgia, 'Times New Roman', 'Songti SC', 'SimSun', 'Noto Serif SC', serif",
  },
]

/** 正文字号预设（px）：作用于 html，Tailwind 的 rem 体系整体缩放 */
export const FONT_SIZE_PRESETS = [14, 16, 18, 20]

/** 界面缩放预设（百分比，100 = 原始大小） */
export const UI_ZOOM_PRESETS = [80, 90, 100, 110, 125]

/** 编辑器（终端 / 代码编辑器）字号占正文的比例：正文 16px → 编辑器 12px */
export const EDITOR_FONT_RATIO = 0.75

/** 编辑器字号：跟随正文字号等比缩放 */
export function editorFontSize(fontSize: number): number {
  return Math.round(clamp(fontSize, 12, 24, 16) * EDITOR_FONT_RATIO)
}

const clamp = (value: number, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

/** 把界面字体写到 :root（内联优先级高于 index.css，未显式设 font-family 的子元素全部继承） */
export function applyFontFamily(key: string): void {
  const root = document.documentElement
  const preset = FONT_FAMILY_PRESETS.find((p) => p.key === key) ?? FONT_FAMILY_PRESETS[0]
  // font-sans 工具类引用 Tailwind 主题变量，一并覆盖保持一致
  root.style.setProperty('--font-sans', preset.stack)
  root.style.fontFamily = preset.stack
}

/** 正文字号：改 html 的 font-size，rem 单位的文字与间距整体等比缩放 */
export function applyFontSize(px: number): void {
  document.documentElement.style.fontSize = `${clamp(px, 12, 24, 16)}px`
}

/** 界面缩放：html 上设 zoom，整个界面（含 fixed 定位元素）一起缩放 */
export function applyUiZoom(percent: number): void {
  const root = document.documentElement
  const safe = clamp(percent, 50, 200, 100)
  if (safe === 100) root.style.removeProperty('zoom')
  else root.style.zoom = String(safe / 100)
}
