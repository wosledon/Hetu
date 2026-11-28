import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // 组件化边界：交互控件只能来自 components/ui（见 AGENTS.md「组件化与样式来源」）
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/**'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: 'JSXOpeningElement[name.name=/^(button|input|textarea|select)$/]',
        message: '禁止直接写原生交互控件：请使用 components/ui 的 Button / IconButton / SurfaceButton / Input / Textarea / Checkbox / Slider 等封装（见 AGENTS.md 组件化准则）。',
      }],
    },
  },
  {
    // 第三方 UI 库只允许出现在包装层
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/components/ui/**',
      'src/utils/**',
      'src/components/ThemedMarkdown.tsx',
      'src/components/MilkdownEditor.tsx',
      'src/components/MermaidDiagram.tsx',
      'src/components/UsageHeatmap.tsx',
      'src/components/usage/**',
      'src/components/work/WorkTerminal.tsx',
      'src/components/workflow/**',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['echarts', 'echarts/*', 'echarts-for-react', 'echarts-for-react/*'], message: '图表库只能经 components/usage 包装层使用（见 AGENTS.md）。' },
          { group: ['@xyflow/react'], message: '流程图库只能经 components/workflow 包装层使用（见 AGENTS.md）。' },
          { group: ['milkdown', '@milkdown/*'], message: '编辑器只能经 MilkdownEditor 包装层使用（见 AGENTS.md）。' },
          { group: ['xterm', '@xterm/*'], message: '终端只能经 WorkTerminal 包装层使用（见 AGENTS.md）。' },
          { group: ['react-markdown', 'remark-*', 'rehype-*'], message: 'Markdown 渲染只能经 ThemedMarkdown 包装层使用（见 AGENTS.md）。' },
        ],
      }],
    },
  },
])
