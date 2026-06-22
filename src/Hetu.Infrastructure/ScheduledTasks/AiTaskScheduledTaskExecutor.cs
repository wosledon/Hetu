using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Tasks;
using Microsoft.Extensions.Logging;

namespace Hetu.Infrastructure.ScheduledTasks;

/// <summary>
/// 描述性 AI 任务执行器：用户自定义系统提示与任务指令，调用 LLM 执行
/// </summary>
public class AiTaskScheduledTaskExecutor : IScheduledTaskExecutor
{
    private readonly ILLMProviderFactory _llmProviderFactory;
    private readonly ILogger<AiTaskScheduledTaskExecutor> _logger;

    public AiTaskScheduledTaskExecutor(
        ILLMProviderFactory llmProviderFactory,
        ILogger<AiTaskScheduledTaskExecutor> logger)
    {
        _llmProviderFactory = llmProviderFactory;
        _logger = logger;
    }

    public string Kind => ScheduledTaskKinds.AiTask;

    public async Task<string> ExecuteAsync(ScheduledTask task, CancellationToken cancellationToken = default)
    {
        var (systemPrompt, prompt) = ParseParameters(task.Parameters);
        if (string.IsNullOrWhiteSpace(prompt))
            throw new InvalidOperationException("AI 任务缺少任务指令");

        _logger.LogInformation("定时执行 AI 任务 {TaskName}，指令长度 {Len}", task.Name, prompt.Length);

        var provider = await _llmProviderFactory.CreateChatProviderAsync(cancellationToken);
        if (provider == null)
            throw new InvalidOperationException("未找到可用的对话模型，请先在设置中配置默认对话模型");

        var options = new ChatOptions
        {
            ModelId = string.Empty,
            SystemPrompt = string.IsNullOrWhiteSpace(systemPrompt) ? "你是智能助手。" : systemPrompt,
        };

        var result = await provider.ChatAsync(
            [new LlmChatMessage { Role = "user", Content = prompt }],
            options,
            cancellationToken);

        return Truncate(result);
    }

    internal static (string? SystemPrompt, string? Prompt) ParseParameters(string? parameters)
    {
        if (string.IsNullOrWhiteSpace(parameters))
            return (null, null);

        try
        {
            using var doc = JsonDocument.Parse(parameters);
            var root = doc.RootElement;
            var systemPrompt = root.TryGetProperty("systemPrompt", out var sp) ? sp.GetString() : null;
            var prompt = root.TryGetProperty("prompt", out var p) ? p.GetString() : null;

            // 兼容纯文本参数：若不是 JSON 对象或缺少 prompt，整体当作 prompt
            if (string.IsNullOrWhiteSpace(prompt) && root.ValueKind == JsonValueKind.String)
                prompt = root.GetString();

            return (systemPrompt, prompt);
        }
        catch
        {
            // 非 JSON，整体当作任务指令
            return (null, parameters);
        }
    }

    private static string Truncate(string result) =>
        result.Length > 500 ? result[..500] + "..." : result;
}
