import { get, post, del } from './api'
import type { IWikiDocument } from '../types/wiki'

export const wikiService = {
  getAll: (projectId?: string) =>
    get<IWikiDocument[]>('/wiki', projectId ? { projectId } : undefined),
  getById: (id: string) => get<IWikiDocument>(`/wiki/${id}`),
  /** 为指定项目生成一篇 Wiki 文档（同步等待 LLM 产出，耗时较长） */
  generate: (projectId: string) => post<IWikiDocument>(`/wiki/projects/${projectId}/generate`),
  delete: (id: string) => del<void>(`/wiki/${id}`),
}
