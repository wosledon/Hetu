import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  HelpCircle,
  ListChecks,
  Loader2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getInteraction, useInteractionStore } from '../stores/interactionStore'
import type { InteractionTodo } from '../stores/interactionStore'
import QuestionFlow from './tools/QuestionFlow'
import PlanFlow from './tools/PlanFlow'
import { IconButton } from './ui'

type InteractionTab = 'question' | 'plan' | 'todo'

interface ToolInteractionDrawerProps {
  /** 对话页传 topicId，编码页传 workSessionId；同时作为 answer/plan 接口的 sessionId */
  streamKey: string
  /** 流式进行中：任务面板仅在流式期间展示 */
  streaming?: boolean
}

/** 单个待办步骤：圆圈编号 + 进行中/完成状态，描述另起一行 */
function TodoRow({ todo, index }: { todo: InteractionTodo; index: number }) {
  const isCompleted = todo.status === 'completed'
  const isInProgress = todo.status === 'in-progress'
  const rowRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (isInProgress) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [isInProgress])

  return (
    <li ref={rowRef} className="relative flex items-start gap-3">
      <span
        className={`relative z-10 mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums transition-colors ${
          isCompleted
            ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm shadow-emerald-500/20'
            : isInProgress
              ? 'border-sky-400 bg-sky-50 text-sky-600 ring-4 ring-sky-500/10 dark:border-sky-600 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-400/10'
              : 'border-gray-200 bg-white text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500'
        }`}
      >
        {isCompleted
          ? <Check size={11} strokeWidth={3} />
          : isInProgress
            ? <Loader2 size={11} className="animate-spin" />
            : index + 1}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className={`text-[12px] font-medium leading-5 ${
          isCompleted
            ? 'text-gray-400 line-through dark:text-gray-500'
            : isInProgress
              ? 'text-sky-700 dark:text-sky-300'
              : 'text-gray-700 dark:text-gray-200'
        }`}>
          {todo.title}
        </div>
        {todo.description && !isCompleted && (
          <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-gray-400 dark:text-gray-500">
            {todo.description}
          </div>
        )}
      </div>
    </li>
  )
}

/** 工作计划面板：进度条 + 编号时间线（标题/计数已在抽屉头部展示） */
function TodoSection({ todos }: { todos: InteractionTodo[] }) {
  const total = todos.length
  const completed = todos.filter(t => t.status === 'completed').length
  const allDone = total > 0 && completed === total
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100)

  return (
    <div className="px-4 py-3">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700/70">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              allDone ? 'bg-emerald-500' : 'bg-gradient-to-r from-sky-400 via-sky-500 to-indigo-500'
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className={`w-9 text-right text-[10px] font-semibold tabular-nums ${
          allDone ? 'text-emerald-600 dark:text-emerald-400' : 'text-sky-600 dark:text-sky-400'
        }`}>
          {percent}%
        </span>
      </div>
      <ol className="relative space-y-3">
        {todos.length > 1 && (
          <span
            aria-hidden
            className="absolute bottom-3 left-[11px] top-3 w-px bg-gradient-to-b from-sky-200 via-gray-200 to-transparent dark:from-sky-800 dark:via-gray-700"
          />
        )}
        {todos.map((t, idx) => <TodoRow key={t.id} todo={t} index={idx} />)}
      </ol>
    </div>
  )
}

/**
 * 工具交互抽屉：ask_question / todo / plan 触发时在输入框上方滑出。
 * 对话页与编码页共用；答案与计划决策通过共享的 /chat-messages 接口提交。
 */
export default function ToolInteractionDrawer({ streamKey, streaming = false }: ToolInteractionDrawerProps) {
  const { t } = useTranslation('chat')
  const state = useInteractionStore((st) => getInteraction(st.streams, streamKey))
  const answer = useInteractionStore((st) => st.answer)
  const setQuestionIndex = useInteractionStore((st) => st.setQuestionIndex)
  const submitAnswers = useInteractionStore((st) => st.submitAnswers)
  const decidePlan = useInteractionStore((st) => st.decidePlan)
  const setPlanFeedback = useInteractionStore((st) => st.setPlanFeedback)

  const [collapsed, setCollapsed] = useState(false)
  // 用户手动切换过的分区；新交互到达时自动跟随优先级（提问 > 计划 > 任务）
  const [selectedTab, setSelectedTab] = useState<InteractionTab | null>(null)

  const { questions, todos, plan } = state

  const tabs = useMemo(() => {
    const list: { key: InteractionTab; label: string; icon: typeof HelpCircle; badge?: string }[] = []
    if (questions.length > 0) list.push({ key: 'question', label: t('interaction.questions'), icon: HelpCircle, badge: String(questions.length) })
    if (plan) list.push({ key: 'plan', label: t('interaction.plan'), icon: ListChecks })
    if (todos.length > 0) list.push({ key: 'todo', label: t('interaction.tasks'), icon: ClipboardList, badge: `${todos.filter(t => t.status === 'completed').length}/${todos.length}` })
    return list
  }, [questions, plan, todos, t])

  const pendingPlan = plan && !plan.decided
  // todo 分区不再只跟着 streaming：切走页面再回来时流已断（后端循环也随请求取消），
  // 但任务清单是落过库的，只要还有未完成项就该继续显示，全部完成后自动收起
  const todosPending = todos.length > 0 && (streaming || todos.some((t) => t.status !== 'completed'))
  const visible = questions.length > 0 || !!pendingPlan || todosPending

  const priorityTab: InteractionTab | null = questions.length > 0 ? 'question' : pendingPlan ? 'plan' : todos.length > 0 ? 'todo' : null

  // 新交互到达（优先级变化）时重置手动选择，并在抽屉重新出现时恢复展开态
  const [prevPriority, setPrevPriority] = useState<InteractionTab | null>(priorityTab)
  const [prevVisible, setPrevVisible] = useState(visible)
  if (priorityTab !== prevPriority) {
    setPrevPriority(priorityTab)
    setSelectedTab(null)
  }
  if (visible !== prevVisible) {
    setPrevVisible(visible)
    if (visible) setCollapsed(false)
  }

  // 计划已决策后短暂停留即收起，保持输入区整洁
  useEffect(() => {
    if (!plan?.decided) return
    const timer = setTimeout(() => setCollapsed(true), 4000)
    return () => clearTimeout(timer)
  }, [plan?.decided, plan?.toolCallId])

  if (!visible) return null

  const active = selectedTab && tabs.some(t => t.key === selectedTab) ? selectedTab : tabs[0]?.key
  const activeMeta = tabs.find(t => t.key === active)

  const todoCompleted = todos.filter(todo => todo.status === 'completed').length
  const todoPercent = todos.length === 0 ? 0 : Math.round((todoCompleted / todos.length) * 100)
  const answerCount = questions.filter(q => state.questionAnswers[q.id]).length

  const title = active === 'plan'
    ? (plan?.title || t('interaction.executionPlan'))
    : active === 'todo'
      ? t('interaction.workPlan')
      : t('interaction.answering')

  const meta = active === 'plan'
    ? `${plan ? t('interaction.steps', { count: plan.steps.length }) : ''}${plan?.decided === 'approved' ? t('interaction.approved') : plan?.decided === 'rejected' ? t('interaction.rejected') : t('interaction.pendingConfirm')}`
    : active === 'todo'
      ? `${todoCompleted}/${todos.length} · ${todoPercent}%${todos.length > 0 && todoCompleted === todos.length ? t('interaction.allCompleted') : ''}`
      : `${answerCount}/${questions.length}`

  return (
    <div className="mb-2 animate-drawer-up">
      <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white/95 shadow-xl shadow-gray-900/[0.04] ring-1 ring-black/[0.02] backdrop-blur-md dark:border-gray-700/80 dark:bg-gray-800/95 dark:shadow-black/20">
        {/* Header：标题 + 分区切换 + 折叠 */}
        <div className="flex items-center gap-2.5 px-3.5 py-2.5">
          <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl ring-1 ${
            active === 'plan'
              ? 'bg-teal-100 text-teal-600 ring-teal-200/60 dark:bg-teal-900/50 dark:text-teal-400 dark:ring-teal-800/50'
              : active === 'todo'
                ? 'bg-sky-100 text-sky-600 ring-sky-200/60 dark:bg-sky-900/50 dark:text-sky-400 dark:ring-sky-800/50'
                : 'bg-indigo-100 text-indigo-600 ring-indigo-200/60 dark:bg-indigo-900/50 dark:text-indigo-400 dark:ring-indigo-800/50'
          }`}>
            {activeMeta ? <activeMeta.icon size={15} /> : <HelpCircle size={15} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-gray-800 dark:text-gray-100">
              {title}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-gray-400 dark:text-gray-500">
              {meta}
            </div>
          </div>

          {/* 分区切换 */}
          {tabs.length > 1 && (
            <div className="flex items-center gap-0.5 rounded-xl bg-gray-100 p-0.5 dark:bg-gray-900/60">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setSelectedTab(tab.key)}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-all ${
                    active === tab.key
                      ? 'bg-white text-gray-800 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  <tab.icon size={11} />
                  {tab.label}
                  {tab.badge && <span className="tabular-nums opacity-70">{tab.badge}</span>}
                </button>
              ))}
            </div>
          )}

          <IconButton variant="ghost" tone="gray" className="flex-shrink-0 rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300" label={collapsed ? t('interaction.expandDrawer') : t('interaction.collapseDrawer')} type="button"
            onClick={() => setCollapsed(v => !v)}
            aria-label={collapsed ? t('interaction.expandDrawer') : t('interaction.collapseDrawer')}>
            {collapsed ? <ChevronRight size={14} className="-rotate-90" /> : <ChevronDown size={14} />}
          </IconButton>
        </div>

        {/* Body */}
        {!collapsed && (
          <div className="max-h-[min(42vh,340px)] overflow-y-auto border-t border-gray-100 dark:border-gray-700/60">
            {active === 'question' && questions.length > 0 && (
              <QuestionFlow
                questions={questions}
                currentIndex={state.questionIndex}
                answers={state.questionAnswers}
                onAnswer={(qid, value) => answer(streamKey, qid, value)}
                onIndexChange={(idx) => setQuestionIndex(streamKey, idx)}
                onSubmitAll={() => void submitAnswers(streamKey)}
                compact
              />
            )}
            {active === 'plan' && plan && (
              <PlanFlow
                plan={plan}
                onFeedback={(feedback) => setPlanFeedback(streamKey, feedback)}
                onDecide={(approved) => void decidePlan(streamKey, approved)}
                hideHeader
              />
            )}
            {active === 'todo' && todos.length > 0 && <TodoSection todos={todos} />}
          </div>
        )}
      </div>
    </div>
  )
}
