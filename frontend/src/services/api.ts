import axios, { AxiosError } from 'axios';
import type { IApiResponse } from '../types';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<IApiResponse<unknown>>) => {
    const message = error.response?.data?.error || error.message || '请求失败';
    return Promise.reject(new Error(message));
  }
);

export async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const response = await api.get<IApiResponse<T>>(url, { params });
  if (!response.data.success) {
    throw new Error(response.data.error || '请求失败');
  }
  return response.data.data as T;
}

export async function post<T>(url: string, data?: unknown): Promise<T> {
  const response = await api.post<IApiResponse<T>>(url, data);
  if (!response.data.success) {
    throw new Error(response.data.error || '请求失败');
  }
  return response.data.data as T;
}

export async function put<T>(url: string, data?: unknown): Promise<T> {
  const response = await api.put<IApiResponse<T>>(url, data);
  if (!response.data.success) {
    throw new Error(response.data.error || '请求失败');
  }
  return response.data.data as T;
}

export async function del<T>(url: string): Promise<T> {
  const response = await api.delete<IApiResponse<T>>(url);
  if (!response.data.success) {
    throw new Error(response.data.error || '请求失败');
  }
  return response.data.data as T;
}

export default api;
