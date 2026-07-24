import { get } from './api'

export interface IUsageOverview {
  totalMessages: number
  totalTokens: number
  avgLatencyMs: number
  activeDays: number
  todayMessages: number
  todayTokens: number
}

export interface IUsageDayStat {
  date: string
  messages: number
  tokens: number
}

export interface IUsageHourStat {
  date: string
  hour: number
  messages: number
  tokens: number
}

export interface IUsageModelStat {
  modelName: string
  messages: number
  tokens: number
}

export interface IUsageStats {
  overview: IUsageOverview
  dailyTrend: IUsageDayStat[]
  yearDaily: IUsageDayStat[]
  weekHourly: IUsageHourStat[]
  byModel: IUsageModelStat[]
}

export const usageService = {
  getStats: () => get<IUsageStats>('/usage/stats'),
}
