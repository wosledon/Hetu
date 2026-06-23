namespace Hetu.Shared.Workflow;

/// <summary>工作流节点类型</summary>
public static class WorkflowNodeTypes
{
    public const string Start = "start";
    public const string Agent = "agent";
    public const string Condition = "condition";
    public const string End = "end";
    public const string Loop = "loop";
    public const string Parallel = "parallel";
    public const string Tool = "tool";
    public const string Human = "human";
    public const string SubWorkflow = "subworkflow";
}

/// <summary>工作流节点定义（对应 ReactFlow 节点）</summary>
public class NodeDto
{
    public string Id { get; set; } = string.Empty;
    public string Type { get; set; } = WorkflowNodeTypes.Agent;
    public string Label { get; set; } = string.Empty;

    /// <summary>Agent 节点：引用的 Agent 实体 ID</summary>
    public Guid? AgentId { get; set; }

    /// <summary>JSON: 节点类型相关配置（Condition 表达式 / Loop maxIterations / Tool 工具名 / SubWorkflow 子工作流 ID 等）</summary>
    public string? Config { get; set; }

    /// <summary>画布坐标</summary>
    public double X { get; set; }
    public double Y { get; set; }
}

/// <summary>工作流边定义（对应 ReactFlow 边）</summary>
public class EdgeDto
{
    public string Id { get; set; } = string.Empty;
    public string Source { get; set; } = string.Empty;
    public string Target { get; set; } = string.Empty;

    /// <summary>Condition 节点分支标识（如 "true"/"false"/自定义 handle 名）</summary>
    public string? SourceHandle { get; set; }
    public string? TargetHandle { get; set; }
}

public class WorkflowDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public List<NodeDto> Nodes { get; set; } = new();
    public List<EdgeDto> Edges { get; set; } = new();
    public string? InputSchema { get; set; }
    public string? Variables { get; set; }
    public int Version { get; set; }
    public bool IsEnabled { get; set; }
    public int SortOrder { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class CreateWorkflowRequest
{
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public List<NodeDto> Nodes { get; set; } = new();
    public List<EdgeDto> Edges { get; set; } = new();
    public string? InputSchema { get; set; }
    public string? Variables { get; set; }
    public bool IsEnabled { get; set; } = true;
    public int SortOrder { get; set; }
}

public class UpdateWorkflowRequest : CreateWorkflowRequest { }

public class WorkflowRunDto
{
    public Guid Id { get; set; }
    public Guid WorkflowId { get; set; }
    public string Status { get; set; } = string.Empty;
    public string? Input { get; set; }
    public string? Output { get; set; }
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public Guid? ChatTopicId { get; set; }
    public string? Error { get; set; }
    public int TotalIterations { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class WorkflowRunNodeDto
{
    public Guid Id { get; set; }
    public Guid RunId { get; set; }
    public string NodeId { get; set; } = string.Empty;
    public string NodeType { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string? Input { get; set; }
    public string? Output { get; set; }
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public string? Error { get; set; }
    public int Iterations { get; set; }
}

public class RunWorkflowRequest
{
    /// <summary>JSON: 输入参数（匹配 Workflow.InputSchema）</summary>
    public string? Input { get; set; }
}

public class ValidationResultDto
{
    public bool Valid { get; set; }
    public List<string> Errors { get; set; } = new();
}
