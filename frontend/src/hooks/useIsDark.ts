import { useUIStore } from '../stores/uiStore'

/// 当前是否为深色主题（system 跟随系统偏好）。
export function useIsDark(): boolean {
  const theme = useUIStore((s) => s.theme)
  return theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
}
