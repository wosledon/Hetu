using System.Text.Json;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services;

/// <summary>
/// 工具注册表，管理所有可用的工具执行器。
/// 内置工具通过 DI 注入；运行时工具（如 MCP 适配器）可通过 <see cref="AddRuntimeTool"/> 动态注册，
/// 作用域结束后随实例一起释放。运行时工具名建议以 "mcp_" 前缀标识以便清理。
/// </summary>
public class ToolRegistry
{
    private readonly Dictionary<string, IToolExecutor> _executors = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, IToolExecutor> _runtimeExecutors = new(StringComparer.OrdinalIgnoreCase);

    public ToolRegistry(IEnumerable<IToolExecutor> executors)
    {
        foreach (var executor in executors)
        {
            _executors[executor.Name] = executor;
        }
    }

    /// <summary>添加运行时工具执行器（如 MCP 工具适配器）</summary>
    public void AddRuntimeTool(IToolExecutor executor)
        => _runtimeExecutors[executor.Name] = executor;

    /// <summary>清空所有运行时工具（保留内置工具）</summary>
    public void ClearRuntimeTools()
        => _runtimeExecutors.Clear();

    /// <summary>获取所有已注册的工具（内置 + 运行时）</summary>
    public IReadOnlyList<IToolExecutor> GetAll()
        => _executors.Values.Concat(_runtimeExecutors.Values).ToList();

    /// <summary>按名称获取工具执行器</summary>
    public IToolExecutor? GetExecutor(string name)
    {
        if (_runtimeExecutors.TryGetValue(name, out var rt)) return rt;
        return _executors.TryGetValue(name, out var executor) ? executor : null;
    }

    /// <summary>按工具名列表过滤（用于 Agent 绑定）</summary>
    public IReadOnlyList<IToolExecutor> GetByNames(IReadOnlyList<string>? names)
    {
        var all = GetAll();
        if (names is null || names.Count == 0) return all;
        var set = new HashSet<string>(names, StringComparer.OrdinalIgnoreCase);
        return all.Where(e => set.Contains(e.Name)).ToList();
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

