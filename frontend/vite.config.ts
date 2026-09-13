import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    assetsDir: '',
    // 实测 rolldown 默认分包（路由级懒加载）初始 JS 约 267KB；显式 vendor 分组反而会把
    // 整组依赖挂到入口（1.4MB），故不分组。剩余超 500KB 的 chunk 均为按需加载的页面级 chunk
    // （MarkdownEditor 1.05MB、UsagePage 620KB 已按需引入 echarts）与 mermaid 单模块布局包
    // （flowchart-elk 1.44MB，单文件无法再拆，仅在文档含对应图表时才下载），故放宽阈值。
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5174,
    proxy: {
      '/api/graph/stream': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        // SSE 流式传输需要禁用缓冲
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            // 禁用代理缓冲
            proxyRes.headers['x-accel-buffering'] = 'no'
            proxyRes.headers['cache-control'] = 'no-cache, no-transform'
            proxyRes.headers['connection'] = 'keep-alive'
          })
          proxy.on('proxyReq', (proxyReq) => {
            // 设置请求头以提示后端禁用缓冲
            proxyReq.setHeader('X-Accel-Buffering', 'no')
          })
        },
      },
      // 工作终端 WebSocket：必须排在 /api 之前，否则会被 http 代理拦截导致握手失败
      '/api/work-terminal': {
        target: 'ws://localhost:5000',
        changeOrigin: true,
        ws: true,
      },
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
