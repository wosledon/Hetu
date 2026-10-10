import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import { renderToolName } from '../../utils/toolRendering'

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
    <div className="rounded-xl border border-amber-300 bg-amber-50/80 p-3 dark:border-amber-700/60 dark:bg-amber-950/20">
      <div className="flex items-start gap-2">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-gray-800 dark:text-gray-100">
            {t('approval.needConfirm', { name: renderToolName(request.name) })}
          </p>
        </div>
      </div>
      <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-white/70 p-2 text-[11px] text-gray-600 dark:bg-gray-900/60 dark:text-gray-300">
        {args}
      </pre>
      <div className="mt-2 flex gap-2">
        <button
          onClick={onApprove}
          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-emerald-600"
        >
          {t('approval.allow')}
        </button>
        <button
          onClick={onDeny}
          className="rounded-lg bg-gray-200 px-3 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200"
        >
          {t('approval.deny')}
        </button>
      </div>
    </div>
  )
}
