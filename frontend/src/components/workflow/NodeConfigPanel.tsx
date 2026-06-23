import { useEffect, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import type { IWorkflowNode } from '../../types/workflow'
import { WorkflowNodeTypes } from '../../types/workflow'
import type { IAgent } from '../../types/agent'
import type { IWorkflow } from '../../types/workflow'
import Select from '../Select'

interface NodeConfigPanelProps {
  node: IWorkflowNode | null
  agents: IAgent[]
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
  const [config, setConfig] = useState<Record<string, unknown>>({})

  useEffect(() => {
    setConfig(parseConfig(node?.config))
  }, [node?.id, node?.config])

  if (!node) {
    return (
      <div className="flex w-72 items-center justify-center border-l border-gray-200 bg-white p-4 text-center text-sm text-gray-400 dark:border-white/[0.08] dark:bg-gray-900/50">
        选择一个节点以编辑配置
      </div>
    )
  }

  const updateConfig = (key: string, value: unknown) => {
    const next = { ...config, [key]: value }
    setConfig(next)
    onChange({ config: JSON.stringify(next) })
  }

  return (
    <div className="flex w-80 flex-col border-l border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-900/50">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-white/[0.08]">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">节点配置</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={onDelete}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
            title="删除节点"
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
          <label className={labelClass}>名称</label>
          <input
            className={inputClass}
            value={node.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="节点名称"
          />
        </div>

        <div>
          <label className={labelClass}>类型</label>
          <div className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-500 dark:bg-white/[0.03] dark:text-gray-400">
            {node.type}
          </div>
        </div>

        {/* Agent 节点：选择 Agent */}
        {node.type === WorkflowNodeTypes.Agent && (
          <div>
            <label className={labelClass}>Agent</label>
            <Select
              value={node.agentId ?? ''}
              onChange={(v) => onChange({ agentId: v || undefined })}
              options={[
                { value: '', label: '— 未选择 —' },
                ...agents.map((a) => ({ value: a.id, label: a.name })),
              ]}
              searchable
              placeholder="选择 Agent"
            />
            {agents.length === 0 && (
              <p className="mt-1 text-xs text-amber-500">暂无 Agent，请先创建</p>
            )}
          </div>
        )}

        {/* Agent 节点：输入模板 */}
        {node.type === WorkflowNodeTypes.Agent && (
          <div>
            <label className={labelClass}>输入模板</label>
            <textarea
              className={`${inputClass} h-20 resize-none font-mono text-xs`}
              value={(config.inputTemplate as string) ?? ''}
              onChange={(e) => updateConfig('inputTemplate', e.target.value)}
              placeholder={'{{start.input}} — 引用上游节点输出'}
            />
          </div>
        )}

        {/* Condition 节点：分支配置 */}
        {node.type === WorkflowNodeTypes.Condition && (
          <div>
            <label className={labelClass}>分支条件（JSON）</label>
            <p className="mb-1 text-xs text-gray-400">
              顺序求值，首个匹配的 handle 决定走向。handle 需与边的 sourceHandle 对应。
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
              <label className={labelClass}>最大循环次数</label>
              <input
                type="number"
                className={inputClass}
                value={(config.maxIterations as number) ?? 5}
                onChange={(e) => updateConfig('maxIterations', parseInt(e.target.value) || 5)}
              />
            </div>
            <div>
              <label className={labelClass}>退出条件</label>
              <input
                className={inputClass}
                value={(config.exitCondition as string) ?? ''}
                onChange={(e) => updateConfig('exitCondition', e.target.value)}
                placeholder={'{{prev.output}} == done'}
              />
              <p className="mt-1 text-xs text-gray-400">出边 handle: body（循环体）/ exit（退出）</p>
            </div>
          </>
        )}

        {/* Tool 节点 */}
        {node.type === WorkflowNodeTypes.Tool && (
          <>
            <div>
              <label className={labelClass}>工具</label>
              <Select
                value={(config.toolName as string) ?? ''}
                onChange={(v) => updateConfig('toolName', v)}
                options={availableTools.map((t) => ({ value: t.name, label: t.label }))}
                searchable
                placeholder="选择工具"
              />
            </div>
            <div>
              <label className={labelClass}>参数模板（JSON）</label>
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
              <label className={labelClass}>子工作流</label>
              <Select
                value={(config.subWorkflowId as string) ?? ''}
                onChange={(v) => updateConfig('subWorkflowId', v)}
                options={workflows.map((w) => ({ value: w.id, label: w.name }))}
                searchable
                placeholder="选择子工作流"
              />
            </div>
            <div>
              <label className={labelClass}>输入模板</label>
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
              <label className={labelClass}>审批提示语</label>
              <textarea
                className={`${inputClass} h-20 resize-none`}
                value={(config.prompt as string) ?? ''}
                onChange={(e) => updateConfig('prompt', e.target.value)}
                placeholder="请确认是否继续执行"
              />
            </div>
            <div>
              <label className={labelClass}>超时（秒）</label>
              <input
                type="number"
                className={inputClass}
                value={(config.timeoutSeconds as number) ?? 300}
                onChange={(e) => updateConfig('timeoutSeconds', parseInt(e.target.value) || 300)}
              />
            </div>
          </>
        )}

        {/* End 节点：输出模板 */}
        {node.type === WorkflowNodeTypes.End && (
          <div>
            <label className={labelClass}>输出模板</label>
            <textarea
              className={`${inputClass} h-20 resize-none font-mono text-xs`}
              value={(config.outputTemplate as string) ?? ''}
              onChange={(e) => updateConfig('outputTemplate', e.target.value)}
              placeholder={'{{agent.output}} — 引用要输出的节点结果'}
            />
          </div>
        )}
      </div>
    </div>
  )
}
