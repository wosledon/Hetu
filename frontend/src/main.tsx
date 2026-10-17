import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { queryClient } from './utils/queryClient'
import { useTheme } from './utils/theme'
import App from './App'
import { ConfirmProvider } from './components/ConfirmDialog'
import { startUiSignalR } from './services/signalrService'
import './i18n'
import './index.css'
// KaTeX 的 CSS（约 51 kB + 20 个 font-face）原先在这里静态引入，等于每个页面都为
// 极少出现的公式付费。改成由 ThemedMarkdown 在检测到公式时按需加载。

// 抑制 ResizeObserver 循环告警（ReactFlow/dagre 等布局组件触发的良性警告）
const roLoopMsg = 'ResizeObserver loop completed with undelivered notifications.'
window.addEventListener('error', (e) => {
  if (e.message === roLoopMsg) {
    e.stopImmediatePropagation()
    e.preventDefault()
  }
}, true)

// 后端主动推送通道（SignalR）：连接后可被智能体唤起面板等事件触发
void startUiSignalR()
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
        <ConfirmProvider>
          <ThemedApp />
        </ConfirmProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
