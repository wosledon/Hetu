import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Trash2, X } from 'lucide-react'
import type { IWorkflowNode } from '../../types/workflow'
import { WorkflowNodeTypes } from '../../types/workflow'
import type { IPromptPreset, IAiModel, IMcpServer } from '../../types'
import type { IWorkflow } from '../../types/workflow'
import { aiModelService } from '../../services/aiProviderService'
import { mcpService } from '../../services/mcpService'
import Select from '../Select'

interface NodeConfigPanelProps {
  node: IWorkflowNode | null
  agents: IPromptPreset[]
  workflows: IWorkflow[]
  availableTools: { name: string; label: string }[]
  onChange: (updates: Partial<IWorkflowNode>) => void
  onDelete: () => void
  onClose: () => void
}

const inputClass =
  'w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2 text-sm outline-none transition-all focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.03] dark:focus:border-blue-500/50 dark:focus:bg-transparent dark:focus:ring-blue-500/20'

const labelClass = 'mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400'

/// 解析节点 config JSON
function parseConfig(config?: string): Record<string, unknown> {
  if (!config) return {}
  try {
    return JSON.parse(config)
  } catch {
    return {}
  }
}

export default function NodeConfigPanel({
  node,
  agents,
  workflows,
  availableTools,
  onChange,
  onDelete,
  onClose,
}: NodeConfigPanelProps) {
  const { t } = useTranslation('workflows')
  const [config, setConfig] = useState<Record<string, unknown>>(() => parseConfig(node?.config))
  const lastNodeId = useRef<string | undefined>(node?.id)

  // 节点切换时重置 config（渲染期间 setState 是 React 允许的模式，避免 effect 级联渲染）
  if (node?.id !== lastNodeId.current) {
    lastNodeId.current = node?.id
    setConfig(parseConfig(node?.config))
  }

  const { data: models = [] } = useQuery({ queryKey: ['aiModels'], queryFn: aiModelService.getAll })
  const { data: mcpServers = [] } = useQuery({ queryKey: ['mcpServers'], queryFn: mcpService.getAll })
  const chatModels = (models as IAiModel[]).filter((m) => m.purpose === 'chat')
  const enabledMcpServers = (mcpServers as IMcpServer[]).filter((s) => s.isEnabled)

  if (!node) {
    return (
      <div className="flex w-72 items-center justify-center border-l border-gray-200 bg-white p-4 text-center text-sm text-gray-400 dark:border-white/[0.08] dark:bg-gray-900/50">
        {t('config.selectNodeHint')}
      </div>
    )
  }

  const updateConfig = (key: string, value: unknown) => {
    const next = { ...config, [key]: value }
    setConfig(next)
    onChange({ config: JSON.stringify(next) })
  }

  const toggleTool = (name: string) => {
    const cur = (config.toolNames as string[]) ?? []
    updateConfig('toolNames', cur.includes(name) ? cur.filter((t) => t !== name) : [...cur, name])
  }
  const toggleMcp = (id: string) => {
    const cur = (config.mcpServerIds as string[]) ?? []
    updateConfig('mcpServerIds', cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id])
  }
  const toolNames = (config.toolNames as string[]) ?? []
  const mcpServerIds = (config.mcpServerIds as string[]) ?? []
  const agentRefInvalid = !!node.agentId && !agents.some((a) => a.id === node.agentId)

  return (
    <div className="flex w-80 flex-col border-l border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-900/50">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-white/[0.08]">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('config.title')}</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={onDelete}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
            title={t('config.deleteNode')}
          >
            <Trash2 size={15} />
          </button>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 dark:hover:bg-white/[0.06]"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <div>
          <label className={labelClass}>{t('common:name')}</label>
          <input
            className={inputClass}
            value={node.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder={t('config.nodeNamePlaceholder')}
          />
        </div>

        <div>
          <label className={labelClass}>{t('common:type')}</label>
          <div className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
            {node.type}
          </div>
        </div>

        {/* Agent 节点：选择智能体（数据源为智能体页面的 PromptPreset，仅取提示词） */}
        {node.type === WorkflowNodeTypes.Agent && (
          <div>
            <label className={labelClass}>{t('config.agent')}</label>
            <Select
              value={node.agentId ?? ''}
              onChange={(v) => onChange({ agentId: v || undefined })}
              options={[
                { value: '', label: t('config.notSelected') },
                ...agents.map((a) => ({ value: a.id, label: a.name })),
              ]}
              searchable
              placeholder={t('config.selectAgent')}
            />
            {agentRefInvalid && (
              <p className="mt-1 text-xs text-amber-500">{t('config.agentRefInvalid')}</p>
            )}
            {agents.length === 0 && (
              <p className="mt-1 text-xs text-amber-500">{t('config.noAgents')}</p>
            )}
          </div>
        )}

        {/* Agent 节点：对话模型（节点级配置） */}
        {node.type === WorkflowNodeTypes.Agent && (
          <div>
            <label className={labelClass}>{t('config.chatModel')}</label>
            <Select
              value={(config.modelId as string) ?? ''}
              onChange={(v) => updateConfig('modelId', v || undefined)}
              options={[{ value: '', label: t('config.defaultModel') }, ...chatModels.map((m) => ({ value: m.id, label: m.displayName }))]}
              searchable
              placeholder={t('config.selectModel')}
            />
          </div>
        )}

        {/* Agent 节点：工具勾选（节点级配置） */}
        {node.type === WorkflowNodeTypes.Agent && (
          <div>
            <label className={labelClass}>{t('config.tools')}</label>
            <div className="flex flex-wrap gap-1.5">
              {availableTools.map((tool) => (
                <button
                  key={tool.name}
                  onClick={() => toggleTool(tool.name)}
                  className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
                    toolNames.includes(tool.name)
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]'
                  }`}
                >
                  {tool.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Agent 节点：MCP 服务器勾选（节点级配置） */}
        {node.type === WorkflowNodeTypes.Agent && (
          <div>
            <label className={labelClass}>{t('config.mcpServers')}</label>
            <div className="flex flex-wrap gap-1.5">
              {enabledMcpServers.length === 0 && (
                <span className="text-xs text-gray-400">{t('config.noMcpServers')}</span>
              )}
              {enabledMcpServers.map((s) => (
                <button
                  key={s.id}
                  onClick={() => toggleMcp(s.id)}
                  className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
                    mcpServerIds.includes(s.id)
                      ? 'bg-indigo-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Agent 节点：迭代参数（节点级配置） */}
        {node.type === WorkflowNodeTypes.Agent && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>{t('config.maxToolCallsPerTurn')}</label>
              <input
                type="number"
                className={inputClass}
                value={(config.maxToolCallsPerTurn as number) ?? 5}
                onChange={(e) => updateConfig('maxToolCallsPerTurn', parseInt(e.target.value) || 5)}
              />
            </div>
            <div>
              <label className={labelClass}>{t('config.maxIterations')}</label>
              <input
                type="number"
                className={inputClass}
                value={(config.maxIterations as number) ?? 15}
                onChange={(e) => updateConfig('maxIterations', parseInt(e.target.value) || 15)}
              />
            </div>
          </div>
        )}

        {/* Agent 节点：指令 + 自动接棒说明 */}
        {node.type === WorkflowNodeTypes.Agent && (
          <>
            <div>
              <label className={labelClass}>{t('config.instruction')}</label>
              <textarea
                className={`${inputClass} h-20 resize-none`}
                value={(config.instruction as string) ?? ''}
                onChange={(e) => updateConfig('instruction', e.target.value)}
                placeholder={t('config.instructionPlaceholder')}
              />
            </div>
            <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
              {t('config.upstreamHint')}
            </p>
          </>
        )}

        {/* Condition 节点：分支配置 */}
        {node.type === WorkflowNodeTypes.Condition && (
          <div>
            <label className={labelClass}>{t('config.branchCondition')}</label>
            <p className="mb-1 text-xs text-gray-400">
              {t('config.branchHint')}
            </p>
            <textarea
              className={`${inputClass} h-40 resize-none font-mono text-xs`}
              value={node.config ?? ''}
              onChange={(e) => onChange({ config: e.target.value })}
              placeholder={'{\n  "branches": [\n    {"handle":"true","expression":"{{prev.output}} == yes"},\n    {"handle":"false"}\n  ]\n}'}
            />
          </div>
        )}

        {/* Loop 节点 */}
        {node.type === WorkflowNodeTypes.Loop && (
          <>
            <div>
              <label className={labelClass}>{t('config.maxLoopIterations')}</label>
              <input
                type="number"
                className={inputClass}
                value={(config.maxIterations as number) ?? 5}
                onChange={(e) => updateConfig('maxIterations', parseInt(e.target.value) || 5)}
              />
            </div>
            <div>
              <label className={labelClass}>{t('config.exitCondition')}</label>
              <input
                className={inputClass}
                value={(config.exitCondition as string) ?? ''}
                onChange={(e) => updateConfig('exitCondition', e.target.value)}
                placeholder={'{{prev.output}} == done'}
              />
              <p className="mt-1 text-xs text-gray-400">{t('config.loopHandleHint')}</p>
            </div>
          </>
        )}

        {/* Tool 节点 */}
        {node.type === WorkflowNodeTypes.Tool && (
          <>
            <div>
              <label className={labelClass}>{t('config.tools')}</label>
              <Select
                value={(config.toolName as string) ?? ''}
                onChange={(v) => updateConfig('toolName', v)}
                options={availableTools.map((tool) => ({ value: tool.name, label: tool.label }))}
                searchable
                placeholder={t('config.selectTool')}
              />
            </div>
            <div>
              <label className={labelClass}>{t('config.argumentsTemplate')}</label>
              <textarea
                className={`${inputClass} h-24 resize-none font-mono text-xs`}
                value={(config.argumentsTemplate as string) ?? '{}'}
                onChange={(e) => updateConfig('argumentsTemplate', e.target.value)}
                placeholder={'{\n  "query": "{{start.input}}"\n}'}
              />
            </div>
          </>
        )}

        {/* SubWorkflow 节点 */}
        {node.type === WorkflowNodeTypes.SubWorkflow && (
          <>
            <div>
              <label className={labelClass}>{t('nodeTypes.subWorkflow')}</label>
              <Select
                value={(config.subWorkflowId as string) ?? ''}
                onChange={(v) => updateConfig('subWorkflowId', v)}
                options={workflows.map((w) => ({ value: w.id, label: w.name }))}
                searchable
                placeholder={t('config.selectSubWorkflow')}
              />
            </div>
            <div>
              <label className={labelClass}>{t('config.inputTemplate')}</label>
              <input
                className={inputClass}
                value={(config.inputTemplate as string) ?? ''}
                onChange={(e) => updateConfig('inputTemplate', e.target.value)}
                placeholder="{{start.input}}"
              />
            </div>
          </>
        )}

        {/* Human 节点 */}
        {node.type === WorkflowNodeTypes.Human && (
          <>
            <div>
              <label className={labelClass}>{t('config.approvalPrompt')}</label>
              <textarea
                className={`${inputClass} h-20 resize-none`}
                value={(config.prompt as string) ?? ''}
                onChange={(e) => updateConfig('prompt', e.target.value)}
                placeholder={t('config.approvalPromptPlaceholder')}
              />
            </div>
            <div>
              <label className={labelClass}>{t('config.timeoutSeconds')}</label>
              <input
                type="number"
                className={inputClass}
                value={(config.timeoutSeconds as number) ?? 300}
                onChange={(e) => updateConfig('timeoutSeconds', parseInt(e.target.value) || 300)}
              />
            </div>
          </>
        )}

        {/* Merge 节点：输出模板 */}
        {node.type === WorkflowNodeTypes.Merge && (
          <div>
            <label className={labelClass}>{t('config.outputTemplate')}</label>
            <textarea
              className={`${inputClass} h-20 resize-none font-mono text-xs`}
              value={(config.outputTemplate as string) ?? ''}
              onChange={(e) => updateConfig('outputTemplate', e.target.value)}
              placeholder={t('config.mergeOutputTemplatePlaceholder', { ref: '{{branchA.output}}' })}
            />
            <p className="mt-1 text-xs text-gray-400">{t('config.mergeHint')}</p>
          </div>
        )}

        {/* End 节点：输出模板 */}
        {node.type === WorkflowNodeTypes.End && (
          <div>
            <label className={labelClass}>{t('config.outputTemplate')}</label>
            <textarea
              className={`${inputClass} h-20 resize-none font-mono text-xs`}
              value={(config.outputTemplate as string) ?? ''}
              onChange={(e) => updateConfig('outputTemplate', e.target.value)}
              placeholder={t('config.endOutputTemplatePlaceholder', { ref: '{{agent.output}}' })}
            />
          </div>
        )}
      </div>
    </div>
  )
}
