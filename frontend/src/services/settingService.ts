import { get, put, post } from './api';
import type { IAppSettingsSnapshot } from '../types';

export interface UpdateAppSettingRequest {
  key: string;
  value?: string;
}

export interface TestDatabaseRequest {
  provider: 'Sqlite' | 'Postgresql';
  connectionString: string;
}

export interface TestDatabaseResult {
  canConnect: boolean;
  vectorExtensionAvailable: boolean;
  message?: string;
}

export const settingService = {
  getSnapshot: () => get<IAppSettingsSnapshot>('/settings'),
  set: (data: UpdateAppSettingRequest) => put<void>('/settings', data),
  testDatabase: (data: TestDatabaseRequest) => post<TestDatabaseResult>('/settings/test-database', data),
};
