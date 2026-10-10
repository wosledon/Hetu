import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  CircleCheckBig,
  Circle,
  ClipboardList,
  HelpCircle,
  ListChecks,
  Loader2,
} from 'lucide-react'
import { getInteraction, useInteractionStore } from '../stores/interactionStore'
import type { InteractionTodo } from '../stores/interactionStore'
import QuestionFlow from './tools/QuestionFlow'
import PlanFlow from './tools/PlanFlow'

type InteractionTab = 'question' | 'plan' | 'todo'

interface ToolInteractionDrawerProps {
  /** 对话页传 topicId，编码页传 workSessionId；同时作为 answer/plan 接口的 sessionId */
  streamKey: string
  /** 流式进行中：任务面板仅在流式期间展示 */
  streaming?: boolean
}

/** 单个待办步骤 */
function TodoRow({ todo, index }: { todo: InteractionTodo; index: number }) {
  const isCompleted = todo.status === 'completed'
  const isInProgress = todo.status === 'in-progress'
  return (
    <li className="flex items-start gap-2.5 text-xs">
      <span className="mt-0.5 flex-shrink-0">
        {isCompleted ? (
          <CircleCheckBig size={14} className="text-emerald-500" />
        ) : isInProgress ? (
          <Loader2 size={14} className="animate-spin text-sky-500" />
        ) : (
          <Circle size={14} className="text-gray-300 dark:text-gray-600" />
        )}
      </span>
      <span className={`flex-1 leading-relaxed ${
        isCompleted
          ? 'text-gray-400 line-through dark:text-gray-500'
          : isInProgress
            ? 'font-medium text-sky-700 dark:text-sky-300'
            : 'text-gray-600 dark:text-gray-400'
      }`}>
        {todo.title}
        {todo.description && (
          <span className="ml-1.5 text-[10px] text-gray-400 dark:text-gray-500">{todo.description}</span>
        )}
      </span>
      <span className="flex-shrink-0 text-[10px] tabular-nums text-gray-300 dark:text-gray-600">
        {String(index + 1).padStart(2, '0')}
      </span>
    </li>
  )
}

/** 工作计划面板：进度条 + 步骤列表（标题/计数已在抽屉头部展示，这里不再重复一层“额头”） */
function TodoSection({ todos }: { todos: InteractionTodo[] }) {
  const total = todos.length
  const completed = todos.filter(t => t.status === 'completed').length
  const allDone = total > 0 && completed === total
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100)

  return (
    <div className="px-4 py-3">
      <div className="h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            allDone ? 'bg-emerald-500' : 'bg-gradient-to-r from-sky-400 to-indigo-500'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <ul className="mt-3 space-y-2">
        {todos.map((t, idx) => <TodoRow key={t.id} todo={t} index={idx} />)}
      </ul>
    </div>
  )
}

/**
 * 工具交互抽屉：ask_question / todo / plan 触发时在输入框上方滑出。
 * 对话页与编码页共用；答案与计划决策通过共享的 /chat-messages 接口提交。
 */
export default function ToolInteractionDrawer({ streamKey, streaming = false }: ToolInteractionDrawerProps) {
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
    if (questions.length > 0) list.push({ key: 'question', label: '提问', icon: HelpCircle, badge: String(questions.length) })
    if (plan) list.push({ key: 'plan', label: '计划', icon: ListChecks })
    if (todos.length > 0) list.push({ key: 'todo', label: '任务', icon: ClipboardList, badge: `${todos.filter(t => t.status === 'completed').length}/${todos.length}` })
    return list
  }, [questions, plan, todos])

  const pendingPlan = plan && !plan.decided
  const visible = questions.length > 0 || !!pendingPlan || (streaming && todos.length > 0)

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

  const summary = active === 'plan'
    ? plan && `${plan.title || '执行计划'} · ${plan.steps.length} 个步骤${plan.decided === 'approved' ? ' · 已批准' : plan.decided === 'rejected' ? ' · 已驳回' : ' · 待确认'}`
    : active === 'todo'
      ? `工作计划 · ${todos.filter(t => t.status === 'completed').length}/${todos.length}${todos.length > 0 && todos.every(t => t.status === 'completed') ? ' · 已全部完成' : ''}`
      : '提问作答中'

  return (
    <div className="mb-2 animate-drawer-up">
      <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white/95 shadow-lg shadow-gray-900/5 ring-1 ring-black/[0.02] backdrop-blur-md dark:border-gray-700/80 dark:bg-gray-800/95 dark:shadow-black/20">
        {/* 抽屉把手 */}
        <div className="flex justify-center pt-2">
          <span className="h-1 w-8 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>

        {/* Header：标题 + 分区切换 + 折叠 */}
        <div className="flex items-center gap-2 px-3 py-2">
          <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${
            active === 'plan'
              ? 'bg-teal-100 text-teal-600 dark:bg-teal-900/50 dark:text-teal-400'
              : active === 'todo'
                ? 'bg-sky-100 text-sky-600 dark:bg-sky-900/50 dark:text-sky-400'
                : 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-400'
          }`}>
            {activeMeta ? <activeMeta.icon size={14} /> : <HelpCircle size={14} />}
          </div>
          <div className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-700 dark:text-gray-200">
            {summary}
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

          <button
            type="button"
            onClick={() => setCollapsed(v => !v)}
            aria-label={collapsed ? '展开抽屉' : '收起抽屉'}
            className="flex-shrink-0 rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          >
            {collapsed ? <ChevronRight size={14} className="-rotate-90" /> : <ChevronDown size={14} />}
          </button>
        </div>

        {/* Body */}
        {!collapsed && (
          <div className="max-h-[min(40vh,320px)] overflow-y-auto border-t border-gray-100 dark:border-gray-700/60">
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
