import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot, Check, Copy, Database, FileText, Folder, Globe, LayoutGrid, Pencil, Plus, Search,
  Settings, Sparkles, Star, Tag as TagIcon, Trash2, X, Zap,
} from 'lucide-react'
import AppLayout from '../components/AppLayout'
import Select from '../components/Select'
import MultiSelect from '../components/MultiSelect'
import { useConfirm } from '../components/confirm'
import {
  Badge, Button, Card, Checkbox, Chip, ContextMenu, EmptyState, FileInput, IconButton, Input, Modal,
  PageContainer, Pagination, PillTabs, SearchInput, Slider, Spinner, SurfaceButton, Switch, Textarea,
  ToolbarToggle, Tooltip, TreeRow, WorkbenchColumn, type Tone,
} from '../components/ui'
import { SOLID } from '../components/ui/tones'
import { TAG_COLOR_HEX } from '../utils/tagColor'
import type { InputCommandItem } from '../components/InputCommandMenu'
import AgentInputBox, { type AgentInputChip, type AgentInputMenu, type AgentInputMenuState } from '../components/agent/AgentInputBox'
import AgentPlusMenu from '../components/agent/AgentPlusMenu'
import AgentQueueBar, { type PendingMessage } from '../components/agent/AgentQueueBar'
import AgentModelPicker, { type ModelPickerModel, type ModelPickerProvider } from '../components/agent/AgentModelPicker'
import AgentPicker, { type AgentPickerItem } from '../components/agent/AgentPicker'
import AgentPermissionSelect from '../components/agent/AgentPermissionSelect'
import AgentContextUsage from '../components/agent/AgentContextUsage'
import AgentUsageBadge from '../components/agent/AgentUsageBadge'
import AgentReasoningSelect from '../components/agent/AgentReasoningSelect'
import AgentApprovalCard from '../components/agent/AgentApprovalCard'
import QuestionFlow from '../components/tools/QuestionFlow'
import PlanFlow from '../components/tools/PlanFlow'
import type { InteractionPlan, InteractionQuestion } from '../stores/interactionStore'
import BrandMark from '../components/BrandMark'
import ChatMessageItem from '../components/ChatMessageItem'
import ChatToolCallRow from '../components/ChatToolCallRow'
import CollapsedLongText from '../components/CollapsedLongText'
import ConversationRail from '../components/ConversationRail'
import DatePicker from '../components/DatePicker'
import EmojiPicker from '../components/EmojiPicker'
import HighlightText from '../components/HighlightText'
import NoteSearchResults from '../components/NoteSearchResults'
import ThemedMarkdown from '../components/ThemedMarkdown'
import ToolCallGroup from '../components/ToolCallGroup'
import { WeekHourHeatmap } from '../components/UsageHeatmap'
import type { ToolCallEntry } from '../utils/toolRendering'
import type { IUsageHourStat } from '../services/usageService'
import type { AgentUsage } from '../utils/agentStream'
import type { IContextUsage } from '../types/context'
import type { IChatMessage, INoteSearchResult } from '../types'

/** 与 tones.ts 的键保持一致；显式列出，避免 Object.keys 的断言 */
const TONES: Tone[] = ['blue', 'indigo', 'violet', 'emerald', 'green', 'teal', 'cyan', 'sky', 'amber', 'rose', 'red', 'gray']

const SECTION_KEYS = ['foundations', 'buttons', 'iconButtons', 'inputs', 'cards', 'tabs', 'tree', 'pagination', 'conversation', 'content', 'overlays', 'status', 'layouts'] as const
type SectionKey = (typeof SECTION_KEYS)[number]

const DEMO_MODELS: ModelPickerModel[] = [
  { id: 'gallery-flash', displayName: 'Gallery Flash', providerId: 'demo', contextWindow: 262144, reasoningMode: 'native', reasoningEfforts: '["low","medium","high"]' },
  { id: 'gallery-pro', displayName: 'Gallery Pro', providerId: 'demo', contextWindow: 131072 },
]
const DEMO_PROVIDERS: ModelPickerProvider[] = [{ id: 'demo', name: 'Demo Provider' }]

const DEMO_USAGE: AgentUsage = {
  promptTokens: 8420,
  completionTokens: 1260,
  cachedTokens: 3100,
  totalTokens: 9680,
  latencyMs: 2100,
}

const DEMO_CONTEXT_USAGE: IContextUsage = {
  window: 262144,
  used: 46800,
  parts: [
    { key: 'system', label: 'System prompt', tokens: 4200, chars: 16800, estimated: true },
    { key: 'history', label: 'History', tokens: 42600, chars: 170400, estimated: true },
  ],
  hasSummary: false,
  summarizedMessages: 0,
  ratio: 0.1786,
}

const AGENT_PICKER_ITEMS: AgentPickerItem[] = [
  { id: 'general', name: 'General assistant', description: 'Daily Q&A and writing', icon: 'bot' },
  { id: 'reviewer', name: 'Reviewer', description: 'Reviews diffs before merge', icon: 'brain' },
]
const AGENT_PICKER_PROJECT_ITEMS: AgentPickerItem[] = [
  { id: 'repo-agent', name: 'Repo maintainer', description: 'Owns the release checklist', icon: 'bot', badge: '.github' },
]
const AGENT_PICKER_WORKFLOWS: AgentPickerItem[] = [
  { id: 'weekly', name: 'Weekly report', description: 'Collect notes and draft the report', icon: 'git' },
]

const IMAGE_THUMB = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='16' height='16' rx='3' fill='%23bfdbfe'/%3E%3Ccircle cx='11' cy='5' r='3' fill='%23f59e0b'/%3E%3Cpath d='M2 14l4-5 3 3 2-2 3 4z' fill='%233b82f6'/%3E%3C/svg%3E"

const CHIP_TAG_CLASS = {
  skill: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
  agent: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  prompt: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  note: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  tag: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  kb: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
} as const

const SLASH_ITEMS: InputCommandItem[] = [
  { key: 'explain', label: 'explain', description: 'Explain the selected content', icon: <Sparkles size={14} />, tag: 'skill', tagClass: CHIP_TAG_CLASS.skill },
  { key: 'summarize', label: 'summarize', description: 'Summarize into bullet points', icon: <FileText size={14} />, tag: 'skill', tagClass: CHIP_TAG_CLASS.skill },
  { key: 'reviewer', label: 'Reviewer', description: 'Code review agent', icon: <Bot size={14} />, tag: 'agent', tagClass: CHIP_TAG_CLASS.agent },
  { key: 'weekly', label: 'weekly-report', description: 'Project prompt template', icon: <FileText size={14} />, tag: 'prompt', tagClass: CHIP_TAG_CLASS.prompt },
]

const MENTION_ITEMS: InputCommandItem[] = [
  { key: 'm-note', label: 'Release checklist', icon: <FileText size={14} />, tag: 'note', tagClass: CHIP_TAG_CLASS.note },
  { key: 'm-tag', label: 'design-system', icon: <TagIcon size={14} />, tag: 'tag', tagClass: CHIP_TAG_CLASS.tag },
  { key: 'm-kb', label: 'Product wiki', icon: <FileText size={14} />, tag: 'kb', tagClass: CHIP_TAG_CLASS.kb },
]

const SAMPLE_MARKDOWN = [
  '## ThemedMarkdown',
  '',
  '**GFM** table · code · inline math · mermaid.',
  '',
  '| Surface | Radius |',
  '| --- | --- |',
  '| Control | `rounded-lg` |',
  '| Card | `rounded-2xl` |',
  '',
  '```ts',
  'export function cn(...inputs: ClassValue[]) {',
  '  return twMerge(clsx(inputs))',
  '}',
  '```',
  '',
  'Inline math: $E = mc^2$',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[Composer] --> B{Menu open?}',
  '  B -- / or @ --> C[InputCommandMenu]',
  '  B -- no --> D[Send]',
  '```',
].join('\n')

const DEMO_NOTES: INoteSearchResult[] = [
  { id: 'n1', title: 'Design system overview', contentSnippet: 'The design system keeps every surface consistent: tone tokens, radii, and glass materials.', updatedAt: '2026-11-28T06:00:00Z' },
  { id: 'n2', title: 'Design tokens migration', contentSnippet: 'Migrate ad-hoc colors to the shared tone palette; components only read tokens.', updatedAt: '2026-11-27T09:30:00Z' },
  { id: 'n3', title: 'Component review notes', contentSnippet: 'Reviewed the composer and message bubbles; keep spacing and radii aligned with the design system.', updatedAt: '2026-11-25T14:10:00Z' },
]

type ChipSpec = Omit<AgentInputChip, 'onRemove'>

const LONG_SAMPLE = Array.from({ length: 30 }, (_, i) => `line ${i + 1}: the quick brown fox jumps over the lazy dog`).join('\n')

const SELECT_OPTIONS = [
  { value: 'notes', label: 'Notes' },
  { value: 'knowledge', label: 'Knowledge base' },
  { value: 'code', label: 'Code session' },
  { value: 'archived', label: 'Archived', disabled: true },
]

const MULTI_OPTIONS = [
  { value: 'chat', label: 'Chat', group: 'Workspace' },
  { value: 'notes', label: 'Notes', group: 'Workspace' },
  { value: 'kb', label: 'Knowledge base', group: 'Workspace' },
  { value: 'web', label: 'Web search', group: 'Tools' },
  { value: 'code', label: 'Code index', group: 'Tools' },
]

const TAG_DEMO_COLORS = Object.keys(TAG_COLOR_HEX).slice(0, 6)

function Section({ id, title, desc, children }: {
  id: SectionKey
  title: string
  desc?: string
  children: ReactNode
}) {
  return (
    <section id={`sec-${id}`} className="scroll-mt-6">
      <div className="mb-3">
        <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-gray-100">{title}</h2>
        {desc && <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{desc}</p>}
      </div>
      <div className="rounded-2xl border border-gray-100 bg-white/55 p-4 sm:p-5 dark:border-white/[0.07] dark:bg-white/[0.02]">
        {children}
      </div>
    </section>
  )
}

function SpecRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-gray-100/80 py-3 first:pt-0 last:border-0 last:pb-0 sm:flex-row dark:border-white/[0.06]">
      <span className="w-24 shrink-0 pt-0.5 text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">{children}</div>
    </div>
  )
}

function Bar({ className }: { className?: string }) {
  return <div className={`h-1.5 rounded-full bg-gray-200/90 dark:bg-white/10 ${className ?? ''}`} />
}

function WireDot({ className }: { className?: string }) {
  return <div className={`h-2 w-2 shrink-0 rounded-full bg-gray-300 dark:bg-white/15 ${className ?? ''}`} />
}

/** 布局示意框：顶部标题 + 内部线框 */
function Wireframe({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="overflow-hidden rounded-xl border border-gray-200/80 bg-gray-50/60 dark:border-white/[0.08] dark:bg-white/[0.02]">
        {children}
      </div>
      <p className="mt-2 text-center text-[10px] text-gray-400 dark:text-gray-500">{title}</p>
    </div>
  )
}

/** 对话业务组件：输入框 / 队列 / 消息 / 工具行 / 审批，全部用生产组件实渲染 */
function ConversationDemos() {
  const { t } = useTranslation(['components', 'common'])
  const [composer, setComposer] = useState('')
  const [composerMenu, setComposerMenu] = useState<AgentInputMenuState | null>(null)
  const [chips, setChips] = useState<ChipSpec[]>([
    { id: 'note', label: 'Release checklist', tone: 'amber', icon: <FileText size={12} /> },
    { id: 'tag', label: 'design-system', tone: 'emerald', icon: <TagIcon size={12} /> },
    { id: 'file', label: 'README.md', tone: 'sky', icon: <FileText size={12} /> },
    { id: 'image', label: 'screenshot.png', tone: 'cyan', imageUrl: IMAGE_THUMB },
    { id: 'image-struck', label: 'photo.png', tone: 'cyan', imageUrl: IMAGE_THUMB, struck: true, title: 'Unsupported by current model' },
  ])
  const [queue, setQueue] = useState<PendingMessage[]>([
    { id: 'q-1', content: '先跑一遍单元测试' },
    { id: 'q-2', content: '再把改动整理成 PR 说明' },
  ])
  const [steeringId, setSteeringId] = useState<string | null>(null)
  const [modelId, setModelId] = useState(DEMO_MODELS[0].id)
  const [effort, setEffort] = useState('')
  const [ctxWindow, setCtxWindow] = useState<number | undefined>(undefined)
  // 输入框外层「额头」的快速开关（与主对话一致：工具调用 / 联网 / 知识库；推理强度在模型选择器里）
  const [toolCalling, setToolCalling] = useState(true)
  const [webSearch, setWebSearch] = useState(false)
  const [knowledgeBase, setKnowledgeBase] = useState(true)
  const [agentId, setAgentId] = useState<string | undefined>(undefined)
  const [projectAgentId, setProjectAgentId] = useState<string | undefined>(undefined)
  const [workflowId, setWorkflowId] = useState<string | undefined>(undefined)
  const [permissionMode, setPermissionMode] = useState('ask')
  const [tagThinking, setTagThinking] = useState(false)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({})
  const railScrollRef = useRef<HTMLDivElement>(null)
  const railItems = [
    { id: 'rail-1', content: '帮我梳理组件规范' },
    { id: 'rail-2', content: '把这些组件整理进组件页' },
    { id: 'rail-3', content: '再检查亮色和暗色的表现' },
  ]
  const noop = () => undefined

  const demoQuestions: InteractionQuestion[] = [
    {
      id: 'q-1',
      toolCallId: 'demo',
      header: '范围',
      question: '这次组件页要覆盖哪些组件？',
      options: [
        { label: '全部共享组件', description: 'ui 基础组件 + 业务组件' },
        { label: '仅对话组件' },
      ],
      allowCustom: true,
    },
  ]
  const demoPlan: InteractionPlan = {
    toolCallId: 'demo',
    title: '把对话组件整理进组件页',
    summary: '补齐输入框双层结构、真实选择器与审批卡，并用生产组件实渲染。',
    feedback: '',
    steps: [
      { id: 'p-1', title: '盘点页面实际使用的组件', status: 'completed' },
      { id: 'p-2', title: '替换示例中的仿制品', status: 'in-progress' },
      { id: 'p-3', title: '浏览器逐项验收' },
    ],
  }

  const chipsForInput: AgentInputChip[] = chips.map((chip) => ({
    ...chip,
    onRemove: () => setChips((list) => list.filter((c) => c.id !== chip.id)),
  }))

  const menu: AgentInputMenu | null = composerMenu
    ? {
        kind: composerMenu.kind,
        items: (composerMenu.kind === 'slash' ? SLASH_ITEMS : MENTION_ITEMS)
          .filter((item) => item.label.toLowerCase().includes(composerMenu.query.toLowerCase())),
        onSelect: (item) => {
          // 演示：把输入中的 / 或 @ 查询替换成选中项名称
          setComposer((prev) => `${prev.replace(/[/@][^\s]*$/, '').trimEnd()} ${item.label} `)
          setComposerMenu(null)
        },
      }
    : null

  const submit = () => {
    const text = composer.trim()
    if (!text) return
    setQueue((prev) => [...prev, { id: `q-${Date.now()}`, content: text }])
    setComposer('')
    setComposerMenu(null)
  }

  const messages: IChatMessage[] = [
    { id: 'demo-user', topicId: 'demo', role: 'user', content: t('components:conversation.userContent'), createdAt: '2026-11-28T10:00:00Z' },
    {
      id: 'demo-assistant',
      topicId: 'demo',
      role: 'assistant',
      content: t('components:conversation.assistantContent'),
      thinkingContent: t('components:conversation.assistantThinking'),
      toolCallsJson: JSON.stringify([
        { kind: 'thought', content: t('components:conversation.assistantThinking') },
        { kind: 'tool', name: 'search_notes', arguments: '{"query":"design system"}', result: '3 hits' },
      ]),
      tokensUsed: 1240,
      cachedTokens: 320,
      latencyMs: 2100,
      createdAt: '2026-11-28T10:00:05Z',
    },
  ]

  const toolEntries: ToolCallEntry[] = [
    { kind: 'thought', name: 'thought', args: '{}', text: t('components:conversation.assistantThinking') },
    { name: 'search_notes', args: '{"query":"design system"}', result: '3 hits' },
    { name: 'work_read_file', args: '{"path":"README.md"}', result: '# Hetu · local-first workspace' },
  ]

  const label = (text: string) => (
    <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">{text}</p>
  )

  return (
    <div className="space-y-6">
      <div>
        {label(t('components:conversation.composer'))}
        <div className="rounded-2xl border border-gray-100 p-3 dark:border-white/[0.06]">
          <AgentInputBox
            value={composer}
            onChange={(value) => setComposer(value)}
            onMenuChange={setComposerMenu}
            onSubmit={submit}
            menu={menu}
            chips={chipsForInput}
            forehead={
              <div className="flex items-center gap-0.5">
                <ToolbarToggle active={toolCalling} tone="indigo" label={t('chat:messageArea.toolCalls')} onClick={() => setToolCalling(!toolCalling)}>
                  <Zap size={13} />
                </ToolbarToggle>
                <ToolbarToggle active={webSearch} tone="emerald" label={t('chat:messageArea.webSearch')} onClick={() => setWebSearch(!webSearch)}>
                  <Globe size={13} />
                </ToolbarToggle>
                <ToolbarToggle active={knowledgeBase} tone="amber" label={t('chat:messageArea.knowledgeBase')} onClick={() => setKnowledgeBase(!knowledgeBase)}>
                  <Database size={13} />
                </ToolbarToggle>
              </div>
            }
            toolbar={
              <>
                <AgentPlusMenu
                  onFiles={noop}
                  onMention={() => { setComposer((v) => `${v}@`); setComposerMenu({ kind: 'mention', query: '' }) }}
                  onSlash={() => { setComposer((v) => `${v}/`); setComposerMenu({ kind: 'slash', query: '' }) }}
                />
                <AgentPicker
                  items={AGENT_PICKER_ITEMS}
                  value={agentId}
                  onSelect={(item) => setAgentId(item.id)}
                  projectItems={AGENT_PICKER_PROJECT_ITEMS}
                  projectValue={projectAgentId}
                  onSelectProject={(item) => setProjectAgentId(item.id)}
                  workflows={AGENT_PICKER_WORKFLOWS}
                  workflowValue={workflowId}
                  onSelectWorkflow={(item) => setWorkflowId(item.id)}
                />
                <AgentPermissionSelect value={permissionMode} onChange={setPermissionMode} />
              </>
            }
            toolbarTrailing={
              <>
                <AgentUsageBadge usage={DEMO_USAGE} compact />
                <AgentContextUsage usage={DEMO_CONTEXT_USAGE} onRefresh={noop} onCompact={noop} />
                <AgentModelPicker
                  models={DEMO_MODELS}
                  providers={DEMO_PROVIDERS}
                  modelId={modelId}
                  onModelChange={setModelId}
                  effort={effort}
                  onEffortChange={setEffort}
                  contextWindow={ctxWindow}
                  onContextWindowChange={setCtxWindow}
                />
              </>
            }
            placeholder={t('components:conversation.composerPlaceholder')}
            canSubmit={composer.trim().length > 0}
            hint={t('components:conversation.composerHint')}
          />
        </div>
      </div>

      <div>
        {label(t('components:conversation.queue'))}
        <AgentQueueBar
          items={queue}
          steeringId={steeringId}
          onSteer={(item) => {
            setSteeringId(item.id)
            window.setTimeout(() => setSteeringId((cur) => (cur === item.id ? null : cur)), 900)
          }}
          onRemove={(item) => setQueue((prev) => prev.filter((x) => x.id !== item.id))}
        />
      </div>

      <div>
        {label(t('components:conversation.messages'))}
        <div className="space-y-6 rounded-2xl border border-gray-100 p-4 dark:border-white/[0.06]">
          {messages.map((message) => (
            <ChatMessageItem
              key={message.id}
              message={message}
              isEditing={false}
              editingContent=""
              isCopied={false}
              actionsDisabled={false}
              onCopy={noop}
              onStartEdit={noop}
              onSaveEdit={noop}
              onCancelEdit={noop}
              onDelete={noop}
              onEditContentChange={noop}
            />
          ))}
        </div>
      </div>

      <div>
        {label(t('components:conversation.rail'))}
        <div className="relative overflow-hidden rounded-2xl border border-gray-100 dark:border-white/[0.06]">
          <ConversationRail items={railItems} scrollRef={railScrollRef} />
          <div ref={railScrollRef} className="h-44 overflow-y-auto px-12 py-4">
            <div className="mx-auto max-w-xl space-y-4">
              {railItems.map((item) => (
                <div key={item.id} data-message-anchor={item.id} className="scroll-mt-2">
                  <div className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-tr-md border border-blue-200/70 bg-blue-50/95 px-4 py-2.5 text-[13px] text-gray-800 shadow-sm dark:border-blue-400/15 dark:bg-blue-500/15 dark:text-gray-100">
                    {item.content}
                  </div>
                  <div className="mt-2 w-full space-y-1.5 rounded-xl border border-gray-100 p-3 dark:border-white/[0.06]">
                    <Bar className="w-2/3" />
                    <Bar className="w-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          {label(t('components:conversation.toolRows'))}
          <div className="space-y-1.5 rounded-2xl border border-gray-100 p-3 dark:border-white/[0.06]">
            <ChatToolCallRow name="search_notes" args='{"query":"design system"}' running />
            <ChatToolCallRow name="work_read_file" args='{"path":"README.md"}' result="# Hetu · local-first workspace" />
            <ChatToolCallRow name="run_command" args='{"command":"npm test"}' result="Exit code 1: 3 tests failed" isError />
            <ChatToolCallRow name="thought" args="{}" text={t('components:conversation.assistantThinking')} />
          </div>
        </div>
        <div>
          {label(t('components:conversation.toolGroup'))}
          <div className="rounded-2xl border border-gray-100 p-3 dark:border-white/[0.06]">
            <ToolCallGroup items={toolEntries} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">AgentApprovalCard</p>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">{t('components:conversation.approvalHint')}</span>
          </div>
          <AgentApprovalCard
            request={{ id: 'ap-1', name: 'work_write_file', arguments: '{"path":"src/App.tsx"}' }}
            onApprove={noop}
            onDeny={noop}
          />
        </div>
        <div>
          {label(t('components:conversation.reasoningTag'))}
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-100 p-3 dark:border-white/[0.06]">
            <AgentReasoningSelect value={effort} onChange={setEffort} reasoningMode="tag" enabled={tagThinking} onEnabledChange={setTagThinking} />
            <span className="text-[11px] text-gray-400 dark:text-gray-500">AgentReasoningSelect</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          {label(t('components:conversation.questionFlow'))}
          <div className="overflow-hidden rounded-2xl border border-gray-100 dark:border-white/[0.06]">
            <QuestionFlow
              questions={demoQuestions}
              currentIndex={questionIndex}
              answers={questionAnswers}
              onAnswer={(questionId, value) => setQuestionAnswers((prev) => ({ ...prev, [questionId]: value }))}
              onIndexChange={setQuestionIndex}
              onSubmitAll={noop}
              compact
            />
          </div>
        </div>
        <div>
          {label(t('components:conversation.planFlow'))}
          <div className="overflow-hidden rounded-2xl border border-gray-100 dark:border-white/[0.06]">
            <PlanFlow plan={demoPlan} onFeedback={noop} onDecide={noop} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** 内容业务组件：Markdown、搜索结果、热力图、日期/表情、关键词高亮 */
function ContentDemos() {
  const { t } = useTranslation(['components', 'common'])
  const [keyword, setKeyword] = useState('design')
  const [selectedNoteId, setSelectedNoteId] = useState<string | undefined>(undefined)
  const [activeIndex, setActiveIndex] = useState(0)
  const [date, setDate] = useState('')
  const [emoji, setEmoji] = useState('📝')

  const heatData = useMemo<IUsageHourStat[]>(() => {
    const out: IUsageHourStat[] = []
    const today = new Date()
    for (let d = 6; d >= 0; d--) {
      const day = new Date(today)
      day.setDate(day.getDate() - d)
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
      for (let h = 0; h < 24; h++) {
        if ((h + d) % 4 === 0) continue
        out.push({ date: iso, hour: h, messages: (h * 3 + d * 5) % 9, tokens: (h * 41 + d * 97) % 1400 })
      }
    }
    return out
  }, [])

  const trimmed = keyword.trim().toLowerCase()
  const results = DEMO_NOTES.filter((note) => `${note.title} ${note.contentSnippet ?? ''}`.toLowerCase().includes(trimmed))

  const label = (text: string) => (
    <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">{text}</p>
  )

  return (
    <div className="space-y-6">
      <div>
        {label(t('components:content.markdown'))}
        <div className="prose prose-sm max-w-none rounded-2xl border border-gray-100 p-4 dark:prose-invert dark:border-white/[0.06]">
          <ThemedMarkdown source={SAMPLE_MARKDOWN} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          {label(t('components:content.searchResults'))}
          <div className="rounded-2xl border border-gray-100 p-3 dark:border-white/[0.06]">
            <div className="mb-2 flex items-center gap-2">
              <span className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500">{t('components:content.searchKeyword')}</span>
              <div className="w-44"><Input size="sm" value={keyword} onChange={(e) => setKeyword(e.target.value)} /></div>
            </div>
            <NoteSearchResults
              keyword={keyword.trim()}
              results={results}
              total={results.length}
              ready
              inFlight={false}
              activeIndex={activeIndex}
              selectedNoteId={selectedNoteId}
              onHover={setActiveIndex}
              onOpen={setSelectedNoteId}
            />
          </div>
        </div>
        <div>
          {label(t('components:content.heatmap'))}
          <div className="rounded-2xl border border-gray-100 p-2 dark:border-white/[0.06]">
            <WeekHourHeatmap data={heatData} metric="messages" />
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          {label(t('components:content.dateEmoji'))}
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-100 p-3 dark:border-white/[0.06]">
            <div className="w-52"><DatePicker value={date} onChange={setDate} placeholder="YYYY-MM-DD" /></div>
            <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
              <EmojiPicker value={emoji} onChange={setEmoji}>
                <span className="text-lg leading-none">{emoji || '＋'}</span>
              </EmojiPicker>
              <span>EmojiPicker</span>
            </div>
          </div>
        </div>
        <div>
          {label(t('components:content.highlight'))}
          <div className="rounded-2xl border border-gray-100 p-3 text-sm text-gray-600 dark:border-white/[0.06] dark:text-gray-300">
            <HighlightText text="The component library keeps every surface consistent." keyword="component" />
          </div>
        </div>
      </div>
      <div>
        {label('CollapsedLongText')}
        <div className="rounded-2xl border border-gray-100 p-3 dark:border-white/[0.06]">
          <CollapsedLongText text={LONG_SAMPLE}>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{LONG_SAMPLE}</pre>
          </CollapsedLongText>
        </div>
      </div>
    </div>
  )
}

export default function ComponentsPage() {
  const { t } = useTranslation(['components', 'common'])
  const confirm = useConfirm()

  const [modalOpen, setModalOpen] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null)
  const [tab, setTab] = useState('overview')
  const [verticalTab, setVerticalTab] = useState('general')
  const [page, setPage] = useState(2)
  const [selectValue, setSelectValue] = useState('notes')
  const [multiValues, setMultiValues] = useState<string[]>(['chat', 'notes'])
  const [searchTerm, setSearchTerm] = useState('')
  const [treeExpanded, setTreeExpanded] = useState(true)
  const [demoToggle, setDemoToggle] = useState(true)
  const [switchDemo, setSwitchDemo] = useState(true)
  const fileDemoRef = useRef<HTMLInputElement>(null)

  const scrollTo = (key: SectionKey) => {
    document.getElementById(`sec-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <AppLayout
      showSidebar={false}
      mainContent={
        <PageContainer>
          {/* 页头 */}
          <div className="mb-8 flex flex-wrap items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-blue-200/70 bg-blue-50 text-blue-600 shadow-sm dark:border-blue-400/15 dark:bg-blue-500/10 dark:text-blue-300">
              <LayoutGrid size={20} />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">{t('components:title')}</h1>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t('components:subtitle')}</p>
            </div>
          </div>

          <div className="flex items-start gap-10">
            {/* 页内锚点 */}
            <aside className="sticky top-4 hidden w-36 shrink-0 lg:block">
              <nav className="space-y-0.5">
                {SECTION_KEYS.map((key) => (
                  <SurfaceButton
                    key={key}
                    type="button"
                    onClick={() => scrollTo(key)}
                    className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-gray-500 transition-colors hover:bg-gray-100/80 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
                  >
                    {t(`components:nav.${key}`)}
                  </SurfaceButton>
                ))}
              </nav>
            </aside>

            <div className="min-w-0 flex-1 space-y-10">
              {/* ── 设计基调 ── */}
              <Section id="foundations" title={t('components:nav.foundations')} desc={t('components:foundations.desc')}>
                <div className="space-y-1">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">{t('components:foundations.tones')}</p>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6">
                    {TONES.map((tone) => (
                      <div key={tone} className={`flex h-14 items-end rounded-xl p-2 text-[10px] font-medium text-white ${SOLID[tone]}`}>
                        {tone}
                      </div>
                    ))}
                  </div>
                  <p className="pt-1 text-[11px] text-gray-400 dark:text-gray-500">{t('components:foundations.tonesHint')}</p>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-gray-200 bg-white/70 px-3 py-2.5 text-[11px] text-gray-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-400">{t('components:foundations.radiusSm')}</div>
                  <div className="rounded-2xl border border-gray-200 bg-white/70 px-3 py-2.5 text-[11px] text-gray-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-400">{t('components:foundations.radiusMd')}</div>
                  <div className="rounded-full border border-gray-200 bg-white/70 px-3 py-2.5 text-[11px] text-gray-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-400">{t('components:foundations.radiusPill')}</div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <Card padded="sm" className="text-[11px] text-gray-500 dark:text-gray-400">{t('components:foundations.materialGlass')}</Card>
                  <Card padded="sm" plain className="border-gray-200 text-[11px] text-gray-500 dark:border-white/[0.08] dark:text-gray-400">{t('components:foundations.materialPlain')}</Card>
                </div>

                <div className="mt-5 space-y-1.5">
                  <p className="text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">{t('components:foundations.typeTitle')}</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{t('components:foundations.typeBody')}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{t('components:foundations.typeMuted')}</p>
                  <p className="font-mono text-[12px] text-gray-600 dark:text-gray-300">{t('components:foundations.typeMono')}</p>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-gray-100/80 pt-4 dark:border-white/[0.06]">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">BrandMark</span>
                  <BrandMark size={44} />
                  <BrandMark size={30} />
                  <BrandMark size={22} />
                </div>
              </Section>

              {/* ── 按钮 ── */}
              <Section id="buttons" title={t('components:nav.buttons')} desc={t('components:buttons.desc')}>
                <SpecRow label={t('components:buttons.variants')}>
                  <Button variant="primary">primary</Button>
                  <Button variant="secondary">secondary</Button>
                  <Button variant="ghost">ghost</Button>
                  <Button variant="soft">soft</Button>
                  <Button variant="outline">outline</Button>
                  <Button variant="danger">danger</Button>
                  <Button variant="link">link</Button>
                </SpecRow>
                <SpecRow label={t('components:buttons.tones')}>
                  {TONES.map((tone) => (
                    <Button key={tone} variant="primary" tone={tone} size="sm">{tone}</Button>
                  ))}
                </SpecRow>
                <SpecRow label={t('components:buttons.sizes')}>
                  <Button size="xs">xs</Button>
                  <Button size="sm">sm</Button>
                  <Button size="md">md</Button>
                  <Button size="lg">lg</Button>
                  <Button pill size="sm">pill</Button>
                </SpecRow>
                <SpecRow label={t('components:buttons.extras')}>
                  <Button variant="soft" icon={<Plus size={13} />}>{t('components:buttons.icon')}</Button>
                  <Button variant="outline" iconRight={<X size={13} />}>{t('components:buttons.iconRight')}</Button>
                  <Button variant="primary" shadow>{t('components:buttons.shadow')}</Button>
                  <Button disabled>{t('components:buttons.disabled')}</Button>
                  <div className="w-40">
                    <Button block>{t('components:buttons.block')}</Button>
                  </div>
                </SpecRow>
              </Section>

              {/* ── 图标按钮 ── */}
              <Section id="iconButtons" title={t('components:nav.iconButtons')} desc={t('components:iconButtons.desc')}>
                <SpecRow label={t('components:iconButtons.variants')}>
                  <IconButton label="ghost"><Star size={15} /></IconButton>
                  <IconButton variant="secondary" label="secondary"><Settings size={15} /></IconButton>
                  <IconButton variant="primary" label="primary"><Plus size={15} /></IconButton>
                  <IconButton variant="soft" label="soft"><Search size={15} /></IconButton>
                  <IconButton variant="danger" label="danger"><Trash2 size={15} /></IconButton>
                  <IconButton variant="success" label="success"><Check size={15} /></IconButton>
                  <IconButton variant="bare" label="bare"><X size={15} /></IconButton>
                  <IconButton variant="ghost" tone="blue" active label="active"><Star size={15} /></IconButton>
                </SpecRow>
                <SpecRow label={t('components:iconButtons.sizes')}>
                  <IconButton size="xs" label="xs"><X size={11} /></IconButton>
                  <IconButton size="tiny" label="tiny"><Star size={13} /></IconButton>
                  <IconButton size="sm" label="sm"><Star size={13} /></IconButton>
                  <IconButton size="md" label="md"><Star size={15} /></IconButton>
                  <IconButton size="lg" label="lg"><Star size={17} /></IconButton>
                  <IconButton disabled label="disabled"><Star size={15} /></IconButton>
                </SpecRow>
                <SpecRow label="ToolbarToggle">
                  <ToolbarToggle active={demoToggle} tone="emerald" label="toggle" onClick={() => setDemoToggle(!demoToggle)}>
                    <Globe size={13} />
                  </ToolbarToggle>
                  <ToolbarToggle active tone="amber" label="active">
                    <Database size={13} />
                  </ToolbarToggle>
                  <ToolbarToggle active={false} tone="indigo" label="idle">
                    <Zap size={13} />
                  </ToolbarToggle>
                </SpecRow>
              </Section>

              {/* ── 输入与选择 ── */}
              <Section id="inputs" title={t('components:nav.inputs')} desc={t('components:inputs.desc')}>
                <SpecRow label={t('components:inputs.sizes')}>
                  <div className="w-32"><Input size="sm" placeholder="sm" /></div>
                  <div className="w-36"><Input size="md" placeholder="md" /></div>
                  <div className="w-40"><Input size="lg" placeholder="lg" /></div>
                </SpecRow>
                <SpecRow label={t('components:inputs.icon')}>
                  <div className="w-48"><Input icon={<Search size={14} />} placeholder="icon" /></div>
                  <div className="w-48">
                    <Input
                      placeholder="iconRight"
                      iconRight={<IconButton size="xs" variant="bare" label={t('common:remove')}><X size={11} /></IconButton>}
                    />
                  </div>
                </SpecRow>
                <SpecRow label={t('components:inputs.tone')}>
                  <div className="w-32"><Input tone="amber" placeholder="amber" /></div>
                  <div className="w-32"><Input tone="emerald" placeholder="emerald" /></div>
                  <div className="w-32"><Input tone="rose" placeholder="rose" /></div>
                </SpecRow>
                <SpecRow label={t('components:inputs.disabled')}>
                  <div className="w-32"><Input disabled placeholder="disabled" /></div>
                </SpecRow>
                <SpecRow label="Switch">
                  <Switch checked={switchDemo} onChange={setSwitchDemo} label="Switch" />
                  <Switch checked onChange={() => undefined} label="checked" />
                  <Switch checked={false} onChange={() => undefined} label="disabled" disabled />
                </SpecRow>
                <SpecRow label="Checkbox / Slider">
                  <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                    <Checkbox defaultChecked /> Checkbox
                  </label>
                  <Checkbox />
                  <Checkbox tone="rose" defaultChecked size="md" />
                  <Slider defaultValue={0.5} min={0} max={1} step={0.1} className="w-40" aria-label="Slider" />
                </SpecRow>
                <SpecRow label="FileInput">
                  <FileInput ref={fileDemoRef} accept=".json" />
                  <Button variant="outline" onClick={() => fileDemoRef.current?.click()}>选择文件</Button>
                </SpecRow>
                <SpecRow label={t('components:inputs.search')}>
                  <div className="w-56"><SearchInput value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder={t('common:search')} /></div>
                  <div className="w-40"><SearchInput size="sm" placeholder="sm" /></div>
                </SpecRow>
                <SpecRow label={t('components:inputs.textarea')}>
                  <div className="w-72"><Textarea rows={2} placeholder="Textarea" /></div>
                  <div className="w-56"><Textarea size="sm" rows={2} placeholder="sm" /></div>
                </SpecRow>
                <SpecRow label="Select">
                  <div className="w-48"><Select value={selectValue} onChange={setSelectValue} options={SELECT_OPTIONS} /></div>
                  <div className="w-48"><Select value="" onChange={() => undefined} options={SELECT_OPTIONS} placeholder="searchable" searchable /></div>
                  <div className="w-44"><Select value="" onChange={() => undefined} options={SELECT_OPTIONS} placeholder="disabled" disabled /></div>
                </SpecRow>
                <SpecRow label="MultiSelect">
                  <div className="w-64"><MultiSelect values={multiValues} onChange={setMultiValues} options={MULTI_OPTIONS} /></div>
                </SpecRow>
              </Section>

              {/* ── 卡片 ── */}
              <Section id="cards" title={t('components:nav.cards')} desc={t('components:cards.desc')}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Card>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{t('components:cards.sampleTitle')}</p>
                    <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{t('components:cards.sampleDesc')}</p>
                  </Card>
                  <Card interactive>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{t('components:cards.interactive')}</p>
                    <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{t('components:cards.sampleDesc')}</p>
                  </Card>
                  <Card padded="sm"><p className="text-xs text-gray-500 dark:text-gray-400">padded=&quot;sm&quot;</p></Card>
                  <Card padded="lg"><p className="text-xs text-gray-500 dark:text-gray-400">padded=&quot;lg&quot;</p></Card>
                  <Card padded="sm" plain className="border-dashed border-gray-200 p-4 dark:border-white/[0.1]">
                    <p className="text-xs text-gray-400 dark:text-gray-500">plain</p>
                  </Card>
                  <Card variant="tile">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-200">variant=&quot;tile&quot;</p>
                    <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">rounded-xl · 同一边框与底色</p>
                  </Card>
                  <Card variant="tile" interactive>
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-200">tile · interactive</p>
                    <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">悬停抬升</p>
                  </Card>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <SurfaceButton variant="card">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">SurfaceButton · card</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('components:cards.sampleDesc')}</p>
                  </SurfaceButton>
                  <SurfaceButton variant="card" selected>
                    <p className="text-sm font-medium text-blue-700 dark:text-blue-200">SurfaceButton · selected</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('components:cards.sampleDesc')}</p>
                  </SurfaceButton>
                  <SurfaceButton variant="row" className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-700 dark:text-gray-200">row</span>
                    <span className="text-[10px] text-gray-400">SurfaceButton</span>
                  </SurfaceButton>
                  <SurfaceButton variant="row" selected className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-700 dark:text-gray-200">row · selected</span>
                    <span className="text-[10px] text-gray-400">SurfaceButton</span>
                  </SurfaceButton>
                </div>
              </Section>

              {/* ── 标签页 ── */}
              <Section id="tabs" title={t('components:nav.tabs')} desc={t('components:tabs.desc')}>
                <SpecRow label={t('components:tabs.horizontal')}>
                  <PillTabs
                    value={tab}
                    onSelect={setTab}
                    trackId="gallery-tabs"
                    className="rounded-xl"
                    items={[
                      { key: 'overview', label: 'overview' },
                      { key: 'activity', label: <>activity <span className="rounded-full bg-blue-100 px-1.5 text-[10px] text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">3</span></> },
                      { key: 'settings', label: 'settings' },
                    ]}
                  />
                </SpecRow>
                <SpecRow label={t('components:tabs.vertical')}>
                  <PillTabs
                    value={verticalTab}
                    onSelect={setVerticalTab}
                    orientation="vertical"
                    trackId="gallery-tabs-v"
                    className="w-44 rounded-xl"
                    items={[
                      { key: 'general', label: 'general' },
                      { key: 'models', label: 'models' },
                      { key: 'advanced', label: 'advanced' },
                    ]}
                  />
                </SpecRow>
                <SpecRow label={t('components:tabs.disabled')}>
                  <PillTabs
                    value="a"
                    onSelect={() => undefined}
                    trackId="gallery-tabs-d"
                    className="rounded-xl"
                    items={[
                      { key: 'a', label: 'enabled' },
                      { key: 'b', label: 'disabled', disabled: true },
                    ]}
                  />
                </SpecRow>
              </Section>

              {/* ── 树形行 ── */}
              <Section id="tree" title={t('components:nav.tree')} desc={t('components:tree.desc')}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-gray-100 p-1.5 dark:border-white/[0.06]">
                    <p className="px-2 pb-1 text-[10px] uppercase tracking-wider text-gray-400">{t('components:tree.basic')}</p>
                    <TreeRow depth={0} expandable expanded={treeExpanded} onToggle={() => setTreeExpanded((v) => !v)} icon={<Folder size={14} className="text-amber-500" />} label="Workspace" />
                    {treeExpanded && (
                      <>
                        <TreeRow depth={1} selected icon={<FileText size={13} className="text-blue-500" />} label="Design system" />
                        <TreeRow depth={1} icon={<FileText size={13} className="text-gray-400" />} label="Spec.md" subtitle="12 KB · updated 2h ago" badge={<span className="rounded bg-gray-100 px-1 text-[10px] text-gray-500 dark:bg-white/[0.08] dark:text-gray-400">3</span>} />
                      </>
                    )}
                    <TreeRow depth={1} tone="emerald" selected icon={<FileText size={13} className="text-emerald-500" />} label={t('components:tree.tone')} />
                  </div>
                  <div className="rounded-xl border border-gray-100 p-1.5 dark:border-white/[0.06]">
                    <p className="px-2 pb-1 text-[10px] uppercase tracking-wider text-gray-400">{t('components:tree.compact')}</p>
                    <TreeRow size="sm" depth={0} icon={<Folder size={12} className="text-amber-500" />} label="src" />
                    <TreeRow size="sm" depth={1} icon={<FileText size={12} className="text-gray-400" />} label="components" />
                    <TreeRow
                      size="sm"
                      depth={2}
                      icon={<FileText size={12} className="text-blue-500" />}
                      label="Button.tsx"
                      actions={
                        <>
                          <IconButton size="sm" label={t('common:edit')} className="h-5 w-5"><Pencil size={11} /></IconButton>
                          <IconButton size="sm" label={t('common:delete')} className="h-5 w-5"><Trash2 size={11} /></IconButton>
                        </>
                      }
                    />
                  </div>
                </div>
              </Section>

              {/* ── 分页 ── */}
              <Section id="pagination" title={t('components:nav.pagination')} desc={t('components:pagination.desc')}>
                <Pagination page={page} totalCount={137} totalPages={5} onPageChange={setPage} />
                <div className="mt-3 border-t border-dashed border-gray-200 pt-3 dark:border-white/[0.08]">
                  <Pagination page={1} totalCount={8} totalPages={1} onPageChange={() => undefined} />
                </div>
              </Section>

              {/* ── 对话组件 ── */}
              <Section id="conversation" title={t('components:nav.conversation')} desc={t('components:conversation.desc')}>
                <ConversationDemos />
              </Section>

              {/* ── 内容与数据 ── */}
              <Section id="content" title={t('components:nav.content')} desc={t('components:content.desc')}>
                <ContentDemos />
              </Section>

              {/* ── 反馈与浮层 ── */}
              <Section id="overlays" title={t('components:nav.overlays')} desc={t('components:overlays.desc')}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-gray-100 p-3 dark:border-white/[0.06]">
                    <p className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-200">{t('components:overlays.modal')}</p>
                    <Button variant="outline" onClick={() => setModalOpen(true)}>{t('components:overlays.modalOpen')}</Button>
                  </div>
                  <div className="rounded-xl border border-gray-100 p-3 dark:border-white/[0.06]">
                    <p className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-200">{t('components:overlays.confirm')}</p>
                    <Button
                      variant="outline"
                      tone="red"
                      onClick={() => confirm({
                        title: t('components:overlays.confirmTitle'),
                        message: t('components:overlays.confirmMessage'),
                        onConfirm: () => undefined,
                      })}
                    >
                      {t('components:overlays.confirmOpen')}
                    </Button>
                  </div>
                  <div
                    className="rounded-xl border border-dashed border-gray-200 p-3 dark:border-white/[0.1]"
                    onContextMenu={(e) => { e.preventDefault(); setMenuAnchor({ x: e.clientX, y: e.clientY }) }}
                  >
                    <p className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-200">{t('components:overlays.contextMenu')}</p>
                    <p className="mb-2 text-[11px] text-gray-400 dark:text-gray-500">{t('components:overlays.contextHint')}</p>
                    <Button
                      variant="outline"
                      icon={<Copy size={13} />}
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        setMenuAnchor({ x: rect.left, y: rect.bottom + 4 })
                      }}
                    >
                      {t('components:overlays.contextOpen')}
                    </Button>
                  </div>
                  <div className="rounded-xl border border-gray-100 p-3 dark:border-white/[0.06]">
                    <p className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-200">{t('components:overlays.tooltip')}</p>
                    <Tooltip content={t('components:overlays.tooltipContent')}>
                      <Button variant="outline" icon={<Star size={13} />}>hover</Button>
                    </Tooltip>
                  </div>
                </div>
              </Section>

              {/* ── 状态与标记 ── */}
              <Section id="status" title={t('components:nav.status')} desc={t('components:status.desc')}>
                <SpecRow label={t('components:status.badges')}>
                  <Badge tone="blue" uppercase>NEW</Badge>
                  <Badge tone="amber" uppercase>BETA</Badge>
                  <Badge tone="emerald" size="md" dot>{t('components:status.running')}</Badge>
                  <Badge tone="amber" size="md" dot>{t('components:status.waiting')}</Badge>
                  <Badge tone="red" size="md" dot>{t('components:status.failed')}</Badge>
                  <Badge tone="gray" size="md" dot>{t('components:status.idle')}</Badge>
                </SpecRow>
                <SpecRow label={t('components:status.tags')}>
                  {TAG_DEMO_COLORS.map((color) => {
                    const palette = TAG_COLOR_HEX[color]
                    return (
                      <span key={color} className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium" style={{ background: palette.soft, color: palette.text }}>
                        {color}
                      </span>
                    )
                  })}
                </SpecRow>
                <SpecRow label="Chip">
                  <Chip tone="amber" icon={<FileText size={12} />} onRemove={() => undefined} removeLabel={t('common:remove')}>Release checklist</Chip>
                  <Chip tone="cyan" imageUrl={IMAGE_THUMB} onRemove={() => undefined} removeLabel={t('common:remove')}>screenshot.png</Chip>
                  <Chip tone="cyan" imageUrl={IMAGE_THUMB} struck removeLabel="unsupported">photo.png</Chip>
                </SpecRow>
                <SpecRow label={t('components:status.kbd')}>
                  <kbd className="rounded border border-gray-200/80 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:border-white/10 dark:text-gray-400">Esc</kbd>
                  <kbd className="rounded border border-gray-200/80 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:border-white/10 dark:text-gray-400">Enter</kbd>
                  <kbd className="rounded border border-gray-200/80 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:border-white/10 dark:text-gray-400">↑ ↓</kbd>
                </SpecRow>
                <SpecRow label={t('components:status.loading')}>
                  <span className="inline-flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <Spinner size={14} />
                    {t('components:status.loadingText')}
                  </span>
                </SpecRow>
                <SpecRow label={t('components:status.empty')}>
                  <div className="w-full rounded-xl border border-dashed border-gray-200 dark:border-white/[0.1]">
                    <EmptyState
                      icon={<Search size={16} className="text-gray-400 dark:text-gray-500" />}
                      title={t('components:status.emptyTitle')}
                      hint={t('components:status.emptyHint')}
                      className="py-8"
                    />
                  </div>
                </SpecRow>
              </Section>

              {/* ── 布局 ── */}
              <Section id="layouts" title={t('components:nav.layouts')} desc={t('components:layouts.desc')}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Wireframe title={t('components:layouts.centered')}>
                    <div className="flex h-28 items-center justify-center p-3">
                      <div className="w-2/3 space-y-1.5 rounded-lg border border-dashed border-gray-300 p-2 dark:border-white/20">
                        <Bar className="w-1/2" />
                        <Bar className="w-full" />
                        <Bar className="w-3/4" />
                      </div>
                    </div>
                  </Wireframe>
                  <Wireframe title={t('components:layouts.fill')}>
                    <div className="flex h-28 flex-col gap-1.5 p-2">
                      <Bar className="w-full" />
                      <div className="flex min-h-0 flex-1 gap-1.5">
                        <div className="w-1/3 rounded bg-gray-200/70 dark:bg-white/[0.06]" />
                        <div className="flex-1 rounded bg-gray-200/50 dark:bg-white/[0.04]" />
                      </div>
                    </div>
                  </Wireframe>
                </div>
                <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
                  {t('components:layouts.centeredDesc')} · {t('components:layouts.fillDesc')}
                </p>

                <div className="mt-6">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">{t('components:layouts.navStyles')}</p>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Wireframe title={t('components:layouts.navTop')}>
                      <div className="flex h-24 flex-col">
                        <div className="flex h-6 items-center justify-between border-b border-gray-200/70 px-1.5 dark:border-white/[0.06]">
                          <WireDot className="bg-blue-400" />
                          <div className="flex gap-1"><Bar className="w-4" /><Bar className="w-4" /><Bar className="w-4" /></div>
                          <WireDot />
                        </div>
                        <div className="flex flex-1 items-center justify-center"><Bar className="w-1/2" /></div>
                      </div>
                    </Wireframe>
                    <Wireframe title={t('components:layouts.navVertical')}>
                      <div className="flex h-24">
                        <div className="flex w-6 flex-col items-center gap-1.5 border-r border-gray-200/70 py-1.5 dark:border-white/[0.06]">
                          <WireDot className="bg-blue-400" /><WireDot /><WireDot /><WireDot />
                        </div>
                        <div className="flex flex-1 items-center justify-center"><Bar className="w-1/2" /></div>
                      </div>
                    </Wireframe>
                    <Wireframe title={t('components:layouts.navVerticalList')}>
                      <div className="flex h-24">
                        <div className="flex w-14 flex-col gap-1.5 border-r border-gray-200/70 p-1.5 dark:border-white/[0.06]">
                          <div className="flex items-center gap-1"><WireDot className="bg-blue-400" /><Bar className="w-6" /></div>
                          <div className="flex items-center gap-1"><WireDot /><Bar className="w-5" /></div>
                          <div className="flex items-center gap-1"><WireDot /><Bar className="w-7" /></div>
                        </div>
                        <div className="flex flex-1 items-center justify-center"><Bar className="w-1/2" /></div>
                      </div>
                    </Wireframe>
                  </div>
                </div>

                <div className="mt-6">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">{t('components:layouts.anatomy')}</p>
                  <div className="flex h-72 overflow-hidden rounded-xl border border-gray-200/70 dark:border-white/[0.08]">
                    <div className="flex w-12 shrink-0 flex-col items-center gap-1.5 border-r border-gray-200/70 bg-white/35 p-1.5 dark:border-white/[0.07] dark:bg-slate-950/20">
                      <WireDot className="bg-blue-400" /><WireDot /><WireDot /><WireDot />
                      <div className="mt-auto"><WireDot /></div>
                    </div>
                    <WorkbenchColumn
                      role="secondary"
                      title={t('components:layouts.secondary')}
                      count={12}
                      className="h-full"
                      bodyClassName="p-1.5 space-y-0.5"
                    >
                      <TreeRow size="sm" depth={0} icon={<Folder size={12} className="text-amber-500" />} label="Workspace" />
                      <TreeRow size="sm" depth={1} selected icon={<FileText size={12} className="text-blue-500" />} label="Design system" />
                      <TreeRow size="sm" depth={1} icon={<FileText size={12} className="text-gray-400" />} label="Spec.md" />
                    </WorkbenchColumn>
                    <WorkbenchColumn
                      role="list"
                      title={t('components:layouts.list')}
                      count={3}
                      className="h-full"
                      bodyClassName="p-1.5 space-y-1"
                    >
                      <SurfaceButton variant="row" selected className="px-2 py-1.5 text-[11px] text-gray-700 dark:text-gray-200">row · selected</SurfaceButton>
                      <SurfaceButton variant="row" className="px-2 py-1.5 text-[11px] text-gray-600 dark:text-gray-300">row</SurfaceButton>
                      <SurfaceButton variant="row" className="px-2 py-1.5 text-[11px] text-gray-600 dark:text-gray-300">row</SurfaceButton>
                    </WorkbenchColumn>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
                      <Bar className="w-1/3" /><Bar className="w-full" /><Bar className="w-2/3" />
                      <span className="mt-auto text-[10px] text-gray-400 dark:text-gray-500">{t('components:layouts.detail')}</span>
                    </div>
                  </div>
                  <div className="mt-1.5 grid grid-cols-[3rem_16rem_20rem_1fr] text-center text-[10px] text-gray-400 dark:text-gray-500">
                    <span>{t('components:layouts.rail')}</span>
                    <span>{t('components:layouts.secondary')}</span>
                    <span>{t('components:layouts.list')}</span>
                    <span>{t('components:layouts.detail')}</span>
                  </div>
                </div>
              </Section>
            </div>
          </div>

          {/* 弹窗示例 */}
          <Modal open={modalOpen} onClose={() => setModalOpen(false)} size="md" label={t('components:overlays.modalTitle')}>
            <div className="border-b border-gray-100 px-5 py-4 dark:border-white/[0.07]">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('components:overlays.modalTitle')}</h3>
            </div>
            <div className="px-5 py-4 text-[13px] leading-relaxed text-gray-600 dark:text-gray-300">
              {t('components:overlays.modalBody')}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-white/[0.07]">
              <Button variant="secondary" onClick={() => setModalOpen(false)}>{t('common:cancel')}</Button>
              <Button variant="primary" onClick={() => setModalOpen(false)}>{t('common:confirm')}</Button>
            </div>
          </Modal>

          {/* 右键菜单示例 */}
          <ContextMenu
            anchor={menuAnchor}
            onClose={() => setMenuAnchor(null)}
            minWidth={170}
            items={[
              { key: 'rename', label: t('components:overlays.menuRename'), icon: <Pencil size={13} />, onSelect: () => undefined },
              { key: 'duplicate', label: t('components:overlays.menuDuplicate'), icon: <Copy size={13} />, onSelect: () => undefined },
              { kind: 'separator' },
              { key: 'delete', label: t('components:overlays.menuDelete'), icon: <Trash2 size={13} />, danger: true, onSelect: () => undefined },
            ]}
          />
        </PageContainer>
      }
    />
  )
}