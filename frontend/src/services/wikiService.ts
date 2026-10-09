import api, { get, post, del } from './api'
import type { IWikiDocument, IWikiSet, IWikiGenerationJob } from '../types/wiki'

export const wikiService = {
  getAll: (projectId?: string) =>
    get<IWikiDocument[]>('/wiki', projectId ? { projectId } : undefined),
  /** Wiki 套件列表（含过期状态与页面清单） */
  getSets: (projectId?: string) =>
    get<IWikiSet[]>('/wiki/sets', projectId ? { projectId } : undefined),
  getById: (id: string) => get<IWikiDocument>(`/wiki/${id}`),
  /** 入队生成；modelId 为空时用默认补全模型 */
  generate: (projectId: string, modelId?: string) =>
    post<IWikiGenerationJob>(`/wiki/projects/${projectId}/generate`, { modelId }),
  getJobs: (projectId?: string) =>
    get<IWikiGenerationJob[]>('/wiki/jobs', projectId ? { projectId } : undefined),
  getJob: (id: string) => get<IWikiGenerationJob>(`/wiki/jobs/${id}`),
  /** 用最新项目资料重生成单页 */
  regenerate: (id: string) => post<IWikiDocument>(`/wiki/${id}/regenerate`),
  /** 导出一套 Wiki 为 zip */
  exportSet: (setId: string) =>
    api.get<Blob>(`/wiki/sets/${setId}/export`, { responseType: 'blob' }).then((response) => response.data),
  delete: (id: string) => del<void>(`/wiki/${id}`),
}
