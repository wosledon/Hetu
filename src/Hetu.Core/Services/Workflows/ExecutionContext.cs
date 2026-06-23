using System.Collections.Concurrent;
using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Shared.Workflow;

namespace Hetu.Core.Services.Workflows;

/// <summary>
/// 工作流执行上下文。维护节点输出变量、访问计数、全局迭代计数。
/// 变量通过 <c>{{nodeId.varName}}</c> 模板引用，默认 varName 为 "output"。
/// </summary>
public class ExecutionContext
{
    /// <summary>变量字典：key = "{nodeId}.{varName}"，value = 原始对象（序列化为 JSON 存储）</summary>
    private readonly ConcurrentDictionary<string, JsonElement> _variables = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>节点访问计数：key = nodeId</summary>
    private readonly ConcurrentDictionary<string, int> _nodeVisits = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>节点级执行记录（由引擎写入持久化）</summary>
    public List<WorkflowRunNode> RunNodes { get; } = new();

    /// <summary>原始输入</summary>
    public string? Input { get; set; }

    /// <summary>全局迭代计数（每次节点执行 +1）</summary>
    public int TotalIterations { get; set; }

    /// <summary>全局迭代上限</summary>
    public int MaxTotalIterations { get; set; } = 100;

    /// <summary>单节点最大访问次数</summary>
    public int MaxNodeVisits { get; set; } = 20;

    /// <summary>运行 ID</summary>
    public Guid RunId { get; set; }

    /// <summary>工作流节点列表</summary>
    public List<NodeDto> Nodes { get; set; } = new();

    /// <summary>工作流边列表</summary>
    public List<EdgeDto> Edges { get; set; } = new();

    /// <summary>设置节点变量</summary>
    public void SetVariable(string nodeId, string varName, object? value)
    {
        var key = $"{nodeId}.{varName}";
        if (value is null)
        {
            _variables.TryRemove(key, out _);
            return;
        }
        var element = value is JsonElement je ? je : JsonSerializer.SerializeToElement(value);
        _variables[key] = element;
    }

    /// <summary>获取节点变量（返回 JsonElement 的原始文本）</summary>
    public string? GetVariableText(string key)
    {
        if (_variables.TryGetValue(key, out var el))
        {
            return el.ValueKind switch
            {
                JsonValueKind.String => el.GetString(),
                _ => el.GetRawText()
            };
        }
        return null;
    }

    /// <summary>获取节点变量（JsonElement）</summary>
    public bool TryGetVariable(string key, out JsonElement value)
        => _variables.TryGetValue(key, out value);

    /// <summary>记录节点访问并返回访问后的次数</summary>
    public int IncrementVisit(string nodeId)
        => _nodeVisits.AddOrUpdate(nodeId, 1, (_, c) => c + 1);

    /// <summary>获取节点访问次数</summary>
    public int GetVisitCount(string nodeId)
        => _nodeVisits.TryGetValue(nodeId, out var c) ? c : 0;

    /// <summary>获取节点的所有变量（用于调试/输出）</summary>
    public Dictionary<string, string> GetAllVariables()
        => _variables.ToDictionary(kv => kv.Key, kv => kv.Value.ValueKind == JsonValueKind.String ? kv.Value.GetString() ?? "" : kv.Value.GetRawText(), StringComparer.OrdinalIgnoreCase);
}
