using System.Text.RegularExpressions;
using Hetu.Core.Interfaces;
using Microsoft.Extensions.Logging;

namespace Hetu.Core.Services.Work;

/// <summary>
/// 按用户第一条消息给独立工作树起名：目录名与分支名同名。
/// 让模型输出英文 kebab-case 短名（如 fix-task-kanban），失败时退回本地 slug 或 session-&lt;短 id&gt;，
/// 保证任何情况下都能建出工作树。
/// </summary>
public class WorktreeNameSuggester
{
    private const string SystemPrompt = """
你是 git 分支命名助手。根据用户的任务描述给出一个英文 kebab-case 短名，用作分支名与工作树目录名。

规则：
- 只输出名字本身，2-4 个英文单词，小写字母/数字/连字符，如 fix-task-kanban
- 不要中文、不要引号、不要反引号、不要解释、不要前缀（如 feature/、hetu/）、不要扩展名
- 动词开头更贴合（fix/add/refactor/update/remove…）
- 无法判断时输出 task
""";

    private readonly ILogger<WorktreeNameSuggester> _logger;

    public WorktreeNameSuggester(ILogger<WorktreeNameSuggester> logger) => _logger = logger;

    /// <summary>建议名字；<paramref name="message"/> 为空或调用失败时用本地回退</summary>
    public async Task<string> SuggestAsync(string? message, Guid sessionId, ILLMProvider? provider, CancellationToken cancellationToken = default)
    {
        var fallback = FallbackName(message, sessionId);
        var text = message?.Trim();
        if (provider == null || string.IsNullOrEmpty(text)) return fallback;

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(TimeSpan.FromSeconds(20));

            // 预算给足：native 推理模型会把 token 全用在思考上，预算太小则正文为空（拿不到名字）
            var raw = await provider.CompleteAsync(
                text.Length > 2000 ? text[..2000] : text,
                new CompletionOptions
                {
                    ModelId = string.Empty,
                    SystemPrompt = SystemPrompt,
                    Temperature = 0.2,
                    MaxTokens = 2000,
                },
                cts.Token);

            var name = PickSlug(raw);
            if (name.Length >= 2) return name;
            _logger.LogDebug("工作树命名未得到有效名字：{Raw}", raw);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "工作树命名调用失败，使用本地回退名 {Fallback}", fallback);
        }
        return fallback;
    }

    /// <summary>从模型输出里挑出最像名字的一行（推理模型可能把思考也一起返回）</summary>
    public static string PickSlug(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.Empty;
        var lines = text.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        foreach (var line in lines)
        {
            var candidate = Slugify(line);
            if (candidate.Length is >= 3 and <= 50 && candidate.Split('-').Length <= 5) return candidate;
        }
        return Slugify(lines.FirstOrDefault());
    }

    /// <summary>把模型输出清洗成合法名字：只留 a-z0-9-，压缩连续连字符，限长</summary>
    public static string Slugify(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.Empty;
        var line = text.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault() ?? string.Empty;
        line = line.Trim().Trim('`', '"', '\'', '“', '”', '\'', '。', '.', '/', '\\').ToLowerInvariant();
        var slug = Regex.Replace(line, "[^a-z0-9]+", "-").Trim('-');
        if (slug.Length > 50) slug = slug[..50].Trim('-');
        return slug;
    }

    /// <summary>本地回退：取消息里的英文/数字词拼成 kebab-case；一个都没有时用 session-&lt;短 id&gt;</summary>
    private static string FallbackName(string? message, Guid sessionId)
    {
        var words = Regex.Matches(message ?? string.Empty, "[A-Za-z][A-Za-z0-9]{1,19}")
            .Select(m => m.Value.ToLowerInvariant())
            .Where(w => w is not ("the" or "and" or "for" or "with" or "this" or "that" or "please" or "todo" or "fixme"))
            .Distinct()
            .Take(4)
            .ToList();
        var slug = Slugify(string.Join('-', words));
        return slug.Length >= 2 ? slug : $"session-{sessionId.ToString("N")[..8]}";
    }
}
