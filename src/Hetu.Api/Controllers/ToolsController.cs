using System.Text.Json;
using Hetu.Core.Profiles;
using Hetu.Core.Services;
using Hetu.Core.Services.Tools;
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
                Description = _toolRegistry.Describe(executor),
                UsageGuideline = _toolRegistry.Guideline(executor),
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
                ParametersSchema = _toolRegistry.LocalizeParameters(executor.Name, Serialize(executor.ParametersSchema)),
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

    /// <summary>按名称推断功能分组，用于工具页归类与筛选（与系统提示索引、load_tools 分组共用同一套映射）</summary>
    private static string ResolveGroup(string name) => ToolGroupMap.Resolve(name);

    private static string? Serialize(JsonElement schema)
        => schema.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null ? null : schema.GetRawText();
}
