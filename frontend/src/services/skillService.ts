import { get, post, put, del } from './api';
import type { ISkill } from '../types';

export interface CreateSkillRequest {
  name: string;
  description: string;
  category: string;
  config?: string;
}

export interface UpdateSkillRequest {
  name: string;
  description: string;
  category: string;
  isEnabled: boolean;
  config?: string;
  sortOrder: number;
}

export interface InvokeSkillRequest {
  input: string;
}

export interface ILocalSkill {
  id: string;
  name: string;
  description: string;
  category: string;
  isEnabled: boolean;
  config?: string;
  filePath: string;
  source: string;
}

export const skillService = {
  getAll: () => get<ISkill[]>('/skills'),
  getById: (id: string) => get<ISkill>(`/skills/${id}`),
  create: (data: CreateSkillRequest) => post<ISkill>('/skills', data),
  update: (id: string, data: UpdateSkillRequest) => put<ISkill>(`/skills/${id}`, data),
  delete: (id: string) => del<void>(`/skills/${id}`),
  invoke: (nameOrId: string, data: InvokeSkillRequest) => post<string>(`/skills/${nameOrId}/invoke`, data),
  getLocalSkills: () => get<ILocalSkill[]>('/skills/local'),
  getSkillDirectories: () => get<string[]>('/skills/directories'),
  updateSkillDirectories: (directories: string[]) => put<void>('/skills/directories', directories),
};
