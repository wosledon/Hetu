import axios, { AxiosError } from 'axios';
import i18n from '../i18n';
import type { IApiResponse } from '../types';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// 后端按 Accept-Language 本地化提示文案（zh / en）
api.interceptors.request.use((config) => {
  config.headers.set('Accept-Language', i18n.language === 'en' ? 'en' : 'zh-CN');
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<IApiResponse<unknown>>) => {
    const message = error.response?.data?.error || error.message || i18n.t('common:requestFailed');
    return Promise.reject(new Error(message));
  }
);

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** 解包统一响应格式，业务失败时抛出 Error。 */
async function request<T>(
  method: HttpMethod,
  url: string,
  options: { params?: Record<string, unknown>; data?: unknown } = {}
): Promise<T> {
  const response = await api.request<IApiResponse<T>>({ method, url, ...options });
  if (!response.data.success) {
    throw new Error(response.data.error || i18n.t('common:requestFailed'));
  }
  return response.data.data as T;
}

export function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return request<T>('get', url, { params });
}

export function post<T>(url: string, data?: unknown): Promise<T> {
  return request<T>('post', url, { data });
}

export function put<T>(url: string, data?: unknown): Promise<T> {
  return request<T>('put', url, { data });
}

export function patch<T>(url: string, data?: unknown): Promise<T> {
  return request<T>('patch', url, { data });
}

export function del<T>(url: string): Promise<T> {
  return request<T>('delete', url);
}

export default api;
