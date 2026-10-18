/** 内置常用 MCP 预设：只提供配置模板，点击后填入表单，由用户确认/改路径后再保存 */

export type McpPresetRequirement = 'node' | 'uv' | 'path' | 'token'

export interface McpPreset {
  id: string
  nameKey: string
  descKey: string
  /** 启动命令里可执行文件的展示文本 */
  binary: string
  /** 运行前置条件，用于在卡片上提示 */
  requires: McpPresetRequirement[]
  connectionConfig: string
}

const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

/** Windows 下 npx 是 .cmd，ProcessStartInfo 不会自动解析，需要走 cmd /c */
function npx(args: string[], env: Record<string, string> = {}) {
  return JSON.stringify(
    isWindows
      ? { command: 'cmd', args: ['/c', 'npx', ...args], env }
      : { command: 'npx', args, env },
    null,
    2,
  )
}

function uvx(args: string[]) {
  return JSON.stringify({ command: 'uvx', args, env: {} }, null, 2)
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'filesystem',
    nameKey: 'mcpPresets.filesystem.name',
    descKey: 'mcpPresets.filesystem.desc',
    binary: 'npx @modelcontextprotocol/server-filesystem',
    requires: ['node', 'path'],
    connectionConfig: npx(['-y', '@modelcontextprotocol/server-filesystem', '<path>']),
  },
  {
    id: 'git',
    nameKey: 'mcpPresets.git.name',
    descKey: 'mcpPresets.git.desc',
    binary: 'uvx mcp-server-git',
    requires: ['uv', 'path'],
    connectionConfig: uvx(['mcp-server-git', '--repository', '<path>']),
  },
  {
    id: 'fetch',
    nameKey: 'mcpPresets.fetch.name',
    descKey: 'mcpPresets.fetch.desc',
    binary: 'uvx mcp-server-fetch',
    requires: ['uv'],
    connectionConfig: uvx(['mcp-server-fetch']),
  },
  {
    id: 'memory',
    nameKey: 'mcpPresets.memory.name',
    descKey: 'mcpPresets.memory.desc',
    binary: 'npx @modelcontextprotocol/server-memory',
    requires: ['node'],
    connectionConfig: npx(['-y', '@modelcontextprotocol/server-memory']),
  },
  {
    id: 'sequential-thinking',
    nameKey: 'mcpPresets.sequentialThinking.name',
    descKey: 'mcpPresets.sequentialThinking.desc',
    binary: 'npx @modelcontextprotocol/server-sequential-thinking',
    requires: ['node'],
    connectionConfig: npx(['-y', '@modelcontextprotocol/server-sequential-thinking']),
  },
  {
    id: 'playwright',
    nameKey: 'mcpPresets.playwright.name',
    descKey: 'mcpPresets.playwright.desc',
    binary: 'npx @playwright/mcp',
    requires: ['node'],
    connectionConfig: npx(['@playwright/mcp@latest']),
  },
  {
    id: 'github',
    nameKey: 'mcpPresets.github.name',
    descKey: 'mcpPresets.github.desc',
    binary: 'npx @modelcontextprotocol/server-github',
    requires: ['node', 'token'],
    connectionConfig: npx(['-y', '@modelcontextprotocol/server-github'], {
      GITHUB_PERSONAL_ACCESS_TOKEN: '<token>',
    }),
  },
  {
    id: 'context7',
    nameKey: 'mcpPresets.context7.name',
    descKey: 'mcpPresets.context7.desc',
    binary: 'npx @upstash/context7-mcp',
    requires: ['node'],
    connectionConfig: npx(['-y', '@upstash/context7-mcp']),
  },
]
