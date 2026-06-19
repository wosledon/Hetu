import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { queryClient } from './utils/queryClient'
import { useTheme } from './utils/theme'
import App from './App'
import './index.css'

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
