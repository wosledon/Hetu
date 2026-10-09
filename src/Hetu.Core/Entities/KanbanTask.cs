namespace Hetu.Core.Entities;

/// <summary>
/// 看板任务实体：个人任务看板（Todo / 任务流转）的卡片
/// </summary>
public class KanbanTask : BaseEntity
{
    /// <summary>任务标题</summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>任务描述（可选）</summary>
    public string? Description { get; set; }

    /// <summary>看板列状态：Backlog / Todo / InProgress / InReview / Blocked / Done / Archived</summary>
    public string Status { get; set; } = Hetu.Shared.Tasks.KanbanTaskStatuses.Backlog;

    /// <summary>优先级：Low / Medium / High / Urgent</summary>
    public string Priority { get; set; } = Hetu.Shared.Tasks.KanbanTaskPriorities.Medium;

    /// <summary>负责人（可选）</summary>
    public string? Assignee { get; set; }

    /// <summary>标签，逗号分隔（可选）</summary>
    public string? Tags { get; set; }

    /// <summary>截止日期（可选）</summary>
    public DateTimeOffset? DueDate { get; set; }

    /// <summary>列内排序序号，越小越靠前</summary>
    public int SortOrder { get; set; }

    /// <summary>阻塞原因（Status 为 Blocked 时填写）</summary>
    public string? BlockedReason { get; set; }

    /// <summary>完成时间（Status 变为 Done 时记录）</summary>
    public DateTimeOffset? CompletedAt { get; set; }

    /// <summary>归档时间（Status 变为 Archived 时记录，看板仅展示 7 天内归档）</summary>
    public DateTimeOffset? ArchivedAt { get; set; }

    /// <summary>关联的项目管理条目（任务在哪个项目中执行）</summary>
    public Guid? ProjectId { get; set; }

    /// <summary>关联的智能体（PromptPreset）；与 WorkflowId 至少其一非空时进入待办即自动触发</summary>
    public Guid? AgentId { get; set; }

    /// <summary>
    /// 项目 .github 智能体的正文（AgentId 为空时生效）：项目自定义智能体没有数据库主键，
    /// 直接把正文存下来，执行时作为系统提示。
    /// </summary>
    public string? AgentPrompt { get; set; }

    /// <summary>项目 .github 智能体的显示名（卡片/评论里展示）</summary>
    public string? AgentPromptName { get; set; }

    /// <summary>关联的工作流；进入待办即自动触发</summary>
    public Guid? WorkflowId { get; set; }

    /// <summary>最近一次自动触发的执行 ID（KanbanTaskRun）</summary>
    public Guid? LastRunId { get; set; }

    /// <summary>是否软删除</summary>
    public bool IsDeleted { get; set; }
}

/// <summary>
/// 任务评论 / 执行流水：PR-Issue 式时间线。
/// 作者类型：User 用户 / Agent 智能体 / System 系统 / Workflow 工作流
/// </summary>
public class KanbanTaskComment : BaseEntity
{
    public Guid TaskId { get; set; }

    /// <summary>User / Agent / System / Workflow</summary>
    public string AuthorType { get; set; } = "User";

    /// <summary>作者展示名（智能体名 / 工作流名 / 用户）</summary>
    public string AuthorName { get; set; } = string.Empty;

    /// <summary>正文（Markdown）</summary>
    public string Content { get; set; } = string.Empty;

    /// <summary>关联的执行记录（Agent/System 评论由某次执行产生）</summary>
    public Guid? RunId { get; set; }

    public bool IsDeleted { get; set; }
}

/// <summary>
/// 任务执行记录：智能体或工作流的一次运行，含输入输出与状态
/// </summary>
public class KanbanTaskRun : BaseEntity
{
    public Guid TaskId { get; set; }

    /// <summary>Agent / Workflow</summary>
    public string Kind { get; set; } = "Agent";

    /// <summary>触发来源：Todo 进入待办 / Comment 用户评论 / Manual 手动重跑</summary>
    public string Trigger { get; set; } = "Todo";

    /// <summary>Running / Succeeded / Failed</summary>
    public string Status { get; set; } = "Running";

    /// <summary>本次执行的提示词输入（任务简报 + 评论）</summary>
    public string? Input { get; set; }

    /// <summary>执行输出（智能体最终答复 / 工作流输出）</summary>
    public string? Output { get; set; }

    public string? Error { get; set; }

    /// <summary>工作流运行时关联的 WorkflowRunId（Kind = Workflow）</summary>
    public Guid? WorkflowRunId { get; set; }

    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
}

/// <summary>
/// 任务执行过程步骤：智能体/工作流一次执行期间的思考、输出、工具调用与结果流水。
/// 时间线按 Sequence 顺序展示，让执行过程可回溯（PR 式的 check run 详情）。
/// </summary>
public class KanbanTaskRunStep : BaseEntity
{
    public Guid TaskId { get; set; }
    public Guid RunId { get; set; }

    /// <summary>Thought / Text / ToolCall / ToolResult / Node</summary>
    public string Kind { get; set; } = "Text";

    /// <summary>工具名 / 节点名（Thought、Text 为空）</summary>
    public string? Title { get; set; }

    public string Content { get; set; } = string.Empty;

    public bool IsError { get; set; }

    /// <summary>同一次执行内的顺序，越小越靠前</summary>
    public int Sequence { get; set; }
}

