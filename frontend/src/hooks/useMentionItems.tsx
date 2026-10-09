import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AtSign, Library, NotebookPen, Tag } from 'lucide-react'
import { searchService } from '../services/searchService'
import { noteService } from '../services/noteService'
import { tagService } from '../services/tagService'
import { knowledgeItemService } from '../services/knowledgeBaseService'
import { useNotebooks } from './useNotebooks'
import type { InputCommandItem } from '../components/InputCommandMenu'
import type { INotebook } from '../types'

const flattenNotebooks = (list: INotebook[]): INotebook[] =>
  list.flatMap((nb) => [nb, ...flattenNotebooks(nb.children ?? [])])

/**
 * 输入框 @ 引用候选项（笔记 / 笔记本 / 标签 / 知识库），对话与 Code 会话共用。
 * query 为 null 表示浮层未打开，不触发检索。
 */
export function useMentionItems(query: string | null): InputCommandItem[] {
  const [noteCandidates, setNoteCandidates] = useState<{ id: string; title: string }[]>([])
  const notebooks = useNotebooks()

  const { data: tags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: () => tagService.getAll(),
  })
  const { data: knowledgeItems = [] } = useQuery({
    queryKey: ['knowledgeItems'],
    queryFn: () => knowledgeItemService.getList(),
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (query === null) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const result = query.trim()
          ? await searchService.searchNotes({ keyword: query.trim(), page: 1, pageSize: 8 })
          : await noteService.getList({ page: 1, pageSize: 8, includeDeleted: false })
        if (!cancelled) setNoteCandidates(result.items.map((n) => ({ id: n.id, title: n.title })))
      } catch {
        if (!cancelled) setNoteCandidates([])
      }
    }, 200)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query])

  return useMemo(() => {
    if (query === null) return []
    const q = query.trim().toLowerCase()
    const items: InputCommandItem[] = []

    for (const n of noteCandidates) {
      if (q && !n.title.toLowerCase().includes(q)) continue
      items.push({
        key: `note:${n.id}`,
        label: n.title || '（无标题）',
        description: '笔记',
        icon: <AtSign size={14} className="text-amber-500" />,
        tag: '笔记',
        tagClass: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
      })
    }

    for (const nb of flattenNotebooks(notebooks)) {
      if (q && !nb.name.toLowerCase().includes(q)) continue
      items.push({
        key: `notebook:${nb.id}`,
        label: nb.name,
        description: '笔记本',
        icon: <NotebookPen size={14} className="text-blue-500" />,
        tag: '笔记本',
        tagClass: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
      })
    }

    for (const t of tags as Array<{ id: string; name: string; noteCount?: number }>) {
      if (q && !t.name.toLowerCase().includes(q)) continue
      items.push({
        key: `tag:${t.id}`,
        label: t.name,
        description: `标签 · ${t.noteCount ?? 0} 篇笔记`,
        icon: <Tag size={14} className="text-emerald-500" />,
        tag: '标签',
        tagClass: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
      })
    }

    for (const k of knowledgeItems as Array<{ id: string; title: string; type?: string }>) {
      if (q && !k.title.toLowerCase().includes(q)) continue
      items.push({
        key: `knowledge:${k.id}`,
        label: k.title,
        description: '知识库',
        icon: <Library size={14} className="text-violet-500" />,
        tag: '知识库',
        tagClass: 'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400',
      })
    }

    return items.slice(0, 20)
  }, [query, noteCandidates, notebooks, tags, knowledgeItems])
}
