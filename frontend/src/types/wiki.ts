/** 项目 Wiki 页面：AI 依据项目本地/远端目录资料生成，一套含总览与多个主题页 */
export interface IWikiDocument {
  id: string
  projectId: string
  projectName: string
  /** 所属 Wiki 套件 ID（一次生成的所有页面共享） */
  setId: string
  /** 套件内排序：0 为总览页 */
  sortOrder: number
  title: string
  /** 规划阶段确定的内容要点 */
  brief?: string
  content: string
  createdAt: string
  updatedAt: string
}

/** Wiki 套件：一次生成的总览 + 主题页 */
export interface IWikiSet {
  setId: string
  projectId: string
  projectName: string
  title: string
  pageCount: number
  createdAt: string
  /** 生成后项目文件又发生过变更，内容可能已过期 */
  isStale: boolean
  /** 生成后被修改或新增的文件数 */
  staleFileCount: number
  pages: IWikiSetPage[]
}

export interface IWikiSetPage {
  id: string
  title: string
  sortOrder: number
}

/** Wiki 生成任务进度：0=排队中 1=生成中 2=已完成 3=失败 */
export interface IWikiGenerationJob {
  id: string
  projectId: string
  projectName: string
  status: 0 | 1 | 2 | 3
  stage: string
  progress: number
  totalPages: number
  donePages: number
  errorMessage?: string
  modelId?: string
  setId?: string
  createdAt: string
  completedAt?: string
}
