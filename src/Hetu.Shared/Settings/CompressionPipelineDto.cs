namespace Hetu.Shared.Settings;

public class CompressionPipelineDto
{
    public bool Enabled { get; set; }
    public string Mode { get; set; } = "algorithmic"; // algorithmic | llm | hybrid
    public string? LlmModelId { get; set; }
    public string? LlmSystemPrompt { get; set; } = "压缩以下文本，保留所有关键信息，尽可能减少 token 数量：";
    public List<CompressionNodeDto> Nodes { get; set; } = new();
}

public class CompressionNodeDto
{
    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public bool Enabled { get; set; } = true;
    public int Order { get; set; }
}

public static class CompressionDefaults
{
    public static CompressionPipelineDto GetDefault() => new()
    {
        Enabled = false,
        Mode = "algorithmic",
        Nodes = new List<CompressionNodeDto>
        {
            new() { Key = "dedup", Label = "去重合并", Description = "移除重复行和段落，保留首次出现", Enabled = true, Order = 1 },
            new() { Key = "whitespace", Label = "格式压缩", Description = "去除多余空格、换行和缩进", Enabled = true, Order = 2 },
            new() { Key = "number_normalize", Label = "数字归一化", Description = "将数字替换为占位符，减少变化", Enabled = true, Order = 3 },
            new() { Key = "log_dedup", Label = "日志去重", Description = "识别并折叠重复的日志模式", Enabled = true, Order = 4 },
            new() { Key = "stopwords", Label = "停用词过滤", Description = "移除常见无意义词汇（中英文）", Enabled = false, Order = 5 },
            new() { Key = "llm_summary", Label = "LLM 摘要", Description = "使用 AI 模型压缩文本", Enabled = false, Order = 6 },
        }
    };
}
