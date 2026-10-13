import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** 合并类名：后者覆盖前者的冲突工具类（供 ui 组件的 className  prop 可靠覆盖） */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
