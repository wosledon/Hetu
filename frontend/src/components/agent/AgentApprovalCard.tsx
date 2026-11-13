import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import { renderToolName } from '../../utils/toolRendering'
import { Button } from '../ui'

export interface AgentApprovalRequest {
  id: string
  name: string
  arguments: string
}

export interface AgentApprovalCardProps {
  request: AgentApprovalRequest
  onApprove: () => void
  onDeny: () => void
}

/**
 * 统一的工具审批卡片。对话页（ApprovalPanel）与编码会话（ApprovalCard）
 * 历史上是两套外观，这里合并为一份：带参数预览 + 允许/拒绝。
 */
export default function AgentApprovalCard({ request, onApprove, onDeny }: AgentApprovalCardProps) {
  const { t } = useTranslation('agent')
  let args = request.arguments
  try {
    args = JSON.stringify(JSON.parse(request.arguments), null, 2)
  } catch {
    /* 保留原文 */
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200/90 bg-white shadow-[0_4px_16px_-10px_rgba(15,23,42,0.2)] dark:border-white/10 dark:bg-gray-900/80">
      <div className="h-0.5 bg-gradient-to-r from-amber-400 via-amber-300/70 to-transparent" />
      <div className="flex items-center gap-3 px-3.5 pb-3 pt-3.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-200/70 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-400/20">
          <ShieldCheck size={15} />
        </div>
        <p className="min-w-0 flex-1 text-[13px] font-semibold leading-5 text-gray-800 dark:text-gray-100">
          {t('approval.needConfirm', { name: renderToolName(request.name) })}
        </p>
      </div>
      <pre className="mx-3.5 mb-3.5 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-gray-200/70 bg-gray-50/80 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-gray-600 dark:border-white/[0.07] dark:bg-black/20 dark:text-gray-300">
        {args}
      </pre>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200/70 bg-gray-50/60 px-3.5 py-2.5 dark:border-white/[0.07] dark:bg-white/[0.025]">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          {t('approval.pending')}
        </span>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" tone="gray" size="sm" className="rounded-lg px-3 py-1.5 text-[12px] text-gray-600 hover:bg-gray-200/70 dark:text-gray-300 dark:hover:bg-white/10" onClick={onDeny}>
            {t('approval.deny')}
          </Button>
          <Button variant="primary" tone="emerald" size="sm" className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-[12px] font-medium text-white shadow-sm hover:bg-emerald-500" onClick={onApprove}>
            {t('approval.allow')}
          </Button>
        </div>
      </div>
    </div>
  )
}
