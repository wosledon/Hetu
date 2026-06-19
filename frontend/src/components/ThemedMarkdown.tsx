import { useEffect, useState } from 'react'
import MDEditor from '@uiw/react-md-editor'
import { useUIStore } from '../stores/uiStore'

type ColorMode = 'light' | 'dark'

function useResolvedColorMode(): ColorMode {
  const theme = useUIStore((state) => state.theme)
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  )

  useEffect(() => {
    if (theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [theme])

  if (theme === 'system') return systemDark ? 'dark' : 'light'
  return theme
}

interface ThemedMarkdownProps {
  source: string
  className?: string
}

/**
 * 跟随应用主题的 Markdown 渲染组件。
 * 通过 data-color-mode 让 @uiw/react-md-editor 的内部样式（背景、代码块、表格等）
 * 与 Tailwind 的 .dark 类切换保持一致，避免预览背景在亮色模式下显示为黑色。
 */
export default function ThemedMarkdown({ source, className }: ThemedMarkdownProps) {
  const colorMode = useResolvedColorMode()
  return (
    <div data-color-mode={colorMode} className={className}>
      <MDEditor.Markdown source={source} />
    </div>
  )
}
