import { useTranslation } from 'react-i18next'
import ChatToolCallRow from '../ChatToolCallRow'

export interface AgentThoughtBlockProps {
  text: string
  /** 流式进行中：标题带加载指示 */
  streaming?: boolean
}

/**
 * 思考过程折叠块。对话页、编码会话、任务看板详情共用同一外观。
 * 直接复用工具调用卡片（ChatToolCallRow 的文本型条目），保证同一时间线里
 * 「思考块」与「工具调用卡片」的行高、展开样式完全一致。
 */
export default function AgentThoughtBlock({ text, streaming = false }: AgentThoughtBlockProps) {
  const { t } = useTranslation('agent')
  return <ChatToolCallRow name="" args="" text={text} label={t('thought.title')} running={streaming} />
}
