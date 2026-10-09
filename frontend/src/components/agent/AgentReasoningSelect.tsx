import { Brain } from 'lucide-react'
import AgentToolbarSelect from './AgentToolbarSelect'
import { reasoningEffortLabel, reasoningEffortOptions } from '../../utils/agentReasoning'

export interface AgentReasoningSelectProps {
  /** '' 表示未指定（用模型默认） */
  value: string
  onChange: (value: string) => void
  /** 当前模型的推理模式：native=强度可选，tag=仅开关，其他不显示 */
  reasoningMode?: string | null
  /**
   * 当前模型可选的强度档位（来自模型配置 / models.dev）；
   * 不传时按内置三档（低/中/高）渲染。
   */
  model?: { reasoningEffort?: string | null; reasoningEfforts?: string | null } | null
  /** tag 模式下的开关状态 */
  enabled?: boolean
  onEnabledChange?: (enabled: boolean) => void
}

/**
 * 推理强度选择器。对话页与编码会话共用：
 * - native 模式：按模型配置的档位渲染下拉（models.dev 的 effort 取值可能多于三档）
 * - tag 模式：深度思考开关
 * - 其他模型：不渲染
 */
export default function AgentReasoningSelect({
  value,
  onChange,
  reasoningMode,
  model,
  enabled = false,
  onEnabledChange,
}: AgentReasoningSelectProps) {
  if (reasoningMode === 'tag') {
    return (
      <button
        onClick={() => onEnabledChange?.(!enabled)}
        title="深度思考"
        className={`flex h-[26px] shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-colors ${
          enabled
            ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
            : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50'
        }`}
      >
        <Brain size={13} />
        深度思考
      </button>
    )
  }

  if (reasoningMode !== 'native') return null

  return (
    <AgentToolbarSelect
      value={value}
      onChange={onChange}
      title="推理强度"
      options={[
        { value: '', label: '模型默认' },
        ...reasoningEffortOptions(model).map((l) => ({ value: l, label: `${reasoningEffortLabel(l)}强度` })),
      ]}
    />
  )
}
