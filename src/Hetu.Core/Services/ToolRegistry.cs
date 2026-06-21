using System.Text.Json;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services;

/// <summary>
/// 工具注册表，管理所有可用的工具执行器
/// </summary>
public class ToolRegistry
{
    private readonly Dictionary<string, IToolExecutor> _executors = new(StringComparer.OrdinalIgnoreCase);

    public ToolRegistry(IEnumerable<IToolExecutor> executors)
    {
        foreach (var executor in executors)
        {
            _executors[executor.Name] = executor;
        }
    }

    /// <summary>获取所有已注册的工具</summary>
    public IReadOnlyList<IToolExecutor> GetAll() => _executors.Values.ToList();

    /// <summary>按名称获取工具执行器</summary>
    public IToolExecutor? GetExecutor(string name)
        => _executors.TryGetValue(name, out var executor) ? executor : null;

    /// <summary>按工具名列表过滤（用于 Agent 绑定）</summary>
    public IReadOnlyList<IToolExecutor> GetByNames(IReadOnlyList<string>? names)
    {
        if (names is null || names.Count == 0) return GetAll();
        return names
            .Where(n => _executors.ContainsKey(n))
            .Select(n => _executors[n])
            .ToList();
    }

    /// <summary>将指定工具转换为 LLM 工具定义</summary>
    public List<LlmToolDefinition> ToToolDefinitions(IReadOnlyList<string>? toolNames = null)
    {
        var executors = GetByNames(toolNames);
        return executors.Select(e => new LlmToolDefinition
        {
            Name = e.Name,
            Description = e.Description,
            ParametersSchema = e.ParametersSchema
        }).ToList();
    }
}
