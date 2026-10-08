import React from 'react'

const TOOL_LABELS: Record<string, string> = {
  search_notes: '搜索笔记',
  read_note: '读取笔记',
  list_notes: '浏览笔记',
  create_note: '创建笔记',
  update_note: '更新笔记',
  delete_note: '删除笔记',
  move_note: '移动笔记',
  list_note_versions: '版本历史',
  restore_note_version: '恢复版本',
  list_notebooks: '笔记本列表',
  create_notebook: '创建笔记本',
  list_tags: '标签列表',
  set_note_tags: '设置标签',
  list_knowledge_items: '知识库列表',
  search_web: '网络搜索',
  search_memory: '搜索记忆',
  create_memory: '保存记忆',
  list_memories: '记忆列表',
  delete_memory: '删除记忆',
  search_graph: '搜索图谱',
  ask_question: '提问',
  todo: '任务管理',
  plan: '执行计划',
  run_command: '执行命令',
  create_scheduled_task: '创建定时任务',
  list_scheduled_tasks: '定时任务列表',
  delete_scheduled_task: '删除定时任务',
  list_skills: '技能列表',
}

export function renderToolName(name: string): string {
  return TOOL_LABELS[name] || name
}

/** 一次过程条目：工具调用 / 思考 / 工作流节点（折叠分组的最小单元） */
export interface ToolCallEntry {
  id?: string
  name: string
  args: string
  result?: string
  isError?: boolean
  /** 结果未到达即为执行中 */
  running?: boolean
  /** 条目类型，默认 tool；thought=思考，node=工作流节点 */
  kind?: 'tool' | 'thought' | 'node'
  /** thought / node 的正文内容 */
  text?: string
}

export type FoldedToolEntry<T> =
  | { kind: 'tool'; items: ToolCallEntry[] }
  | { kind: 'other'; item: T }

/**
 * 把有序序列折叠成展示项：两段输出之间的所有过程条目（工具调用、思考等）
 * 合并为同一个组（组内保序），文本输出原样穿插保留，并作为组的边界。
 */
export function foldConsecutiveToolCalls<T>(
  items: T[],
  isProcess: (item: T) => boolean,
  toEntry: (item: T) => ToolCallEntry,
): FoldedToolEntry<T>[] {
  const folded: FoldedToolEntry<T>[] = []
  for (const item of items) {
    if (isProcess(item)) {
      const last = folded[folded.length - 1]
      if (last && last.kind === 'tool') {
        last.items.push(toEntry(item))
        continue
      }
      folded.push({ kind: 'tool', items: [toEntry(item)] })
      continue
    }
    folded.push({ kind: 'other', item })
  }
  return folded
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