import { get } from './api';

export interface IFsEntry {
  name: string;
  path: string;
}

export interface IFsDirs {
  current: string;
  parent: string | null;
  dirs: IFsEntry[];
}

/** 系统能力服务：本地文件系统目录浏览（前端目录选择器用） */
export const systemService = {
  /** path 为空时返回驱动器/根列表 */
  listDirs: (path?: string) => get<IFsDirs>('/system/fs/dirs', { path }),
};
