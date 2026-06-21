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
    public string Description => "保存一条记忆（用户偏好、重要信息）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public string? UsageGuideline => "识别到值得长期记住的用户偏好/事实（如「我用 PostgreSQL」「项目代号叫 X」）时主动调用；不要把临时对话内容当作记忆保存。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "content": { "type": "string", "description": "记忆内容" },
            "category": { "type": "string", "description": "分类（可选）" }
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

            var result = await _memoryService.CreateAsync(request, cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "保存记忆失败");

            var output = JsonSerializer.Serialize(new
            {
                id = result.Data.Id,
                content = result.Data.Content,
                category = result.Data.Category
            });

            return ToolExecutionResult.Success(output);
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"保存记忆失败: {ex.Message}");
        }
    }
}
