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

export function renderToolResult(name: string, content: string, isError?: boolean): React.ReactNode {
  if (isError) {
    return <span className="text-[11px]">{content}</span>
  }
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return <span className="text-[11px]">无结果</span>
      return (
        <div className="space-y-1">
          {parsed.slice(0, 5).map((item: Record<string, unknown>, idx: number) => (
            <div key={idx} className="text-[11px] leading-relaxed">
              <span className="font-medium">{idx + 1}. </span>
              {item.title && <span className="font-medium">{String(item.title)}</span>}
              {item.name && !item.title && <span className="font-medium">{String(item.name)}</span>}
              {item.content && <span> — {String(item.content).slice(0, 80)}{String(item.content).length > 80 ? '...' : ''}</span>}
              {item.snippet && !item.content && <span className="text-gray-500 dark:text-gray-400"> — {String(item.snippet).slice(0, 80)}</span>}
              {item.id && !item.title && !item.name && !item.content && <span>{String(item.id)}</span>}
            </div>
          ))}
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