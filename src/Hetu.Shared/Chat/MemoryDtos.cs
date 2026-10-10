namespace Hetu.Shared.Chat;

/// <summary>记忆作用域：Global 全局 / Session 会话 / Project 项目</summary>
public static class MemoryScopes
{
    public const string Global = "Global";
    public const string Session = "Session";
    public const string Project = "Project";
    public static readonly IReadOnlyList<string> All = [Global, Session, Project];
}

public class MemoryDto
{
    public Guid Id { get; set; }
    public string Content { get; set; } = string.Empty;
    public string Source { get; set; } = "conversation";
    public Guid? TopicId { get; set; }
    /// <summary>Global / Session / Project</summary>
    public string Scope { get; set; } = MemoryScopes.Global;
    public Guid? ProjectId { get; set; }
    /// <summary>项目记忆的项目名（列表展示用）</summary>
    public string? ProjectName { get; set; }
    public string? Category { get; set; }
    public float Importance { get; set; }
    public int AccessCount { get; set; }
    public DateTimeOffset LastAccessedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    /// <summary>检索时的综合得分（仅在检索结果中填充）</summary>
    public double? Score { get; set; }
}

public class CreateMemoryRequest
{
    public string Content { get; set; } = string.Empty;
    public string? Category { get; set; }
    public float Importance { get; set; } = 0.5f;
    /// <summary>默认 Global；手动创建可选 Global / Project（Session 由对话提取产生）</summary>
    public string Scope { get; set; } = MemoryScopes.Global;
    public Guid? ProjectId { get; set; }
}

public class UpdateMemoryRequest
{
    public string Content { get; set; } = string.Empty;
    public string? Category { get; set; }
    public float Importance { get; set; }
    public string Scope { get; set; } = MemoryScopes.Global;
    public Guid? ProjectId { get; set; }
}

public class MemorySearchRequest
{
    public string Query { get; set; } = string.Empty;
    public int TopK { get; set; } = 10;
}

/// <summary>一次 Dream（记忆巩固）的执行结果</summary>
public class DreamResultDto
{
    public DateTimeOffset RanAt { get; set; }
    /// <summary>合并的重复记忆条数（被吸收的数量）</summary>
    public int Merged { get; set; }
    /// <summary>衰减（长期未想起而弱化）的条数</summary>
    public int Decayed { get; set; }
    /// <summary>遗忘（弱化到阈值以下被清除）的条数</summary>
    public int Forgotten { get; set; }
    /// <summary>巩固后剩余记忆条数</summary>
    public int Remaining { get; set; }
    public long DurationMs { get; set; }
}
