import { useCallback, useState } from 'react'

/** 树形列表统一的展开状态管理（Set 语义：有键即展开） */
export function useTreeExpanded(initial?: Iterable<string>) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initial))

  const isOpen = useCallback((key: string) => expanded.has(key), [expanded])

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const expand = useCallback((key: string) => {
    setExpanded((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
  }, [])

  const collapse = useCallback((key: string) => {
    setExpanded((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }, [])

  return { expanded, isOpen, toggle, expand, collapse, setExpanded }
}
