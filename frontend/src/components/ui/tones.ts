/** 组件 tone（品牌色）取值。类名必须是完整静态字符串，Tailwind 才能扫描到，
 *  因此这里全部用查表而不是 `bg-${tone}-500` 这类动态拼接。 */
export type Tone =
  | 'blue' | 'indigo' | 'violet' | 'emerald' | 'green' | 'teal' | 'cyan' | 'sky' | 'amber' | 'rose' | 'red' | 'gray'

/** 实色底（主按钮 / 图标主按钮） */
export const SOLID: Record<Tone, string> = {
  blue: 'bg-blue-500 hover:bg-blue-600',
  indigo: 'bg-indigo-500 hover:bg-indigo-600',
  violet: 'bg-violet-500 hover:bg-violet-600',
  emerald: 'bg-emerald-500 hover:bg-emerald-600',
  green: 'bg-green-500 hover:bg-green-600',
  teal: 'bg-teal-500 hover:bg-teal-600',
  cyan: 'bg-cyan-500 hover:bg-cyan-600',
  sky: 'bg-sky-500 hover:bg-sky-600',
  amber: 'bg-amber-500 hover:bg-amber-600',
  rose: 'bg-rose-500 hover:bg-rose-600',
  red: 'bg-red-500 hover:bg-red-600',
  gray: 'bg-gray-500 hover:bg-gray-600',
}

/** 浅色底 + 同色文字（soft 按钮 / 图标 soft 按钮） */
export const SOFT: Record<Tone, string> = {
  blue: 'bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/20',
  indigo: 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/20',
  violet: 'bg-violet-50 text-violet-600 hover:bg-violet-100 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20',
  emerald: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20',
  green: 'bg-green-50 text-green-600 hover:bg-green-100 dark:bg-green-500/10 dark:text-green-300 dark:hover:bg-green-500/20',
  teal: 'bg-teal-50 text-teal-600 hover:bg-teal-100 dark:bg-teal-500/10 dark:text-teal-300 dark:hover:bg-teal-500/20',
  cyan: 'bg-cyan-50 text-cyan-600 hover:bg-cyan-100 dark:bg-cyan-500/10 dark:text-cyan-300 dark:hover:bg-cyan-500/20',
  sky: 'bg-sky-50 text-sky-600 hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/20',
  amber: 'bg-amber-50 text-amber-600 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20',
  rose: 'bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20',
  red: 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20',
  gray: 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]',
}

/** 描边 + 同色文字（outline 按钮） */
export const OUTLINE: Record<Tone, string> = {
  blue: 'border border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-500/30 dark:text-blue-300 dark:hover:bg-blue-950/40',
  indigo: 'border border-indigo-200 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-500/30 dark:text-indigo-300 dark:hover:bg-indigo-950/40',
  violet: 'border border-violet-200 text-violet-600 hover:bg-violet-50 dark:border-violet-500/30 dark:text-violet-300 dark:hover:bg-violet-950/40',
  emerald: 'border border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-950/40',
  green: 'border border-green-200 text-green-600 hover:bg-green-50 dark:border-green-500/30 dark:text-green-300 dark:hover:bg-green-950/40',
  teal: 'border border-teal-200 text-teal-600 hover:bg-teal-50 dark:border-teal-500/30 dark:text-teal-300 dark:hover:bg-teal-950/40',
  cyan: 'border border-cyan-200 text-cyan-600 hover:bg-cyan-50 dark:border-cyan-500/30 dark:text-cyan-300 dark:hover:bg-cyan-950/40',
  sky: 'border border-sky-200 text-sky-600 hover:bg-sky-50 dark:border-sky-500/30 dark:text-sky-300 dark:hover:bg-sky-950/40',
  amber: 'border border-amber-200 text-amber-600 hover:bg-amber-50 dark:border-amber-500/30 dark:text-amber-300 dark:hover:bg-amber-950/40',
  rose: 'border border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-950/40',
  red: 'border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-950/40',
  gray: 'border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-white/[0.06]',
}

/** 同色文字（link 按钮） */
export const LINK: Record<Tone, string> = {
  blue: 'text-blue-500 hover:text-blue-600 dark:text-blue-400',
  indigo: 'text-indigo-500 hover:text-indigo-600 dark:text-indigo-400',
  violet: 'text-violet-500 hover:text-violet-600 dark:text-violet-400',
  emerald: 'text-emerald-500 hover:text-emerald-600 dark:text-emerald-400',
  green: 'text-green-500 hover:text-green-600 dark:text-green-400',
  teal: 'text-teal-500 hover:text-teal-600 dark:text-teal-400',
  cyan: 'text-cyan-500 hover:text-cyan-600 dark:text-cyan-400',
  sky: 'text-sky-500 hover:text-sky-600 dark:text-sky-400',
  amber: 'text-amber-500 hover:text-amber-600 dark:text-amber-400',
  rose: 'text-rose-500 hover:text-rose-600 dark:text-rose-400',
  red: 'text-red-500 hover:text-red-600 dark:text-red-400',
  gray: 'text-gray-500 hover:text-gray-600 dark:text-gray-400',
}

/** 无底文字按钮 + 同色悬停底（ghost tone 按钮） */
export const GHOST: Record<Tone, string> = {
  blue: 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10',
  indigo: 'text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10',
  violet: 'text-violet-600 hover:bg-violet-50 dark:text-violet-400 dark:hover:bg-violet-500/10',
  emerald: 'text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10',
  green: 'text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-500/10',
  teal: 'text-teal-600 hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-500/10',
  cyan: 'text-cyan-600 hover:bg-cyan-50 dark:text-cyan-400 dark:hover:bg-cyan-500/10',
  sky: 'text-sky-600 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10',
  amber: 'text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-500/10',
  rose: 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10',
  red: 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10',
  gray: 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]',
}

/** 输入框聚焦描边 / 光环（亮色） */
export const FOCUS_LIGHT: Record<Tone, string> = {
  blue: 'focus:border-blue-400 focus:ring-blue-500/10',
  indigo: 'focus:border-indigo-400 focus:ring-indigo-500/10',
  violet: 'focus:border-violet-400 focus:ring-violet-500/10',
  emerald: 'focus:border-emerald-400 focus:ring-emerald-500/10',
  green: 'focus:border-green-400 focus:ring-green-500/10',
  teal: 'focus:border-teal-400 focus:ring-teal-500/10',
  cyan: 'focus:border-cyan-400 focus:ring-cyan-500/10',
  sky: 'focus:border-sky-400 focus:ring-sky-500/10',
  amber: 'focus:border-amber-400 focus:ring-amber-500/10',
  rose: 'focus:border-rose-400 focus:ring-rose-500/10',
  red: 'focus:border-red-400 focus:ring-red-500/10',
  gray: 'focus:border-gray-400 focus:ring-gray-500/10',
}

/** 输入框聚焦描边 / 光环（暗色） */
export const FOCUS_DARK: Record<Tone, string> = {
  blue: 'dark:focus:border-blue-500 dark:focus:ring-blue-500/20',
  indigo: 'dark:focus:border-indigo-500 dark:focus:ring-indigo-500/20',
  violet: 'dark:focus:border-violet-500 dark:focus:ring-violet-500/20',
  emerald: 'dark:focus:border-emerald-500 dark:focus:ring-emerald-500/20',
  green: 'dark:focus:border-green-500 dark:focus:ring-green-500/20',
  teal: 'dark:focus:border-teal-500 dark:focus:ring-teal-500/20',
  cyan: 'dark:focus:border-cyan-500 dark:focus:ring-cyan-500/20',
  sky: 'dark:focus:border-sky-500 dark:focus:ring-sky-500/20',
  amber: 'dark:focus:border-amber-500 dark:focus:ring-amber-500/20',
  rose: 'dark:focus:border-rose-500 dark:focus:ring-rose-500/20',
  red: 'dark:focus:border-red-500 dark:focus:ring-red-500/20',
  gray: 'dark:focus:border-gray-500 dark:focus:ring-gray-500/20',
}
