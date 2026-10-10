namespace Hetu.Shared.Settings;

public class CompressionPipelineDto
{
    public bool Enabled { get; set; }
    public string Mode { get; set; } = "algorithmic"; // algorithmic | llm | hybrid
    public string? LlmModelId { get; set; }
    public string? LlmSystemPrompt { get; set; } =
        "压缩下面这段文本：保留全部关键信息（结论、数字、路径与文件名、命令、待办与约束），" +
        "删除重复表述、寒暄与无信息量的格式；不要编造或改变事实，输出与原文相同语言。";
    /// <summary>
    /// LLM 摘要触发阈值（字符）：算法节点对任意长度文本都生效，只有 LLM 摘要按阈值触发（避免为短文本多花一次模型调用）
    /// </summary>
    public int LlmThreshold { get; set; } = 500;
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
        LlmThreshold = 500,
        Nodes = new List<CompressionNodeDto>
        {
            new() { Key = "structured", Label = "结构化折叠", Description = "折叠 base64/HTML/JSON/表格等长载荷，只留结构骨架与样本", Enabled = true, Order = 1 },
            new() { Key = "dedup", Label = "去重合并", Description = "去除重复段落、重复行与行内重复句，保留首次出现", Enabled = true, Order = 2 },
            new() { Key = "whitespace", Label = "格式压缩", Description = "去除多余空格、换行和缩进", Enabled = true, Order = 3 },
            new() { Key = "log_dedup", Label = "日志去重", Description = "识别并折叠重复的日志模式", Enabled = true, Order = 4 },
            new() { Key = "near_dup", Label = "近似重复", Description = "SimHash 相似度去重，抓只有时间戳/ID 不同的重复内容", Enabled = true, Order = 5 },
            new() { Key = "number_normalize", Label = "数字归一化", Description = "将数字替换为占位符，减少变化", Enabled = true, Order = 6 },
            new() { Key = "stopwords", Label = "停用词过滤", Description = "移除常见无意义词汇（中英文）", Enabled = false, Order = 7 },
            new() { Key = "keywords", Label = "关键行抽取", Description = "按信息量打分保留错误/结论/路径等关键行，折叠其余流水行", Enabled = true, Order = 8 },
            new() { Key = "headtail", Label = "超长头尾保留", Description = "超长输出保留首尾、折叠中间（构建日志/大文件内容）", Enabled = true, Order = 9 },
            new() { Key = "llm_summary", Label = "LLM 摘要", Description = "使用 AI 模型压缩文本", Enabled = false, Order = 10 },
        }
    };
}
