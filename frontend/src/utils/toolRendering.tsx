import React from 'react'

const TOOL_LABELS: Record<string, string> = {
  search_notes: '搜索笔记',
  read_note: '读取笔记',
  search_web: '网络搜索',
  search_memory: '搜索记忆',
  search_graph: '搜索图谱',
  create_note: '创建笔记',
  update_note: '更新笔记',
  create_memory: '保存记忆',
  ask_question: '提问',
  todo: '任务管理',
  run_command: '执行命令',
}

export function renderToolName(name: string): string {
  return TOOL_LABELS[name] || name
}

export function renderToolResult(_name: string, content: string, isError?: boolean): React.ReactNode {
  if (isError) {
    return <span className="text-[11px]">{content}</span>
  }
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return <span className="text-[11px]">无结果</span>
      return (
        <div className="space-y-1">
          {parsed.slice(0, 5).map((item: Record<string, unknown>, idx: number) => {
            const title = item.title ? String(item.title) : ''
            const name = item.name ? String(item.name) : ''
            const content = item.content ? String(item.content) : ''
            const snippet = item.snippet ? String(item.snippet) : ''
            const id = item.id ? String(item.id) : ''
            return (
              <div key={idx} className="text-[11px] leading-relaxed">
                <span className="font-medium">{idx + 1}. </span>
                {title && <span className="font-medium">{title}</span>}
                {!title && name && <span className="font-medium">{name}</span>}
                {content && <span> — {content.slice(0, 80)}{content.length > 80 ? '...' : ''}</span>}
                {!content && snippet && <span className="text-gray-500 dark:text-gray-400"> — {snippet.slice(0, 80)}</span>}
                {!title && !name && !content && id && <span>{id}</span>}
              </div>
            )
          })}
          {parsed.length > 5 && <span className="text-[10px] text-gray-400">...共 {parsed.length} 条结果</span>}
        </div>
      )
    }
    if (parsed && typeof parsed === 'object') {
      return (
        <div className="space-y-0.5 text-[11px]">
          {Object.entries(parsed as Record<string, unknown>).slice(0, 6).map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <span className="font-medium shrink-0">{key}:</span>
              <span className="text-gray-600 dark:text-gray-400 truncate">{String(value).slice(0, 100)}</span>
            </div>
          ))}
        </div>
      )
    }
  } catch {
    // Not JSON, show as plain text
  }
  return <span className="whitespace-pre-wrap break-words text-[11px]">{content.length > 500 ? content.slice(0, 500) + '...' : content}</span>
}