import { useTranslation } from 'react-i18next'
import { CornerDownRight, ListEnd, X } from 'lucide-react'
import { IconButton } from '../ui'

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
    <div className="mb-3 overflow-hidden rounded-2xl border border-sky-200/70 bg-sky-50/45 shadow-[0_8px_24px_-16px_rgba(14,165,233,0.35)] dark:border-sky-400/15 dark:bg-sky-500/[0.05]">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600 ring-1 ring-sky-200/60 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/15">
          <ListEnd size={13} />
        </div>
        <span className="shrink-0 text-xs font-semibold text-sky-800 dark:text-sky-200">
          {t('queue.title', { count: items.length })}
        </span>
        <span className="min-w-0 flex-1 truncate text-[10px] text-sky-600/70 dark:text-sky-300/60">
          {t('queue.hint')}
        </span>
      </div>
      <div className="space-y-1.5 border-t border-sky-200/60 p-2 dark:border-sky-400/10">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 rounded-xl border border-sky-100/70 bg-white/65 px-2.5 py-2 text-[12px] text-gray-700 dark:border-sky-400/10 dark:bg-gray-900/40 dark:text-gray-200"
          >
            <span className="min-w-0 flex-1 truncate" title={item.content}>{item.content}</span>
            <button
              onClick={() => onSteer(item)}
              disabled={steeringId === item.id}
              title={t('queue.steerHint')}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:opacity-50 dark:text-sky-300 dark:hover:bg-sky-500/10"
            >
              <CornerDownRight size={11} />
              {t('queue.steer')}
            </button>
            <IconButton variant="ghost" tone="gray" className="shrink-0 rounded-md p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]" label={t('queue.remove')} onClick={() => onRemove(item)}
              title={t('queue.remove')}
              aria-label={t('queue.remove')}>
              <X size={11} />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  )
}
