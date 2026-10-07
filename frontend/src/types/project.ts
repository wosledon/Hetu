/** 项目类型：Local 本地目录 / Ssh 远程目录 */
export type ProjectType = 'Local' | 'Ssh'

/** 目录筛选条件：全部 / 指定分组 / 未分组 / 分类 / 标签 */
export interface IProjectFilter {
  type: 'all' | 'group' | 'ungrouped' | 'category' | 'tag'
  id?: string
}

export interface IProjectGroup {
  id: string
  name: string
  description?: string
  sortOrder: number
  projectCount: number
  createdAt: string
  updatedAt: string
}

export interface IManagedProject {
  id: string
  name: string
  description?: string
  projectType: ProjectType
  directoryPath: string
  sshHost?: string
  sshPort: number
  sshUser?: string
  /** Key | Password | Agent */
  sshAuthType: string
  sshKeyPath?: string
  hasSshPassword: boolean
  /** 所属分组 ID；为空表示未分组 */
  groupId?: string
  groupName?: string
  category?: string
  tags: string[]
  isPinned: boolean
  sortOrder: number
  /** 关联的 Code 工作区项目 ID；为空表示尚未与 Code 互通 */
  workProjectId?: string
  lastOpenedAt?: string
  createdAt: string
  updatedAt: string
}

export interface ICreateProjectRequest {
  name: string
  description?: string
  projectType: ProjectType
  directoryPath: string
  sshHost?: string
  sshPort?: number
  sshUser?: string
  sshAuthType?: string
  sshKeyPath?: string
  sshPassword?: string
  groupId?: string
  category?: string
  tags?: string[]
}

export interface IUpdateProjectRequest extends ICreateProjectRequest {
  isPinned?: boolean
  sortOrder: number
}

export interface IProjectSortItem {
  id: string
  sortOrder: number
}

export interface ICreateProjectGroupRequest {
  name: string
  description?: string
}

export interface IUpdateProjectGroupRequest {
  name: string
  description?: string
  sortOrder: number
}
