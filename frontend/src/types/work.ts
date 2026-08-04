export interface IWorkProject {
  id: string;
  name: string;
  rootPath: string;
  description?: string;
  icon?: string;
  color?: string;
  sortOrder: number;
  sessionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface IWorkSession {
  id: string;
  projectId: string;
  title: string;
  modelId?: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export type WorkMessageType = 'text' | 'file_change' | 'subagent' | 'tool' | 'system';

export interface IWorkMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  type: WorkMessageType;
  metadata?: string;
  modelId?: string;
  createdAt: string;
}

export interface IWorkFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: string;
}

export interface IWorkFileContent {
  path: string;
  name: string;
  size: number;
  isBinary: boolean;
  content?: string;
  modifiedAt?: string;
}

export interface IWorkFileChange {
  id: string;
  projectId: string;
  sessionId?: string;
  filePath: string;
  oldContent?: string;
  newContent: string;
  action: 'write' | 'create';
  createdAt: string;
}

export interface ICreateWorkProjectRequest {
  name: string;
  rootPath: string;
  description?: string;
  icon?: string;
  color?: string;
}

export interface IUpdateWorkProjectRequest {
  name: string;
  rootPath: string;
  description?: string;
  icon?: string;
  color?: string;
  sortOrder: number;
}

export interface ICreateWorkSessionRequest {
  projectId: string;
  title: string;
  modelId?: string;
}

export interface IUpdateWorkSessionRequest {
  title: string;
  modelId?: string;
}
