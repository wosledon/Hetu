export const WorkflowNodeTypes = {
  Start: 'start',
  Agent: 'agent',
  Condition: 'condition',
  End: 'end',
  Loop: 'loop',
  Parallel: 'parallel',
  Tool: 'tool',
  Human: 'human',
  SubWorkflow: 'subworkflow',
} as const

export type WorkflowNodeType = typeof WorkflowNodeTypes[keyof typeof WorkflowNodeTypes]

export interface INodeConfig {
  [key: string]: unknown
}

export interface IWorkflowNode {
  id: string
  type: WorkflowNodeType
  label: string
  agentId?: string
  config?: string
  x: number
  y: number
}

export interface IWorkflowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export interface IWorkflow {
  id: string
  name: string
  description: string
  nodes: IWorkflowNode[]
  edges: IWorkflowEdge[]
  inputSchema?: string
  variables?: string
  version: number
  isEnabled: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CreateWorkflowRequest {
  name: string
  description: string
  nodes: IWorkflowNode[]
  edges: IWorkflowEdge[]
  inputSchema?: string
  variables?: string
  isEnabled: boolean
  sortOrder: number
}

export type UpdateWorkflowRequest = CreateWorkflowRequest

export interface IWorkflowRun {
  id: string
  workflowId: string
  status: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Cancelled'
  input?: string
  output?: string
  startedAt?: string
  completedAt?: string
  chatTopicId?: string
  error?: string
  totalIterations: number
  createdAt: string
}

export interface IWorkflowRunNode {
  id: string
  runId: string
  nodeId: string
  nodeType: string
  status: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Skipped'
  input?: string
  output?: string
  startedAt?: string
  completedAt?: string
  error?: string
  iterations: number
}

export interface IWorkflowRunDetail {
  run: IWorkflowRun
  nodes: IWorkflowRunNode[]
}

export interface IValidationResult {
  valid: boolean
  errors: string[]
}

export interface IRunWorkflowRequest {
  input?: string
}

export interface IWorkflowEvent {
  type: string
  runId?: string
  nodeId?: string
  nodeType?: string
  label?: string
  output?: string
  error?: string
  result?: {
    runId: string
    status: string
    output?: string
    error?: string
  }
}
