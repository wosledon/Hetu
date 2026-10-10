import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { FileText, Send, Square, X } from 'lucide-react'
import InputCommandMenu, { extractMentionQuery, extractSlashQuery, type InputCommandItem } from '../InputCommandMenu'
import { countTextLines, isLongText } from '../../utils/longText'

/** 输入框上方的上下文 chip（引用文件 / 提示词模板 / 技能 / 选中代码 等） */
export interface AgentInputChip {
  id: string
  label: string
  icon?: ReactNode
  /** blue=引用文件，amber=提示词/上下文，violet=技能 */
  tone?: 'blue' | 'amber' | 'violet'
  title?: string
  /** 当前模型不支持该附件时：前边加感叹号并划掉（仍可移除） */
  struck?: boolean
  onRemove: () => void
}

/** @ 引用 / / 指令 浮层配置；为 null 时不显示 */
export interface AgentInputMenu {
  kind: 'mention' | 'slash'
  items: InputCommandItem[]
  onSelect: (item: InputCommandItem) => void
  emptyHint?: string
}

/** 输入框探测到的浮层状态 */
export interface AgentInputMenuState {
  kind: 'mention' | 'slash'
  query: string
}

export interface AgentInputBoxProps {
  value: string
  /** 文本变化：同时回传光标位置 */
  onChange: (value: string, cursor: number) => void
  /**
   * 浮层状态变化：由输入框自己探测 @ / / 查询词后回传，调用方据此过滤候选项。
   * 两侧原本各写一份检测逻辑，收敛到这里。
   */
  onMenuChange?: (menu: AgentInputMenuState | null) => void
  onSubmit: () => void
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  menu: AgentInputMenu | null
  chips?: AgentInputChip[]
  /** 各端自有控件（附件/智能体/模型/工具开关 或 权限模式/Agent/模型/推理强度） */
  toolbar?: ReactNode
  /** 右下角发送键左侧的控件（如会话信息：上下文占用） */
  trailing?: ReactNode
  /** 聊天框下方左侧控件（如 Agent 模式 / 审批模式），与右侧的 trailing 同一行 */
  footerLeading?: ReactNode
  /** 输入框上方的插槽（工具交互抽屉等） */
  aboveInput?: ReactNode
  placeholder?: string
  /** 流式中：禁止提交 */
  busy?: boolean
  /** 流式中：显示停止按钮 */
  streaming?: boolean
  onStop?: () => void
  /** ↑↓ 回溯历史输入 */
  history?: string[]
  /** 是否可以提交（调用方的额外条件，如附件/引用为空） */
  canSubmit?: boolean
  rows?: number
  /** 底部提示文字 */
  hint?: string
}

const CHIP_TONES: Record<string, string> = {
  blue: 'border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  amber: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  violet: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
}

/** 从输入与光标探测当前应显示的浮层类型；输入框与调用方共用 */
function detectInputMenu(value: string, cursor: number): AgentInputMenuState | null {
  const slash = extractSlashQuery(value, cursor)
  if (slash !== null) return { kind: 'slash', query: slash }
  const mention = extractMentionQuery(value, cursor)
  if (mention !== null) return { kind: 'mention', query: mention }
  return null
}

/**
 * Agent 输入框。对话页与编码会话共用：
 * - 统一的 @ 引用 / / 指令 浮层探测与键盘导航（↑↓ / Enter / Tab / Escape）
 * - 统一的上下文 chips、↑↓ 历史回溯、Enter 发送 / Shift+Enter 换行、停止按钮
 * - 各端差异通过 toolbar / aboveInput / chips 注入，不复制输入逻辑
 */
export default function AgentInputBox({
  value,
  onChange,
  onMenuChange,
  onSubmit,
  onPaste,
  textareaRef,
  menu,
  chips = [],
  toolbar,
  trailing,
  footerLeading,
  aboveInput,
  placeholder = '输入消息，Enter 发送...',
  busy = false,
  streaming = false,
  onStop,
  history = [],
  canSubmit = true,
  rows = 2,
  hint,
}: AgentInputBoxProps) {
  const localRef = useRef<HTMLTextAreaElement | null>(null)
  const inputRef = textareaRef ?? localRef
  const [menuIndex, setMenuIndex] = useState(0)
  const historyIndexRef = useRef(-1)
  const menuItems = menu?.items ?? []
  // 是否显示由调用方决定（它掌握自己的过滤条件）；这里只在有菜单时渲染，
  // 候选项为空时仍显示标题与 emptyHint，与改造前行为一致。
  const showMenu = menu !== null

  // 超长输入（粘贴的日志/JSON/base64）默认折叠成一行摘要，只展示行数与字符数，
  // 需要改动时再展开；内容一直在 value 里，折叠不影响发送。
  const lineCount = countTextLines(value)
  const isOverlong = isLongText(value)
  const [expanded, setExpanded] = useState(false)
  const collapsed = isOverlong && !expanded

  useEffect(() => {
    if (!isOverlong) setExpanded(false)
  }, [isOverlong])

  useEffect(() => {
    if (expanded) inputRef.current?.focus()
  }, [expanded, inputRef])

  /** 输入变化：探测 @ / / 查询词回传调用方，并复位菜单/历史索引 */
  const handleChange = (next: string, cursor: number) => {
    onChange(next, cursor)
    onMenuChange?.(detectInputMenu(next, cursor))
    setMenuIndex(0)
    historyIndexRef.current = -1
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 浮层打开时：导航与选择优先
    if (showMenu && menu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMenuIndex((i) => (i + 1) % menuItems.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMenuIndex((i) => (i - 1 + menuItems.length) % menuItems.length)
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        menu.onSelect(menuItems[menuIndex])
        setMenuIndex(0)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        // 重新探测一次：@ / / 查询词已消失时由调用方关闭浮层
        onMenuChange?.(detectInputMenu(value, e.currentTarget.selectionStart ?? value.length))
        return
      }
    }

    // ↑↓ 回溯历史输入
    if (e.key === 'ArrowUp' && history.length > 0) {
      e.preventDefault()
      const next = historyIndexRef.current < 0 ? history.length - 1 : Math.max(0, historyIndexRef.current - 1)
      historyIndexRef.current = next
      onChange(history[next], history[next].length)
      return
    }
    if (e.key === 'ArrowDown' && historyIndexRef.current >= 0) {
      e.preventDefault()
      const next = historyIndexRef.current + 1
      if (next >= history.length) {
        historyIndexRef.current = -1
        onChange('', 0)
      } else {
        historyIndexRef.current = next
        onChange(history[next], history[next].length)
      }
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="bg-white p-3 dark:bg-gray-900">
      <div className="relative mx-auto max-w-3xl">
        {aboveInput}
        <div className="relative rounded-xl border border-gray-200 bg-white shadow-sm transition-colors focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-800">
          {showMenu && menu && (
            <InputCommandMenu
              title={menu.kind === 'mention' ? '输入 @ 引用' : '输入 / 使用模板或技能'}
              items={menuItems}
              selectedIndex={menuIndex}
              onSelect={(item) => {
                setMenuIndex(0)
                menu.onSelect(item)
              }}
              emptyHint={menu.emptyHint ?? (menu.kind === 'mention' ? '输入关键词搜索...' : '没有匹配项')}
            />
          )}

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
              {chips.map((chip) => (
                <span
                  key={chip.id}
                  title={chip.title}
                  className={`flex max-w-64 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${CHIP_TONES[chip.struck ? 'amber' : chip.tone ?? 'blue']}`}
                >
                  {chip.struck && (
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white">!</span>
                  )}
                  {chip.icon}
                  <span className={`truncate ${chip.struck ? 'line-through' : ''}`}>{chip.label}</span>
                  <button
                    onClick={chip.onRemove}
                    aria-label={`移除 ${chip.label}`}
                    className="shrink-0 rounded-full p-0.5 opacity-60 transition-opacity hover:opacity-100"
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {collapsed ? (
            <div
              role="button"
              tabIndex={0}
              title="点击展开编辑"
              onClick={() => setExpanded(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  onSubmit()
                }
              }}
              className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm"
            >
              <FileText size={14} className="shrink-0 text-gray-400" />
              <span className="shrink-0 text-gray-600 dark:text-gray-300">已折叠粘贴的长文本</span>
              <span className="truncate text-xs text-gray-400">{lineCount} 行 · {value.length} 字符</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setExpanded(true)
                }}
                className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[11px] text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
              >
                展开
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onChange('', 0)
                  onMenuChange?.(null)
                }}
                aria-label="清空输入"
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              >
                清空
              </button>
            </div>
          ) : (
            <textarea
              ref={inputRef}
              value={value}
              onChange={(e) => handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
              onKeyDown={handleKeyDown}
              onPaste={onPaste}
              placeholder={placeholder}
              rows={rows}
              className="w-full resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
            />
          )}

          <div className="flex flex-wrap items-center gap-1 px-1.5 py-1.5">
            {toolbar}
            <div className="ml-auto">
              {streaming ? (
                <button
                  onClick={onStop}
                  title="停止生成"
                  aria-label="停止生成"
                  className="flex h-[27px] w-[27px] items-center justify-center rounded-lg bg-red-500 text-white transition-colors hover:bg-red-600"
                >
                  <Square size={13} fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={onSubmit}
                  disabled={busy || !canSubmit}
                  title="发送"
                  aria-label="发送"
                  className="flex h-[27px] w-[27px] items-center justify-center rounded-lg bg-blue-500 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-gray-700 dark:disabled:text-gray-500"
                >
                  <Send size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 聊天框下方：左侧 Agent 模式/审批模式，中间提示文字，右侧会话信息（上下文占用） */}
        {(hint || trailing || footerLeading) && (
          <div className="mt-1.5 flex items-center gap-2">
            {footerLeading && <div className="flex shrink-0 items-center gap-1">{footerLeading}</div>}
            {hint && <p className="min-w-0 flex-1 truncate text-[10px] text-gray-400">{hint}</p>}
            {trailing && <div className="flex shrink-0 items-center gap-1">{trailing}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
