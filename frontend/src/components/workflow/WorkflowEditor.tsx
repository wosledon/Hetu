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
import { Play, Save, Copy, CheckCircle, AlertTriangle, Layout, ChevronLeft } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { workflowService } from '../../services/workflowService'
import type { IWorkflow, IWorkflowNode, IWorkflowEdge } from '../../types/workflow'
import { WorkflowNodeTypes } from '../../types/workflow'
import { toFlowNode, fromFlowNode, type IWorkflowNodeData } from './WorkflowNode'
import WorkflowNodeComponent from './WorkflowNode'
import NodePalette from './NodePalette'
import NodeConfigPanel from './NodeConfigPanel'
import type { IPromptPreset } from '../../types'

interface WorkflowEditorProps {
  workflow: IWorkflow
  agents: IPromptPreset[]
  workflows: IWorkflow[]
  availableTools: { name: string; label: string }[]
  onBack: () => void
  onRun: (workflow: IWorkflow) => void
}

const nodeTypes = { workflowNode: WorkflowNodeComponent as unknown as React.ComponentType<never> }

function LayoutedEditor({ workflow, agents, workflows, availableTools, onBack, onRun }: WorkflowEditorProps) {
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
  const nodeIdCounter = useRef(0)

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
    const labelMap: Record<string, string> = {
      [WorkflowNodeTypes.Start]: '开始',
      [WorkflowNodeTypes.Agent]: 'Agent',
      [WorkflowNodeTypes.Condition]: '条件分支',
      [WorkflowNodeTypes.End]: '结束',
      [WorkflowNodeTypes.Loop]: '循环',
      [WorkflowNodeTypes.Parallel]: '并行',
      [WorkflowNodeTypes.Tool]: '工具',
      [WorkflowNodeTypes.Human]: '人工审批',
      [WorkflowNodeTypes.SubWorkflow]: '子工作流',
    }
    const newNode: Node = {
      id,
      type: 'workflowNode',
      position: { x: 250 + nodeIdCounter.current * 30, y: 100 + nodeIdCounter.current * 30 },
      data: { label: labelMap[type] ?? type, type } as IWorkflowNodeData,
    }
    nodeIdCounter.current++
    setNodes((nds) => [...nds, newNode])
  }, [setNodes])

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
    mutationFn: (data: { nodes: IWorkflowNode[]; edges: IWorkflowEdge[] }) =>
      workflowService.update(workflow.id, {
        name: workflow.name,
        description: workflow.description,
        nodes: data.nodes,
        edges: data.edges,
        inputSchema: workflow.inputSchema,
        variables: workflow.variables,
        isEnabled: workflow.isEnabled,
        sortOrder: workflow.sortOrder,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
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
          <ChevronLeft size={16} /> 返回
        </button>
        <div className="h-4 w-px bg-gray-200 dark:bg-white/[0.08]" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{workflow.name}</span>
        <span className="text-xs text-gray-400">v{workflow.version}</span>
        <div className="flex-1" />
        <button onClick={autoLayout} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]">
          <Layout size={14} /> 自动布局
        </button>
        <button onClick={handleValidate} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]">
          <CheckCircle size={14} /> 校验
        </button>
        <button
          onClick={() => onRun({ ...workflow, nodes: collectNodes(), edges: collectEdges() })}
          className="flex items-center gap-1 rounded-lg bg-green-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-600"
        >
          <Play size={14} /> 运行
        </button>
        <button onClick={handleSave} className="flex items-center gap-1 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600">
          {saved ? <CheckCircle size={14} /> : <Save size={14} />} {saved ? '已保存' : '保存'}
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
          ✓ 校验通过
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
