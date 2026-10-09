using System.Text.Json;
using Hetu.Core.Profiles;
using Hetu.Core.Services;
using Hetu.Shared.AI;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

/// <summary>
/// 内置工具目录：给「工具」页展示所有内置工具（名称、说明、风险、默认审批、可用人格、参数 schema）。
/// </summary>
[ApiController]
[Route("api/tools")]
public class ToolsController : ControllerBase
{
    private readonly ToolRegistry _toolRegistry;

    public ToolsController(ToolRegistry toolRegistry)
    {
        _toolRegistry = toolRegistry;
    }

    [HttpGet]
    public ApiResponse<List<ToolCatalogItemDto>> GetAll()
    {
        var profilesByTool = BuildProfileMap();

        var items = _toolRegistry.GetAll()
            .Select(executor => new ToolCatalogItemDto
            {
                Name = executor.Name,
                Description = executor.Description,
                UsageGuideline = executor.UsageGuideline,
                Risk = executor.Risk switch
                {
                    Core.Interfaces.ToolRisk.Read => "read",
                    Core.Interfaces.ToolRisk.Execute => "execute",
                    _ => "write",
                },
                DefaultApproval = executor.DefaultApproval switch
                {
                    Core.Interfaces.ToolApprovalMode.Auto => "auto",
                    Core.Interfaces.ToolApprovalMode.Bypass => "bypass",
                    _ => "ask",
                },
                Group = ResolveGroup(executor.Name),
                Profiles = profilesByTool.TryGetValue(executor.Name, out var profiles)
                    ? profiles.OrderBy(p => p).ToList()
                    : [],
                ParametersSchema = Serialize(executor.ParametersSchema),
            })
            .OrderBy(i => i.Group)
            .ThenBy(i => i.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return ApiResponse<List<ToolCatalogItemDto>>.Ok(items);
    }

    /// <summary>工具 → 可用人格（knowledge / work / desktop / cowork）</summary>
    private static Dictionary<string, HashSet<string>> BuildProfileMap()
    {
        var map = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);

        void Add(string profile, IEnumerable<string> toolNames)
        {
            foreach (var name in toolNames)
            {
                if (!map.TryGetValue(name, out var set))
                {
                    set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    map[name] = set;
                }
                set.Add(profile);
            }
        }

        Add("knowledge", BuiltinProfiles.Knowledge.AllowedTools);
        Add("work", BuiltinProfiles.Work.AllowedTools);
        Add("desktop", BuiltinProfiles.Desktop.AllowedTools);
        Add("cowork", BuiltinProfiles.CoWork.AllowedTools);
        return map;
    }

    /// <summary>按名称推断功能分组，用于工具页归类与筛选</summary>
    private static string ResolveGroup(string name)
    {
        if (name.StartsWith("work_", StringComparison.OrdinalIgnoreCase)) return "工作区与命令";
        if (name.Contains("notebook", StringComparison.OrdinalIgnoreCase)) return "笔记本";
        if (name.Contains("note", StringComparison.OrdinalIgnoreCase)) return "笔记";
        if (name.Contains("tag", StringComparison.OrdinalIgnoreCase)) return "标签";
        if (name.Contains("memor", StringComparison.OrdinalIgnoreCase)) return "记忆";
        if (name.Contains("graph", StringComparison.OrdinalIgnoreCase)) return "知识图谱";
        if (name.Contains("knowledge", StringComparison.OrdinalIgnoreCase)) return "知识库";
        if (name.Contains("scheduled", StringComparison.OrdinalIgnoreCase)) return "定时任务";
        if (name.Contains("kanban", StringComparison.OrdinalIgnoreCase)) return "任务看板";
        if (name.Contains("wiki", StringComparison.OrdinalIgnoreCase)) return "Wiki";
        if (name.Contains("workflow", StringComparison.OrdinalIgnoreCase)) return "工作流";
        if (name.Contains("agent", StringComparison.OrdinalIgnoreCase)) return "智能体";
        if (name.Contains("skill", StringComparison.OrdinalIgnoreCase)) return "技能";
        if (name.Contains("project", StringComparison.OrdinalIgnoreCase)) return "项目";
        if (name.Contains("inbox", StringComparison.OrdinalIgnoreCase)) return "收件箱";
        if (name.Contains("usage", StringComparison.OrdinalIgnoreCase)) return "用量";
        if (name.Contains("web", StringComparison.OrdinalIgnoreCase)) return "联网";
        return "通用";
    }

    private static string? Serialize(JsonElement schema)
        => schema.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null ? null : schema.GetRawText();
}
