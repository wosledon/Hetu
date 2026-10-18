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
    <div className="overflow-hidden rounded-xl border border-amber-200/80 bg-amber-50/60 shadow-sm dark:border-amber-800/50 dark:bg-amber-950/20">
      <div className="flex items-start gap-2.5 p-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 ring-1 ring-amber-200/70 dark:bg-amber-900/40 dark:text-amber-400 dark:ring-amber-800/50">
          <ShieldCheck size={14} />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-[12px] font-semibold text-gray-800 dark:text-gray-100">
            {t('approval.needConfirm', { name: renderToolName(request.name) })}
          </p>
        </div>
      </div>
      <pre className="mx-3 mb-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-amber-200/60 bg-white/70 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-gray-600 dark:border-amber-900/30 dark:bg-gray-900/50 dark:text-gray-300">
        {args}
      </pre>
      <div className="flex items-center justify-end gap-2 border-t border-amber-200/60 bg-white/40 px-3 py-2 dark:border-amber-900/30 dark:bg-gray-900/20">
        <Button variant="ghost" tone="gray" size="sm" className="rounded-lg px-3 py-1.5 text-[12px] text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/60" onClick={onDeny}>
          {t('approval.deny')}
        </Button>
        <Button variant="primary" tone="emerald" size="sm" className="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-[12px] font-medium text-white shadow-sm hover:bg-emerald-600" onClick={onApprove}>
          {t('approval.allow')}
        </Button>
      </div>
    </div>
  )
}
