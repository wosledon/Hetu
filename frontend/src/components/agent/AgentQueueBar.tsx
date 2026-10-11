import { useTranslation } from 'react-i18next'
import { CornerDownRight, ListEnd, X } from 'lucide-react'

/** 队列里的一条待发送消息 */
export interface PendingMessage {
  id: string
  content: string
}

/**
 * 发送队列条（对话页与 Code 会话共用，挂在输入框上方）：
 * 回复进行中发送的消息先排队，回复结束后自动逐条发出；
 * 每条可「引导」——立即注入当前正在执行的回复（Agent 会在下一步考虑），或从队列移除。
 */
export default function AgentQueueBar({ items, steeringId, onSteer, onRemove }: {
  items: PendingMessage[]
  /** 正在引导中的那条（显示加载态） */
  steeringId?: string | null
  onSteer: (item: PendingMessage) => void
  onRemove: (item: PendingMessage) => void
}) {
  const { t } = useTranslation('agent')
  if (items.length === 0) return null

  return (
    <div className="mb-2 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2 dark:border-sky-800/50 dark:bg-sky-950/20">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-sky-800 dark:text-sky-300">
        <ListEnd size={12} />
        {t('queue.title', { count: items.length })}
        <span className="font-normal text-sky-700/80 dark:text-sky-300/70">· {t('queue.hint')}</span>
      </p>
      <div className="mt-1.5 space-y-1">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 rounded-md bg-white/70 px-2 py-1 text-[12px] text-gray-700 dark:bg-white/[0.04] dark:text-gray-200"
          >
            <span className="min-w-0 flex-1 truncate" title={item.content}>{item.content}</span>
            <button
              onClick={() => onSteer(item)}
              disabled={steeringId === item.id}
              title={t('queue.steerHint')}
              className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:opacity-50 dark:text-sky-300 dark:hover:bg-sky-900/40"
            >
              <CornerDownRight size={11} />
              {t('queue.steer')}
            </button>
            <button
              onClick={() => onRemove(item)}
              title={t('queue.remove')}
              aria-label={t('queue.remove')}
              className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]"
            >
              <X size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
