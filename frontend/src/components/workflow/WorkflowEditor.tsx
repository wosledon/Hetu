import { useCallback, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from 'dagre'
import { useTranslation } from 'react-i18next'
import { Play, Save, CheckCircle, AlertTriangle, Layout, ChevronLeft, Pencil } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { workflowService } from '../../services/workflowService'
import type { IWorkflow, IWorkflowNode, IWorkflowEdge } from '../../types/workflow'
import { toFlowNode, fromFlowNode, NODE_META_BY_TYPE, type IWorkflowNodeData } from './workflowNodeModel'
import WorkflowNodeComponent from './WorkflowNode'
import NodePalette from './NodePalette'
import NodeConfigPanel from './NodeConfigPanel'
import type { IPromptPreset } from '../../types'
import type { NodeTypes } from '@xyflow/react'

interface WorkflowEditorProps {
  workflow: IWorkflow
  agents: IPromptPreset[]
  workflows: IWorkflow[]
  availableTools: { name: string; label: string }[]
  onBack: () => void
  onRun: (workflow: IWorkflow) => void
}

const nodeTypes: NodeTypes = { workflowNode: WorkflowNodeComponent }

function LayoutedEditor({ workflow, agents, workflows, availableTools, onBack, onRun }: WorkflowEditorProps) {
  const { t } = useTranslation('workflows')
  const queryClient = useQueryClient()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(workflow.nodes.map(toFlowNode) as Node[])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    workflow.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      markerEnd: { type: MarkerType.ArrowClosed },
    })) as Edge[],
  )
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[] } | null>(null)
  const [saved, setSaved] = useState(false)
  const [name, setName] = useState(workflow.name)
  const [description, setDescription] = useState(workflow.description)
  const [isEnabled, setIsEnabled] = useState(workflow.isEnabled)
  const [showMeta, setShowMeta] = useState(false)
  const nodeIdCounter = useRef(0)
  const isNew = workflow.id === 'new'

  const selectedNode = nodes.find((n) => n.id === selectedNodeId)
  const selectedWorkflowNode: IWorkflowNode | null = selectedNode
    ? fromFlowNode({ id: selectedNode.id, position: selectedNode.position, data: selectedNode.data as IWorkflowNodeData })
    : null

  const onConnect = useCallback(
    (params: Connection) => {
      // 同源同目标的重复连接不处理；Condition/Loop 节点支持多 sourceHandle
      setEdges((eds) => addEdge({ ...params, markerEnd: { type: MarkerType.ArrowClosed } }, eds))
    },
    [setEdges],
  )

  const addNode = useCallback((type: string) => {
    const id = `${type}_${Date.now()}`
    const labelKey = NODE_META_BY_TYPE[type]?.labelKey
    const newNode: Node = {
      id,
      type: 'workflowNode',
      position: { x: 250 + nodeIdCounter.current * 30, y: 100 + nodeIdCounter.current * 30 },
      data: { label: labelKey ? t(labelKey) : type, type } as IWorkflowNodeData,
    }
    nodeIdCounter.current++
    setNodes((nds) => [...nds, newNode])
  }, [setNodes, t])

  const onNodeClick = useCallback((_: unknown, node: Node) => setSelectedNodeId(node.id), [])
  const onPaneClick = useCallback(() => setSelectedNodeId(null), [])

  const updateSelectedNode = useCallback((updates: Partial<IWorkflowNode>) => {
    if (!selectedNodeId) return
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedNodeId) return n
        const data = n.data as IWorkflowNodeData
        if (updates.label !== undefined) data.label = updates.label
        if (updates.agentId !== undefined) data.agentId = updates.agentId
        if (updates.config !== undefined) data.config = updates.config
        return { ...n, data: { ...data } }
      }),
    )
  }, [selectedNodeId, setNodes])

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNodeId) return
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId))
    setEdges((eds) => eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId))
    setSelectedNodeId(null)
  }, [selectedNodeId, setNodes, setEdges])

  /// 自动布局（dagre 从左到右）
  const autoLayout = useCallback(() => {
    const g = new dagre.graphlib.Graph()
    g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 80 })
    g.setDefaultEdgeLabel(() => ({}))
    nodes.forEach((n) => g.setNode(n.id, { width: 200, height: 60 }))
    edges.forEach((e) => g.setEdge(e.source, e.target))
    dagre.layout(g)
    setNodes((nds) =>
      nds.map((n) => {
        const pos = g.node(n.id)
        return pos ? { ...n, position: { x: pos.x - 100, y: pos.y - 30 } } : n
      }),
    )
  }, [nodes, edges, setNodes])

  const collectNodes = (): IWorkflowNode[] => nodes.map((n) => fromFlowNode({ id: n.id, position: n.position, data: n.data as IWorkflowNodeData }))
  const collectEdges = (): IWorkflowEdge[] => edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, targetHandle: e.targetHandle ?? undefined }))

  const saveMut = useMutation({
    mutationFn: (data: { nodes: IWorkflowNode[]; edges: IWorkflowEdge[] }) => {
      const payload = {
        name: name.trim() || t('editor.untitledWorkflow'),
        description,
        nodes: data.nodes,
        edges: data.edges,
        inputSchema: workflow.inputSchema,
        variables: workflow.variables,
        isEnabled,
        sortOrder: workflow.sortOrder,
      }
      return isNew ? workflowService.create(payload) : workflowService.update(workflow.id, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      if (isNew) onBack()
    },
  })

  const handleSave = () => saveMut.mutate({ nodes: collectNodes(), edges: collectEdges() })

  const handleValidate = async () => {
    const result = await workflowService.validate(workflow.id)
    setValidation(result)
  }

  return (
    <div className="flex h-full flex-1 flex-col">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2 dark:border-white/[0.08] dark:bg-gray-900/50">
        <button onClick={onBack} className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]">
          <ChevronLeft size={16} /> {t('common:back')}
        </button>
        <div className="h-4 w-px bg-gray-200 dark:bg-white/[0.08]" />
        {/* 名称/描述 可编辑 */}
        <div className="relative">
          <button
            onClick={() => setShowMeta((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/[0.06]"
            title={t('editor.editMeta')}
          >
            {name || t('editor.untitledWorkflow')}
            <Pencil size={12} className="text-gray-400" />
          </button>
          {showMeta && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMeta(false)} />
              <div className="absolute left-0 top-full z-50 mt-1 w-72 space-y-2 rounded-xl border border-gray-200 bg-white p-3 shadow-lg dark:border-white/[0.08] dark:bg-gray-800">
                <div>
                  <label className="mb-1 block text-[11px] text-gray-400">{t('common:name')}</label>
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('editor.namePlaceholder')}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm outline-none focus:border-blue-300 focus:bg-white dark:border-gray-700 dark:bg-gray-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-gray-400">{t('common:description')}</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('editor.descriptionPlaceholder')}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm outline-none focus:border-blue-300 focus:bg-white dark:border-gray-700 dark:bg-gray-900"
                  />
                </div>
                <button
                  onClick={() => setShowMeta(false)}
                  className="w-full rounded-lg bg-blue-500 py-1.5 text-xs font-medium text-white hover:bg-blue-600"
                >
                  {t('editor.done')}
                </button>
              </div>
            </>
          )}
        </div>
        <span className="text-xs text-gray-400">{isNew ? t('common:unsaved') : `v${workflow.version}`}</span>
        {/* 启用/禁用开关 */}
        <button
          onClick={() => { setIsEnabled((v) => !v); setSaved(false) }}
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
            isEnabled
              ? 'bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400'
              : 'bg-gray-100 text-gray-400 dark:bg-white/[0.06] dark:text-gray-500'
          }`}
          title={isEnabled ? t('page.clickToDisable') : t('page.clickToEnable')}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${isEnabled ? 'bg-green-500' : 'bg-gray-400'}`} />
          {isEnabled ? t('common:enable') : t('common:disable')}
        </button>
        <div className="flex-1" />
        <button onClick={autoLayout} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]">
          <Layout size={14} /> {t('editor.autoLayout')}
        </button>
        {!isNew && (
          <button onClick={handleValidate} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]">
            <CheckCircle size={14} /> {t('editor.validate')}
          </button>
        )}
        <button
          onClick={() => onRun({ ...workflow, name, description, isEnabled, nodes: collectNodes(), edges: collectEdges() })}
          disabled={isNew}
          className="flex items-center gap-1 rounded-lg bg-green-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-40"
          title={isNew ? t('editor.runAfterSave') : t('common:run')}
        >
          <Play size={14} /> {t('common:run')}
        </button>
        <button onClick={handleSave} disabled={saveMut.isPending} className="flex items-center gap-1 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50">
          {saved ? <CheckCircle size={14} /> : <Save size={14} />} {saved ? t('common:saved') : t('common:save')}
        </button>
      </div>

      {/* 校验结果 */}
      {validation && !validation.valid && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>{validation.errors.join('；')}</div>
        </div>
      )}
      {validation?.valid && (
        <div className="border-b border-green-200 bg-green-50 px-3 py-1.5 text-xs text-green-700 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-400">
          {t('editor.validationPassed')}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：节点面板 */}
        <NodePalette onAddNode={addNode} />

        {/* 画布 */}
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={(changes: NodeChange[]) => { onNodesChange(changes); setSaved(false) }}
            onEdgesChange={(changes: EdgeChange[]) => { onEdgesChange(changes); setSaved(false) }}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            className="bg-gray-50 dark:bg-gray-950"
          >
            <Background />
            <Controls />
            <MiniMap nodeColor="#3b82f6" maskColor="rgba(0,0,0,0.1)" />
          </ReactFlow>
        </div>

        {/* 右侧：配置面板 */}
        <NodeConfigPanel
          node={selectedWorkflowNode}
          agents={agents}
          workflows={workflows.filter((w) => w.id !== workflow.id)}
          availableTools={availableTools}
          onChange={updateSelectedNode}
          onDelete={deleteSelectedNode}
          onClose={() => setSelectedNodeId(null)}
        />
      </div>
    </div>
  )
}

export default function WorkflowEditor(props: WorkflowEditorProps) {
  return (
    <ReactFlowProvider>
      <div className="flex h-screen w-full flex-col bg-gray-50 dark:bg-[#0c0f1a]">
        <LayoutedEditor {...props} />
      </div>
    </ReactFlowProvider>
  )
}
