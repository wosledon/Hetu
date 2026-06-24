import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { queryClient } from './utils/queryClient'
import { useTheme } from './utils/theme'
import App from './App'
import './index.css'
import 'katex/dist/katex.min.css'

// 抑制 ResizeObserver 循环告警（ReactFlow/dagre 等布局组件触发的良性警告）
const roLoopMsg = 'ResizeObserver loop completed with undelivered notifications.'
window.addEventListener('error', (e) => {
  if (e.message === roLoopMsg) {
    e.stopImmediatePropagation()
    e.preventDefault()
  }
}, true)
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.message === roLoopMsg) e.preventDefault()
})

// eslint-disable-next-line react-refresh/only-export-components
function ThemedApp() {
  useTheme()
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemedApp />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
