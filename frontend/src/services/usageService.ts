import { get } from './api'
import type { IPagedResult } from '../types'

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

/** 按调用来源聚合的用量（对话 / 编码会话 / 任务看板 / Wiki / ...） */
export interface IUsageSourceStat {
  source: string
  sourceName: string
  messages: number
  tokens: number
}

/** 按来源×模型聚合的用量（调用来源条形图按模型堆叠） */
export interface IUsageSourceModelStat {
  source: string
  sourceName: string
  modelName: string
  messages: number
  tokens: number
}

/** 按天×模型聚合的用量（趋势图按模型拆分） */
export interface IUsageModelDayStat {
  date: string
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
  bySource: IUsageSourceStat[]
  bySourceByModel: IUsageSourceModelStat[]
  dailyByModel: IUsageModelDayStat[]
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
  /** chat / work / kanban / workflow / wiki / note-ai / skill / graph / search / scheduled / proxy */
  source: string
  sourceName: string
}

export const usageService = {
  /** days>0 时按模型/来源的聚合只统计最近 N 天；缺省为全量 */
  getStats: (days?: number) =>
    get<IUsageStats>('/usage/stats', days && days > 0 ? { days } : {}),
  getLogs: (page = 1, pageSize = 50, source?: string, refId?: string, model?: string) =>
    get<IPagedResult<IUsageLog>>('/usage/logs', {
      page,
      pageSize,
      ...(source ? { source } : {}),
      ...(refId ? { refId } : {}),
      ...(model ? { model } : {}),
    }),
}
