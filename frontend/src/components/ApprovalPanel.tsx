import { HelpCircle } from 'lucide-react'
import type { ApprovalRequest } from '../hooks/useStreaming'
import { renderToolName } from '../utils/toolRendering'

interface ApprovalPanelProps {
  requests: ApprovalRequest[]
  onApprove: (toolCallId: string, approved: boolean) => void
}

export default function ApprovalPanel({ requests, onApprove }: ApprovalPanelProps) {
  if (requests.length === 0) return null

  return (
    <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-900/20">
      {requests.map((req) => (
        <div key={req.id} className="flex items-center gap-2">
          <HelpCircle size={14} className="text-amber-500 shrink-0" />
          <span className="flex-1 text-xs text-amber-700 dark:text-amber-300">
            确认执行 <span className="font-medium">{renderToolName(req.name)}</span>？
          </span>
          <button
            onClick={() => onApprove(req.id, true)}
            className="rounded-md bg-emerald-500 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-600"
          >
            允许
          </button>
          <button
            onClick={() => onApprove(req.id, false)}
            className="rounded-md bg-red-100 px-2.5 py-1 text-[11px] font-medium text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
          >
            拒绝
          </button>
        </div>
      ))}
    </div>
  )
}