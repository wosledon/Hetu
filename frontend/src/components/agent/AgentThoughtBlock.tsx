import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import ChatToolCallRow from '../ChatToolCallRow'

export interface AgentThoughtBlockProps {
  text: string
  /** 流式进行中：标题带加载指示 */
  streaming?: boolean
  /** 非紧凑模式仅用于旧的工具卡片分组 */
  compact?: boolean
}

/** 思考过程折叠行。对话页、编码会话、任务看板详情共用同一外观。 */
function AgentThoughtBlock({ text, streaming = false, compact = true }: AgentThoughtBlockProps) {
  const { t } = useTranslation('agent')
  return <ChatToolCallRow name="" args="" text={text} label={t('thought.title')} running={streaming} compact={compact} />
}

// 流式期间只有最后一段思考在变，历史行按 props 跳过重渲染
export default memo(AgentThoughtBlock)
