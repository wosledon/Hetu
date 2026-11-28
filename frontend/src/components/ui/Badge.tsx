import type { ReactNode } from 'react'
import { cn } from '../../utils/cn'

export type BadgeTone = 'blue' | 'indigo' | 'violet' | 'emerald' | 'green' | 'amber' | 'rose' | 'red' | 'gray' | 'sky'

const SOFT: Record<BadgeTone, string> = {
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
  indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
  green: 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
  red: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300',
  gray: 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400',
  sky: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300',
}

const DOT: Record<BadgeTone, string> = {
  blue: 'bg-blue-500', indigo: 'bg-indigo-500', violet: 'bg-violet-500',
  emerald: 'bg-emerald-500', green: 'bg-green-500', amber: 'bg-amber-500',
  rose: 'bg-rose-500', red: 'bg-red-500', gray: 'bg-gray-400', sky: 'bg-sky-500',
}

const SIZES = {
  sm: 'px-1.5 py-0.5 text-[10px] rounded',
  md: 'px-2 py-0.5 text-[11px] rounded-full',
} as const

export interface BadgeProps {
  tone?: BadgeTone
  size?: 'sm' | 'md'
  /** 前置状态圆点（运行中 / 失败 / 空闲…） */
  dot?: boolean
  /** 全大写徽标（NEW / BETA） */
  uppercase?: boolean
  icon?: ReactNode
  className?: string
  children: ReactNode
}

/** 统一徽标/状态胶囊：底、字色、圆点只在这里维护 */
export default function Badge({ tone = 'gray', size = 'sm', dot = false, uppercase = false, icon, className, children }: BadgeProps) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 font-semibold', SIZES[size], SOFT[tone], className)}>
      {dot && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[tone])} aria-hidden />}
      {icon}
      <span className={cn(uppercase && 'uppercase tracking-wide')}>{children}</span>
    </span>
  )
}