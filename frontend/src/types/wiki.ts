/** 项目 Wiki 页面：AI 依据项目本地目录资料生成，一套含总览与多个主题页 */
export interface IWikiDocument {
  id: string
  projectId: string
  projectName: string
  /** 所属 Wiki 套件 ID（一次生成的所有页面共享） */
  setId: string
  /** 套件内排序：0 为总览页 */
  sortOrder: number
  title: string
  content: string
  createdAt: string
  updatedAt: string
}
