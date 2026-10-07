import { get, post, put, del } from './api';
import type {
  IManagedProject,
  ICreateProjectRequest,
  IUpdateProjectRequest,
  IProjectGroup,
  ICreateProjectGroupRequest,
  IUpdateProjectGroupRequest,
  IProjectSortItem,
} from '../types/project';

export const projectService = {
  getAll: () => get<IManagedProject[]>('/projects'),
  getById: (id: string) => get<IManagedProject>(`/projects/${id}`),
  create: (data: ICreateProjectRequest) => post<IManagedProject>('/projects', data),
  update: (id: string, data: IUpdateProjectRequest) => put<IManagedProject>(`/projects/${id}`, data),
  delete: (id: string) => del<void>(`/projects/${id}`),
  /** 批量保存拖拽后的排序 */
  sort: (items: IProjectSortItem[]) => post<void>('/projects/sorts', { items }),
  /** 在系统文件管理器中打开本地项目目录 */
  open: (id: string) => post<string>(`/projects/${id}/open`),
};

export const projectGroupService = {
  getAll: () => get<IProjectGroup[]>('/project-groups'),
  create: (data: ICreateProjectGroupRequest) => post<IProjectGroup>('/project-groups', data),
  update: (id: string, data: IUpdateProjectGroupRequest) => put<IProjectGroup>(`/project-groups/${id}`, data),
  delete: (id: string) => del<void>(`/project-groups/${id}`),
};
