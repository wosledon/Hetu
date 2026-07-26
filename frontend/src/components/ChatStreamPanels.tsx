import { ChevronDown, ChevronLeft, ChevronRight, ClipboardList, CircleCheckBig, Circle, Loader2, HelpCircle, Check } from 'lucide-react'
import type { StreamingTodo, StreamingQuestion } from '../stores/chatStreamStore'

interface TodoPanelProps {
  todos: StreamingTodo[]
  collapsed: boolean
  onToggleCollapsed: (v: boolean | ((p: boolean) => boolean)) => void
}

/** 流式工作计划面板 */
export function TodoPanel({ todos, collapsed, onToggleCollapsed }: TodoPanelProps) {
  if (todos.length === 0) return null
  const total = todos.length
  const completed = todos.filter(t => t.status === 'completed').length
  const inProgress = todos.find(t => t.status === 'in-progress')
  const allDone = completed === total
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100)
  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-gray-200 bg-white/80 shadow-sm backdrop-blur-sm dark:border-gray-700 dark:bg-gray-800/80">
      {/* Header (clickable to collapse) */}
      <button
        type="button"
        onClick={() => onToggleCollapsed(v => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
      >
        <div className={`flex h-6 w-6 items-center justify-center rounded-md ${
          allDone
            ? 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400'
            : 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400'
        }`}>
          {allDone ? <CircleCheckBig size={14} /> : <ClipboardList size={14} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
              工作计划
            </span>
            <span className="text-[11px] text-gray-400">
              {completed} / {total}
            </span>
            {!allDone && inProgress && (
              <span className="ml-1 truncate text-[11px] text-gray-500 dark:text-gray-400">
                · {inProgress.title}
              </span>
            )}
            {allDone && (
              <span className="ml-1 text-[11px] font-medium text-green-600 dark:text-green-400">
                · 已全部完成
              </span>
            )}
          </div>
          {/* Progress bar */}
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                allDone ? 'bg-green-500' : 'bg-gradient-to-r from-indigo-400 to-blue-500'
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
        <ChevronDown
          size={14}
          className={`flex-shrink-0 text-gray-400 transition-transform ${collapsed ? '-rotate-90' : ''}`}
        />
      </button>

      {/* Todo list (collapsible) */}
      {!collapsed && (
        <div className="border-t border-gray-100 px-3 py-2 dark:border-gray-700/60">
          <ul className="space-y-1">
            {todos.map((t, idx) => {
              const isCompleted = t.status === 'completed'
              const isInProgress = t.status === 'in-progress'
              return (
                <li key={t.id} className="flex items-start gap-2 text-xs">
                  <span className="mt-0.5 flex-shrink-0">
                    {isCompleted ? (
                      <CircleCheckBig size={13} className="text-green-500" />
                    ) : isInProgress ? (
                      <Loader2 size={13} className="animate-spin text-blue-500" />
                    ) : (
                      <Circle size={13} className="text-gray-300 dark:text-gray-600" />
                    )}
                  </span>
                  <span className={`flex-1 leading-relaxed ${
                    isCompleted
                      ? 'text-gray-400 line-through dark:text-gray-500'
                      : isInProgress
                        ? 'font-medium text-blue-700 dark:text-blue-300'
                        : 'text-gray-600 dark:text-gray-400'
                  }`}>
                    {t.title}
                  </span>
                  <span className="flex-shrink-0 text-[10px] text-gray-300 tabular-nums dark:text-gray-600">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

interface QuestionPanelProps {
  questions: StreamingQuestion[]
  answers: Record<string, string>
  currentIndex: number
  onAnswer: (updater: Record<string, string> | ((p: Record<string, string>) => Record<string, string>)) => void
  onIndexChange: (updater: number | ((p: number) => number)) => void
  onSubmitAll: () => void
}

/** 流式提问面板（逐题作答） */
export function QuestionPanel({ questions, answers, currentIndex, onAnswer, onIndexChange, onSubmitAll }: QuestionPanelProps) {
  if (questions.length === 0) return null
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
  const goNext = () => onIndexChange(i => Math.min(total - 1, i + 1))
  const goPrev = () => onIndexChange(i => Math.max(0, i - 1))
  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-blue-200/70 bg-gradient-to-br from-blue-50/80 to-indigo-50/60 shadow-sm backdrop-blur-sm dark:border-blue-800/50 dark:from-blue-950/40 dark:to-indigo-950/30">
      {/* Header strip with progress dots */}
      <div className="flex items-center gap-2 border-b border-blue-100/80 bg-white/40 px-4 py-2.5 dark:border-blue-900/30 dark:bg-gray-900/20">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400">
          <HelpCircle size={14} />
        </div>
        <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
          {q.header || '请回答'}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {/* Progress dots */}
          <div className="flex items-center gap-1">
            {questions.map((qq, i) => {
              const answered = !!answers[qq.id]
              const isCurrent = i === idx
              return (
                <button
                  key={qq.id}
                  type="button"
                  onClick={() => onIndexChange(i)}
                  title={qq.question}
                  className={`h-1.5 rounded-full transition-all ${
                    isCurrent
                      ? 'w-5 bg-blue-500'
                      : answered
                        ? 'w-1.5 bg-blue-400 hover:w-3'
                        : 'w-1.5 bg-gray-300 hover:w-3 dark:bg-gray-600'
                  }`}
                />
              )
            })}
          </div>
          <span className="ml-1 text-[10px] text-gray-500 tabular-nums dark:text-gray-400">
            {answeredCount} / {total}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        <p className="mb-3 text-sm leading-relaxed text-gray-800 dark:text-gray-200">
          {q.question}
        </p>

        {/* Options - auto layout: chips for short, list for long */}
        {q.options && q.options.length > 0 && (() => {
          const maxLabelLen = Math.max(...q.options.map(o => (o.label || '').length))
          const hasDescription = q.options.some(o => o.description)
          const useListLayout = maxLabelLen > 8 || q.options.length > 4 || hasDescription
          if (useListLayout) {
            return (
              <div className="mb-3 flex flex-col gap-1.5">
                {q.options.map((opt, i) => {
                  const selected = currentAnswer === opt.label
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        onAnswer(prev => ({ ...prev, [q.id]: opt.label }))
                        if (!isLast) setTimeout(goNext, 150)
                      }}
                      className={`group flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-xs transition-all ${
                        selected
                          ? 'border-blue-500 bg-blue-50 shadow-sm dark:bg-blue-950/40'
                          : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/50 dark:border-gray-700 dark:bg-gray-800/60 dark:hover:border-blue-700 dark:hover:bg-blue-900/20'
                      }`}
                    >
                      <span className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                        selected
                          ? 'border-blue-500 bg-blue-500'
                          : 'border-gray-300 group-hover:border-blue-400 dark:border-gray-600'
                      }`}>
                        {selected && <Check size={10} className="text-white" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className={`font-medium leading-relaxed ${
                          selected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200'
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
          // Chips layout for short options
          return (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {q.options.map((opt, i) => {
                const selected = currentAnswer === opt.label
                return (
                  <button
                    key={i}
                    onClick={() => {
                      onAnswer(prev => ({ ...prev, [q.id]: opt.label }))
                      if (!isLast) setTimeout(goNext, 150)
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                      selected
                        ? 'border-blue-500 bg-blue-500 text-white shadow-sm'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300 dark:hover:border-blue-700 dark:hover:bg-blue-900/30'
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

        {/* Custom input — do not reveal previous answer content when navigating back */}
        {q.allowCustom !== false && (
          <div className="relative">
            <input
              type="text"
              placeholder={hasAnswer && q.options?.some(o => o.label === currentAnswer) ? '或输入自定义回答（回车下一题）' : '输入回答...（回车下一题）'}
              value={q.options?.some(o => o.label === currentAnswer) ? '' : (currentAnswer || '')}
              onChange={(e) => {
                onAnswer(prev => ({ ...prev, [q.id]: e.target.value }))
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && currentAnswer) {
                  e.preventDefault()
                  if (isLast && allAnswered) {
                    onSubmitAll()
                  } else if (!isLast) {
                    goNext()
                  }
                }
              }}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none transition-colors placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-200/50 dark:border-gray-700 dark:bg-gray-800/60 dark:placeholder:text-gray-500 dark:focus:ring-blue-900/40"
            />
          </div>
        )}
      </div>

      {/* Footer: navigation */}
      <div className="flex items-center justify-between border-t border-blue-100/80 bg-white/40 px-3 py-2 dark:border-blue-900/30 dark:bg-gray-900/20">
        <button
          onClick={goPrev}
          disabled={isFirst}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
            isFirst
              ? 'cursor-not-allowed text-gray-300 dark:text-gray-600'
              : 'text-gray-600 hover:bg-blue-100/50 dark:text-gray-300 dark:hover:bg-blue-900/30'
          }`}
        >
          <ChevronLeft size={14} /> 上一题
        </button>
        <span className="text-[10px] text-gray-400">
          {idx + 1} / {total}
        </span>
        {!isLast ? (
          <button
            onClick={goNext}
            disabled={!hasAnswer}
            className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              hasAnswer
                ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-sm'
                : 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
            }`}
          >
            下一题 <ChevronRight size={14} />
          </button>
        ) : (
          <button
            onClick={onSubmitAll}
            disabled={!allAnswered}
            className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              allAnswered
                ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-sm'
                : 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
            }`}
          >
            <Check size={14} /> 提交全部
          </button>
        )}
      </div>
    </div>
  )
}
