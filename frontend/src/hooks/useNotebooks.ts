import { useQuery } from '@tanstack/react-query'
import { notebookService } from '../services/notebookService'
import type { INotebook } from '../types'

/// 笔记本树查询：共用同一份缓存，并统一用空数组兜底，调用方无需再写 `?? []`。
export function useNotebooks(enabled = true): INotebook[] {
  const { data } = useQuery({
    queryKey: ['notebooks'],
    queryFn: () => notebookService.getTree(),
    enabled,
  })
  return data ?? []
}
