import { get } from './api'

export interface IUsageOverview {
  totalMessages: number
  totalTokens: number
  totalCachedTokens: number
  avgLatencyMs: number
  activeDays: number
  todayMessages: number
  todayTokens: number
  totalInputTokens: number
  totalCompressedTokens: number
  totalOutputTokens: number
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
  cachedTokens: number
}

export interface IUsageStats {
  overview: IUsageOverview
  dailyTrend: IUsageDayStat[]
  yearDaily: IUsageDayStat[]
  weekHourly: IUsageHourStat[]
  byModel: IUsageModelStat[]
}

export interface IUsageLog {
  messageId: string
  topicId: string
  createdAt: string
  modelName: string
  inputTokens: number | null
  compressedTokens: number | null
  outputTokens: number | null
  tokensUsed: number | null
  cachedTokens: number | null
  latencyMs: number | null
  contentPreview: string
  source: string // "chat" | "proxy"
}

export const usageService = {
  getStats: () => get<IUsageStats>('/usage/stats'),
  getLogs: (page = 1, pageSize = 50) => get<IUsageLog[]>(`/usage/logs?page=${page}&pageSize=${pageSize}`),
}
