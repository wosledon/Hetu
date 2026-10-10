using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;

namespace Hetu.Core.Services.Tools;

public class CreateMemoryTool : IToolExecutor
{
    private readonly IMemoryService _memoryService;

    public CreateMemoryTool(IMemoryService memoryService)
    {
        _memoryService = memoryService;
    }

    public string Name => "create_memory";
    public string Description => "保存一条长期记忆（用户偏好、重要事实、项目约定），支持作用域：Global 全局公共 / Project 项目内";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public string? UsageGuideline => "识别到值得长期记住的用户偏好/事实（如「我用 PostgreSQL」）时主动调用；Code 会话中保存项目级事实（技术栈、架构约定、踩坑结论）时传 scope=Project 并用 list_projects 拿 projectId；会话内临时信息不要保存（会话记忆由系统自动提取）。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "content": { "type": "string", "description": "记忆内容" },
            "category": { "type": "string", "description": "分类（可选，如 偏好/身份/项目约定）" },
            "scope": { "type": "string", "description": "作用域：Global 全局公共（默认）| Project 项目内；会话记忆由系统自动提取，不要传" },
            "projectId": { "type": "string", "description": "scope=Project 时的受管项目 ID（见 list_projects）" }
        },
        "required": ["content"]
    }
    """).RootElement;

    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            using var doc = JsonDocument.Parse(argumentsJson);
            var root = doc.RootElement;

            var content = root.GetProperty("content").GetString() ?? "";
            if (string.IsNullOrWhiteSpace(content))
                return ToolExecutionResult.Error("content 参数不能为空");

            var request = new CreateMemoryRequest
            {
                Content = content
            };

            if (root.TryGetProperty("category", out var catProp) && catProp.ValueKind == JsonValueKind.String)
                request.Category = catProp.GetString();

            // 作用域：默认全局；Project 需要 projectId（会话作用域不允许手动创建）
            if (root.TryGetProperty("scope", out var scopeProp) && scopeProp.ValueKind == JsonValueKind.String)
                request.Scope = scopeProp.GetString() ?? MemoryScopes.Global;
            if (root.TryGetProperty("projectId", out var projProp) && projProp.ValueKind == JsonValueKind.String)
                request.ProjectId = Guid.TryParse(projProp.GetString(), out var pid) ? pid : null;

            var result = await _memoryService.CreateAsync(request, cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "保存记忆失败");

            var output = JsonSerializer.Serialize(new
            {
                id = result.Data.Id,
                content = result.Data.Content,
                category = result.Data.Category,
                scope = result.Data.Scope,
                projectName = result.Data.ProjectName
            });

            return ToolExecutionResult.Success(output);
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"保存记忆失败: {ex.Message}");
        }
    }
}
