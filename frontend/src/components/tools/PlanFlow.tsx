import { Check, CircleCheckBig, ListChecks, Loader2, MessageSquare, Play, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { InteractionPlan } from '../../stores/interactionStore'
import { Button } from '../ui'

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
  const { t } = useTranslation('agents')
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
              {plan.title || t('plan.defaultTitle')}
            </div>
            <div className="text-[11px] text-gray-400">
              {plan.steps.length > 0
                ? t('plan.stepsProgress', { total: plan.steps.length, done: completed })
                : t('plan.steps', { n: plan.steps.length })}
              {decided === 'approved' && t('plan.approvedRunning')}
              {decided === 'rejected' && t('plan.rejectedSuffix')}
            </div>
          </div>
        </div>
      )}

      <div className={hideHeader ? 'px-4 pt-3 pb-3' : 'px-4 pb-3'}>
        {plan.summary && (
          <p className="mb-3 rounded-xl border border-teal-200/60 bg-teal-50/45 px-3.5 py-3 text-xs leading-5 text-teal-900 dark:border-teal-400/15 dark:bg-teal-500/[0.055] dark:text-teal-100">
            {plan.summary}
          </p>
        )}

        {/* Steps */}
        <ol className="space-y-2">
          {plan.steps.map((step, i) => (
            <li className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
              step.status === 'completed'
                ? 'border-emerald-200/60 bg-emerald-50/35 dark:border-emerald-400/10 dark:bg-emerald-500/[0.035]'
                : step.status === 'in-progress'
                  ? 'border-teal-300/80 bg-teal-50/55 shadow-sm dark:border-teal-400/25 dark:bg-teal-500/[0.07]'
                  : 'border-gray-200/75 bg-white/60 dark:border-white/[0.07] dark:bg-gray-900/35'
            }`} key={step.id}>
              <span className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums ${
                step.status === 'completed'
                  ? 'border-emerald-500 bg-emerald-500 text-white'
                  : step.status === 'in-progress'
                    ? 'border-teal-500 bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'
                    : 'border-teal-200 bg-white text-teal-600 dark:border-teal-800 dark:bg-gray-900 dark:text-teal-400'
              }`}>
                {step.status === 'completed'
                  ? <Check size={11} strokeWidth={2.5} />
                  : step.status === 'in-progress'
                    ? <Loader2 size={11} className="animate-spin" />
                    : i + 1}
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className={`text-xs font-medium leading-5 ${
                  step.status === 'completed'
                    ? 'text-gray-400 line-through dark:text-gray-500'
                    : step.status === 'in-progress'
                      ? 'text-teal-800 dark:text-teal-200'
                      : 'text-gray-700 dark:text-gray-200'
                }`}>
                  {step.title}
                </div>
                {step.description && (
                  <div className="mt-1 text-[11px] leading-5 text-gray-500 dark:text-gray-400">
                    {step.description}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Actions */}
      {pending && (
        <div className="sticky bottom-0 z-10 border-t border-gray-200/70 bg-gray-50/95 px-3 py-3 dark:border-white/[0.06] dark:bg-gray-900/95">
          <div className="mb-2.5 flex items-center gap-2 rounded-xl border border-gray-200/80 bg-white/75 px-3 py-2.5 transition-colors focus-within:border-teal-400 focus-within:ring-2 focus-within:ring-teal-500/10 dark:border-white/[0.08] dark:bg-gray-900/50">
            <MessageSquare size={12} className="shrink-0 text-gray-400" />
            <input
              type="text"
              value={plan.feedback}
              onChange={(e) => onFeedback(e.target.value)}
              placeholder={t('plan.feedbackPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-gray-400"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" tone="red" size="sm" className="flex items-center gap-1.5 rounded-xl border border-red-200 px-3.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30" onClick={() => onDecide(false)}>
              <X size={13} /> {t('plan.reject')}
            </Button>
            <Button variant="primary" tone="teal" size="sm" className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-4 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-teal-600 hover:shadow" onClick={() => onDecide(true)}>
              <Play size={12} /> {t('plan.approve')}
            </Button>
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
            {decided === 'approved' ? t('plan.approved') : t('plan.rejected')}
            {decided === 'rejected' && plan.feedback && t('plan.feedbackSuffix', { feedback: plan.feedback })}
          </span>
        </div>
      )}
    </div>
  )
}
