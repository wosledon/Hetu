import { get, put } from './api'

export interface IProxyRouteRule {
  id?: string
  category: string
  targetModelKey: string
  sortOrder: number
}

export interface IProxyConfig {
  mode: 'route' | 'shadow'
  modelKey: string
  shadowTargetModelKey?: string
  routeClassifierModelKey?: string
  routeRules: IProxyRouteRule[]
}

export const proxyService = {
  getAll: () => get<IProxyConfig[]>('/proxy-config'),
  save: (data: IProxyConfig) => put<IProxyConfig>('/proxy-config', data),
}
