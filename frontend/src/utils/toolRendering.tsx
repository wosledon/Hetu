import React from 'react'
import i18n from '../i18n'

/** 工具名 → 界面展示名：文案表在 locales 的 toolNames 命名空间（键=后端工具名，未知工具回退原始名） */
export function renderToolName(name: string): string {
  const key = `toolNames:${name}`
  return i18n.exists(key) ? i18n.t(key) : name
}

/**
 * 工具分组名由后端下发（ToolGroupMap 的中文值，同时是 load_tools 的分组标识），
 * 这里只做展示层翻译：未知分组回退原值。
 */
const TOOL_GROUP_KEYS: Record<string, string> = {
  通用: 'general',
  笔记: 'notes',
  笔记本: 'notebooks',
  标签: 'tags',
  知识库: 'knowledge',
  知识图谱: 'graph',
  记忆: 'memories',
  联网: 'web',
  项目: 'projects',
  任务看板: 'kanban',
  工作流: 'workflows',
  智能体: 'agents',
  技能: 'skills',
  定时任务: 'scheduled',
  收件箱: 'inbox',
  用量: 'usage',
  Wiki: 'wiki',
  工作区与命令: 'workspace',
  其他: 'other',
}

export function renderToolGroup(group: string): string {
  const key = TOOL_GROUP_KEYS[group]
  return key ? i18n.t(`toolGroups:${key}`) : group
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
      if (parsed.length === 0) return <span className="text-[11px]">{i18n.t('ui:toolResult.noResult')}</span>
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
          {parsed.length > 5 && <span className="text-[10px] text-gray-400">{i18n.t('ui:toolResult.totalResults', { count: parsed.length })}</span>}
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
