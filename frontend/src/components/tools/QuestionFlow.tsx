import { useState } from 'react'
import { Check, ChevronLeft, ChevronRight, HelpCircle, Send } from 'lucide-react'
import type { InteractionQuestion } from '../../stores/interactionStore'

interface QuestionFlowProps {
  questions: InteractionQuestion[]
  currentIndex: number
  answers: Record<string, string>
  onAnswer: (questionId: string, value: string) => void
  onIndexChange: (idx: number) => void
  onSubmitAll: () => void
  /** 抽屉内嵌：更紧凑的留白与圆角 */
  compact?: boolean
}

/**
 * 提问工具（ask_question）的作答流：逐题作答、选项/自定义输入、进度指示与整体提交。
 * 对话页抽屉、工作流面板共用同一组件，保证三端交互一致。
 */
export default function QuestionFlow({
  questions,
  currentIndex,
  answers,
  onAnswer,
  onIndexChange,
  onSubmitAll,
  compact = false,
}: QuestionFlowProps) {
  const [customDraft, setCustomDraft] = useState('')
  const total = questions.length
  const idx = Math.min(currentIndex, total - 1)
  const q = questions[idx]
  if (!q) return null

  const currentAnswer = answers[q.id]
  const hasAnswer = !!currentAnswer
  const answeredCount = questions.filter(qq => answers[qq.id]).length
  const allAnswered = questions.every(qq => answers[qq.id])
  const isFirst = idx === 0
  const isLast = idx === total - 1
  const goNext = () => onIndexChange(Math.min(total - 1, idx + 1))
  const goPrev = () => onIndexChange(Math.max(0, idx - 1))
  const isCustomDraft = hasAnswer && !q.options?.some(o => o.label === currentAnswer)

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 shadow-sm ring-1 ring-indigo-200/60 dark:bg-indigo-900/50 dark:text-indigo-300 dark:ring-indigo-800/50">
          <HelpCircle size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-gray-800 dark:text-gray-100">
            {q.header || '请回答'}
          </div>
          <div className="text-[11px] text-gray-400">
            已答 {answeredCount} / {total}
          </div>
        </div>
        {/* Progress dots */}
        <div className="flex items-center gap-1.5">
          {questions.map((qq, i) => {
            const answered = !!answers[qq.id]
            const isCurrent = i === idx
            return (
              <button
                key={qq.id}
                type="button"
                onClick={() => onIndexChange(i)}
                title={qq.question}
                aria-label={`跳到第 ${i + 1} 题`}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  isCurrent
                    ? 'w-5 bg-indigo-500'
                    : answered
                      ? 'w-1.5 bg-indigo-400 hover:w-3'
                      : 'w-1.5 bg-gray-300 hover:w-3 dark:bg-gray-600'
                }`}
              />
            )
          })}
        </div>
      </div>

      {/* Body */}
      <div className={compact ? 'px-4 pb-3' : 'px-4 pb-4'}>
        <p className="mb-3 text-sm leading-relaxed text-gray-800 dark:text-gray-100">
          {q.question}
        </p>

        {q.options && q.options.length > 0 && (() => {
          const maxLabelLen = Math.max(...q.options.map(o => (o.label || '').length))
          const hasDescription = q.options.some(o => o.description)
          const useListLayout = maxLabelLen > 8 || q.options.length > 4 || hasDescription
          if (useListLayout) {
            return (
              <div className="mb-3 flex flex-col gap-2">
                {q.options.map((opt, i) => {
                  const selected = currentAnswer === opt.label
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        onAnswer(q.id, opt.label)
                        setCustomDraft('')
                        if (!isLast) setTimeout(goNext, 150)
                      }}
                      className={`group flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left text-xs transition-all duration-200 ${
                        selected
                          ? 'border-indigo-500 bg-indigo-50 shadow-sm ring-1 ring-indigo-500/20 dark:bg-indigo-950/40'
                          : 'border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-gray-700 dark:bg-gray-800/60 dark:hover:border-indigo-700 dark:hover:bg-indigo-900/20'
                      }`}
                    >
                      <span className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                        selected
                          ? 'border-indigo-500 bg-indigo-500'
                          : 'border-gray-300 group-hover:border-indigo-400 dark:border-gray-600'
                      }`}>
                        {selected && <Check size={10} className="text-white" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className={`font-medium leading-relaxed ${
                          selected ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-700 dark:text-gray-200'
                        }`}>
                          {opt.label}
                        </div>
                        {opt.description && (
                          <div className="mt-0.5 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                            {opt.description}
                          </div>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          }
          return (
            <div className="mb-3 flex flex-wrap gap-2">
              {q.options.map((opt, i) => {
                const selected = currentAnswer === opt.label
                return (
                  <button
                    key={i}
                    onClick={() => {
                      onAnswer(q.id, opt.label)
                      setCustomDraft('')
                      if (!isLast) setTimeout(goNext, 150)
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-medium transition-all duration-200 ${
                      selected
                        ? 'border-indigo-500 bg-indigo-500 text-white shadow-sm'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300 dark:hover:border-indigo-700 dark:hover:bg-indigo-900/30'
                    }`}
                  >
                    {selected && <Check size={12} />}
                    <span>{opt.label}</span>
                  </button>
                )
              })}
            </div>
          )
        })()}

        {q.allowCustom !== false && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder={isCustomDraft ? '继续补充自定义回答（回车下一题）' : '输入自定义回答...（回车下一题）'}
              value={isCustomDraft ? (currentAnswer || '') : customDraft}
              onChange={(e) => {
                setCustomDraft(e.target.value)
                onAnswer(q.id, e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && hasAnswer) {
                  e.preventDefault()
                  setCustomDraft('')
                  if (isLast && allAnswered) onSubmitAll()
                  else if (!isLast) goNext()
                }
              }}
              className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs outline-none transition-all placeholder:text-gray-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200/50 dark:border-gray-700 dark:bg-gray-800/60 dark:placeholder:text-gray-500 dark:focus:ring-indigo-900/40"
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2.5 dark:border-gray-700/60">
        <button
          onClick={goPrev}
          disabled={isFirst}
          className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
            isFirst
              ? 'cursor-not-allowed text-gray-300 dark:text-gray-600'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/60'
          }`}
        >
          <ChevronLeft size={14} /> 上一题
        </button>
        <span className="text-[10px] tabular-nums text-gray-400">
          {idx + 1} / {total}
        </span>
        {!isLast ? (
          <button
            onClick={goNext}
            disabled={!hasAnswer}
            className={`flex items-center gap-1 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all ${
              hasAnswer
                ? 'bg-indigo-500 text-white shadow-sm hover:bg-indigo-600'
                : 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
            }`}
          >
            下一题 <ChevronRight size={14} />
          </button>
        ) : (
          <button
            onClick={onSubmitAll}
            disabled={!allAnswered}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all ${
              allAnswered
                ? 'bg-indigo-500 text-white shadow-sm hover:bg-indigo-600'
                : 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
            }`}
          >
            <Send size={12} /> 提交全部
          </button>
        )}
      </div>
    </div>
  )
}
