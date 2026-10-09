import { get } from './api';

/** 内置工具目录项 */
export interface IToolCatalogItem {
  name: string;
  description: string;
  usageGuideline?: string;
  /** read（只读）/ write（写入）/ execute（执行命令） */
  risk: 'read' | 'write' | 'execute';
  /** auto（直接执行）/ ask（需确认）/ bypass */
  defaultApproval: 'auto' | 'ask' | 'bypass';
  group: string;
  /** knowledge（对话/知识助手）/ work（Code）/ desktop（桌面 Agent）/ cowork（协作助手） */
  profiles: string[];
  parametersSchema?: string;
}

export const toolService = {
  getAll: () => get<IToolCatalogItem[]>('/tools'),
};
