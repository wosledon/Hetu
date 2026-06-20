import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: {
      '/api/graph/stream': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        // SSE 流式传输需要禁用缓冲
        configure: (proxy, _options) => {
          proxy.on('proxyRes', (proxyRes, _req, _res) => {
            // 禁用代理缓冲
            proxyRes.headers['x-accel-buffering'] = 'no'
            proxyRes.headers['cache-control'] = 'no-cache, no-transform'
            proxyRes.headers['connection'] = 'keep-alive'
          })
          proxy.on('proxyReq', (proxyReq, _req, _res) => {
            // 设置请求头以提示后端禁用缓冲
            proxyReq.setHeader('X-Accel-Buffering', 'no')
          })
        },
      },
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
