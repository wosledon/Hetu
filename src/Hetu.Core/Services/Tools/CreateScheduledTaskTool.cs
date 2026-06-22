using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Shared.AI;
using Hetu.Shared.Tasks;
using Microsoft.AspNetCore.Http;

namespace Hetu.Core.Services.Tools;

/// <summary>
/// 在对话中创建定时任务，自动绑定到当前会话 Topic，
/// 执行结果会作为 assistant 消息追加回该会话。
/// </summary>
public class CreateScheduledTaskTool : IToolExecutor
{
    private readonly IScheduledTaskService _scheduledTaskService;
    private readonly ILocalSkillService _localSkillService;
    private readonly IHttpContextAccessor _httpContextAccessor;

    public CreateScheduledTaskTool(
        IScheduledTaskService scheduledTaskService,
        ILocalSkillService localSkillService,
        IHttpContextAccessor httpContextAccessor)
    {
        _scheduledTaskService = scheduledTaskService;
        _localSkillService = localSkillService;
        _httpContextAccessor = httpContextAccessor;
    }

    public string Name => "create_scheduled_task";
    public string Description => "创建一个定时任务，按计划周期自动执行。支持执行技能、自定义 AI 任务、重建知识图谱、重建 Embedding。任务可绑定到当前会话，执行结果会自动追加到本会话。";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public string? UsageGuideline => "当用户要求「定时/定期/每天/每小时自动执行」某事时调用。需明确任务类型与调度方式。绑定当前会话后，每次执行结果都会追加到本对话。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "name": { "type": "string", "description": "任务名称，简明描述任务目的" },
            "taskKind": {
                "type": "string",
                "enum": ["Skill", "AiTask", "GraphRebuild", "EmbeddingRegenerate"],
                "description": "Skill=执行指定技能, AiTask=自定义指令让大模型执行, GraphRebuild=重建知识图谱, EmbeddingRegenerate=重建向量索引"
            },
            "targetId": { "type": "string", "description": "目标技能 ID（仅 taskKind=Skill 时需要）" },
            "parameters": { "type": "string", "description": "Skill=输入内容; AiTask=JSON {systemPrompt, prompt}; 其余留空" },
            "scheduleType": {
                "type": "string",
                "enum": ["Interval", "Cron"],
                "description": "Interval=固定间隔, Cron=Cron 表达式"
            },
            "intervalMinutes": { "type": "integer", "description": "间隔分钟数（scheduleType=Interval 时需要，默认 60）" },
            "cronExpression": { "type": "string", "description": "Cron 表达式，5 段：分 时 日 月 周（scheduleType=Cron 时需要，如 '0 8 * * *' 表示每天 8 点）" },
            "description": { "type": "string", "description": "任务描述（可选）" },
            "maxRetries": { "type": "integer", "description": "最大重试次数，默认 0（不重试）" },
            "bindToConversation": { "type": "boolean", "description": "是否绑定到当前会话，执行结果追加到本对话。默认 true" }
        },
        "required": ["name", "taskKind", "scheduleType"]
    }
    """).RootElement;

    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        try
        {
            using var doc = JsonDocument.Parse(argumentsJson);
            var root = doc.RootElement;

            var name = root.GetProperty("name").GetString() ?? "";
            if (string.IsNullOrWhiteSpace(name))
                return ToolExecutionResult.Error("任务名称不能为空");

            var taskKind = root.GetProperty("taskKind").GetString() ?? "AiTask";
            var scheduleType = root.GetProperty("scheduleType").GetString() ?? "Interval";

            var request = new CreateScheduledTaskRequest
            {
                Name = name,
                Description = root.TryGetProperty("description", out var d) ? d.GetString() : null,
                TaskKind = taskKind,
                TargetId = root.TryGetProperty("targetId", out var t) ? t.GetString() : null,
                Parameters = root.TryGetProperty("parameters", out var p) ? p.GetString() : null,
                ScheduleType = scheduleType,
                IntervalMinutes = root.TryGetProperty("intervalMinutes", out var im) ? im.GetInt32() : 60,
                CronExpression = root.TryGetProperty("cronExpression", out var c) ? c.GetString() : null,
                IsEnabled = true,
                MaxRetries = root.TryGetProperty("maxRetries", out var mr) ? mr.GetInt32() : 0,
            };

            // 绑定到当前会话
            var bindToConversation = !root.TryGetProperty("bindToConversation", out var bc) || bc.GetBoolean();
            if (bindToConversation)
            {
                request.TopicId = TryGetCurrentTopicId();
            }

            // 解析 targetName（如果是技能）
            if (taskKind == ScheduledTaskKinds.Skill && !string.IsNullOrEmpty(request.TargetId))
            {
                request.TargetName = await ResolveSkillNameAsync(request.TargetId, cancellationToken);
            }

            var result = await _scheduledTaskService.CreateAsync(request, cancellationToken);
            if (!result.Success || result.Data == null)
                return ToolExecutionResult.Error(result.Error ?? "创建定时任务失败");

            var task = result.Data;
            var output = JsonSerializer.Serialize(new
            {
                id = task.Id,
                name = task.Name,
                taskKind = task.TaskKind,
                scheduleType = task.ScheduleType,
                nextRunAt = task.NextRunAt,
                boundToConversation = task.TopicId.HasValue,
            });

            return ToolExecutionResult.Success(output);
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"创建定时任务失败: {ex.Message}");
        }
    }

    /// <summary>
    /// 从当前 HTTP 请求路径中提取 topicId（Stream 端点路径 topic/{topicId}/stream）
    /// </summary>
    private Guid? TryGetCurrentTopicId()
    {
        var httpContext = _httpContextAccessor.HttpContext;
        if (httpContext == null) return null;

        var path = httpContext.Request.Path.Value ?? "";
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i < segments.Length - 1; i++)
        {
            if (segments[i].Equals("topic", StringComparison.OrdinalIgnoreCase)
                && Guid.TryParse(segments[i + 1], out var parsed))
                return parsed;
        }

        return null;
    }

    private async Task<string?> ResolveSkillNameAsync(string targetId, CancellationToken cancellationToken)
    {
        // 本地技能
        if (targetId.StartsWith("local:", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                var localResp = await _localSkillService.ScanAllAsync(cancellationToken);
                var skill = (localResp.Data ?? new List<LocalSkillDto>())
                    .FirstOrDefault(s => string.Equals(s.Id, targetId, StringComparison.OrdinalIgnoreCase));
                return skill?.Name;
            }
            catch { return null; }
        }

        // 数据库技能：targetId 是 Guid，名称由 Service 内部解析，这里返回 null 让 Service 处理
        return null;
    }
}
