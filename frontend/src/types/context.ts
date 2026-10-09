/** 上下文占用的一块（系统提示 / 历史消息 / 摘要） */
export interface IContextUsagePart {
  key: string;
  label: string;
  tokens: number;
  chars: number;
  estimated: boolean;
}

/** 会话上下文占用：窗口、已用、分块明细 */
export interface IContextUsage {
  window: number;
  used: number;
  parts: IContextUsagePart[];
  hasSummary: boolean;
  summarizedMessages: number;
  ratio: number;
}

export interface ICompactContextRequest {
  contextWindow?: number;
  modelId?: string;
  keepRecent?: number;
}

export interface ICompactContextResult {
  messageCount: number;
  summaryChars: number;
  beforeTokens: number;
  afterTokens: number;
  summary?: string;
}
