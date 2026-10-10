namespace Hetu.Core.Services;

using System.Text.Json;
using Hetu.Core.Interfaces;

/// <summary>
/// Token 估算。Provider 只在流式响应里上报 usage，非流式调用（技能、图谱抽取、
/// 查询改写、Wiki 生成等）拿不到真实用量，用字符数粗估以让用量统计覆盖全部来源。
/// </summary>
public static class LlmTokenEstimator
{
    /// <summary>约 3 字符 / token</summary>
    public const int CharsPerToken = 3;

    /// <summary>紧凑 JSON 且不转义非 ASCII：默认 encoder 会把中文写成 \uXXXX，长度虚增数倍</summary>
    private static readonly JsonSerializerOptions CompactJson = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static int Estimate(string? text)
        => EstimateChars(text?.Length ?? 0);

    /// <summary>按字符数估算 token（约 <see cref="CharsPerToken"/> 字符 / token）</summary>
    public static int EstimateChars(long chars)
        => chars <= 0 ? 0 : (int)Math.Ceiling(chars / (double)CharsPerToken);

    public static int Estimate(IEnumerable<string> texts)
        => texts.Sum(Estimate);

    /// <summary>工具定义的实际字符数（按传给 LLM 的形式紧凑序列化）</summary>
    public static int ToolDefinitionChars(IEnumerable<LlmToolDefinition>? tools)
        => tools?.Sum(t => JsonSerializer.Serialize(t, CompactJson).Length) ?? 0;
}
