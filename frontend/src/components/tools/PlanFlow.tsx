import { Check, CircleCheckBig, ListChecks, Loader2, MessageSquare, Play, X } from 'lucide-react'
import type { InteractionPlan } from '../../stores/interactionStore'

interface PlanFlowProps {
  plan: InteractionPlan
  onFeedback: (feedback: string) => void
  onDecide: (approved: boolean) => void
  /** 抽屉内嵌：标题与状态已在抽屉头部展示，不再重复一层头部 */
  hideHeader?: boolean
}

/**
 * 计划工具（plan）的确认面板：步骤列表 + 修改意见 + 批准 / 驳回。
 * 输入框抽屉与工作流内联面板共用。
 */
export default function PlanFlow({ plan, onFeedback, onDecide, hideHeader = false }: PlanFlowProps) {
  const decided = plan.decided
  const pending = !decided
  const completed = plan.steps.filter(s => s.status === 'completed').length

  return (
    <div className="flex flex-col">
      {/* Header */}
      {!hideHeader && (
        <div className="flex items-start gap-2.5 px-4 pt-3.5 pb-3">
          <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl shadow-sm ring-1 ${
            decided === 'approved'
              ? 'bg-emerald-100 text-emerald-600 ring-emerald-200/60 dark:bg-emerald-900/50 dark:text-emerald-300 dark:ring-emerald-800/50'
              : decided === 'rejected'
                ? 'bg-red-100 text-red-600 ring-red-200/60 dark:bg-red-900/50 dark:text-red-300 dark:ring-red-800/50'
                : 'bg-teal-100 text-teal-600 ring-teal-200/60 dark:bg-teal-900/50 dark:text-teal-300 dark:ring-teal-800/50'
          }`}>
            {decided === 'approved' ? <CircleCheckBig size={15} />
              : decided === 'rejected' ? <X size={15} />
                : <ListChecks size={15} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-gray-800 dark:text-gray-100">
              {plan.title || '执行计划'}
            </div>
            <div className="text-[11px] text-gray-400">
              {plan.steps.length} 个步骤{plan.steps.length > 0 && ` · 已完成 ${completed}`}
              {decided === 'approved' && ' · 已批准，正在执行'}
              {decided === 'rejected' && ' · 已驳回'}
            </div>
          </div>
        </div>
      )}

      <div className={hideHeader ? 'px-4 pt-3 pb-3' : 'px-4 pb-3'}>
        {plan.summary && (
          <p className="mb-3 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
            {plan.summary}
          </p>
        )}

        {/* Steps */}
        <ol className="relative space-y-2.5 pl-1">
          {/* Connector line */}
          {plan.steps.length > 1 && (
            <span
              aria-hidden
              className="absolute bottom-4 left-[13px] top-4 w-px bg-gradient-to-b from-teal-200 to-gray-100 dark:from-teal-800 dark:to-gray-700"
            />
          )}
          {plan.steps.map((step, i) => (
            <li key={step.id} className="relative flex items-start gap-3">
              <span className={`relative z-10 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums ${
                step.status === 'completed'
                  ? 'border-emerald-500 bg-emerald-500 text-white'
                  : 'border-teal-200 bg-white text-teal-600 dark:border-teal-800 dark:bg-gray-900 dark:text-teal-400'
              }`}>
                {step.status === 'completed' ? <Check size={11} /> : i + 1}
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className={`text-xs font-medium leading-relaxed ${
                  step.status === 'completed'
                    ? 'text-gray-400 line-through dark:text-gray-500'
                    : 'text-gray-700 dark:text-gray-200'
                }`}>
                  {step.title}
                </div>
                {step.description && (
                  <div className="mt-0.5 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                    {step.description}
                  </div>
                )}
              </div>
              {step.status === 'in-progress' && (
                <Loader2 size={12} className="mt-1 flex-shrink-0 animate-spin text-teal-500" />
              )}
            </li>
          ))}
        </ol>
      </div>

      {/* Actions */}
      {pending && (
        <div className="border-t border-gray-100 px-3 py-2.5 dark:border-gray-700/60">
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2 transition-colors focus-within:border-teal-300 dark:border-gray-700 dark:bg-gray-900/40">
            <MessageSquare size={12} className="shrink-0 text-gray-400" />
            <input
              type="text"
              value={plan.feedback}
              onChange={(e) => onFeedback(e.target.value)}
              placeholder="修改意见（驳回时连同计划一起回传给 Agent）"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-gray-400"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => onDecide(false)}
              className="flex items-center gap-1.5 rounded-xl border border-red-200 px-3.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              <X size={13} /> 驳回
            </button>
            <button
              onClick={() => onDecide(true)}
              className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-4 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-teal-600 hover:shadow"
            >
              <Play size={12} /> 批准执行
            </button>
          </div>
        </div>
      )}

      {decided && (
        <div className={`flex items-center gap-2 border-t px-4 py-2.5 text-xs ${
          decided === 'approved'
            ? 'border-emerald-100 bg-emerald-50/60 text-emerald-700 dark:border-emerald-900/30 dark:bg-emerald-950/30 dark:text-emerald-300'
            : 'border-red-100 bg-red-50/60 text-red-700 dark:border-red-900/30 dark:bg-red-950/30 dark:text-red-300'
        }`}>
          {decided === 'approved' ? <CircleCheckBig size={13} /> : <X size={13} />}
          <span className="flex-1">
            {decided === 'approved' ? '计划已批准，Agent 正在按计划执行' : '计划已驳回'}
            {decided === 'rejected' && plan.feedback && `：${plan.feedback}`}
          </span>
        </div>
      )}
    </div>
  )
}
