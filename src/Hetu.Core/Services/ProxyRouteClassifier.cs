using System.Text;
using System.Text.Json;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services;

/// <summary>
/// 问题分类器：优先用配置的 LLM 分类，失败/未配置则降级到规则启发式。
/// 类别：simple / complex / code / creative / math / default
/// </summary>
public class ProxyRouteClassifier
{
    private static readonly string[] Categories = { "simple", "complex", "code", "creative", "math", "default" };

    /// <summary>规则启发式分类（不调用 LLM，作为兜底）。</summary>
    public string ClassifyByRules(string userText)
    {
        if (string.IsNullOrWhiteSpace(userText)) return "default";
        var t = userText.Trim();

        // 代码
        if (ContainsAny(t, "```", "函数", "代码", "bug", "报错", "编译", "exception", "stack trace", "sql", "正则", "api", "debug", "refactor", "class ", "def ", "import "))
            return "code";
        // 数学
        if (ContainsAny(t, "计算", "证明", "方程", "积分", "导数", "概率", "矩阵", "=", "∑", "∫", "√", "几何", "代数"))
            return "math";
        // 创作
        if (ContainsAny(t, "写一篇", "作文", "诗", "小说", "故事", "文案", "润色", "改写", "翻译", "写一首", "创作", "剧本", "演讲稿"))
            return "creative";
        // 复杂（长文本 / 多步推理关键词）
        if (t.Length > 200 || ContainsAny(t, "分析", "推理", "为什么", "原理", "深入", "对比", "评估", "设计", "架构", "论证", "解释清楚"))
            return "complex";
        // 简单（短问答）
        if (t.Length < 30 || ContainsAny(t, "吗", "什么", "谁", "哪", "多少", "几", "是不是", "有没有"))
            return "simple";

        return "default";
    }

    /// <summary>LLM 分类。返回 null 表示调用失败（调用方应降级到规则启发）。</summary>
    public async Task<string?> ClassifyByLlmAsync(ILLMProvider classifier, string userText, CancellationToken ct = default)
    {
        try
        {
            var prompt = new StringBuilder()
                .Append("你是问题分类器。把用户问题分成以下类别之一，只输出类别英文单词，不要输出任何其他内容：\n")
                .Append("simple(简单问答) / complex(复杂推理分析) / code(编程相关) / creative(写作创作) / math(数学计算证明) / default(无法判断)\n\n")
                .Append("用户问题：").Append(userText.Length > 800 ? userText[..800] : userText);

            var messages = new List<LlmChatMessage> { new() { Role = "user", Content = prompt.ToString() } };
            var result = await classifier.ChatAsync(messages, new ChatOptions { Stream = false, Temperature = 0 }, ct);
            var category = result.Trim().Trim('.', '。', '"', '\'').ToLowerInvariant();
            return Categories.Contains(category) ? category : "default";
        }
        catch
        {
            return null;
        }
    }

    private static bool ContainsAny(string text, params string[] keywords)
        => keywords.Any(k => text.Contains(k, StringComparison.OrdinalIgnoreCase));
}
