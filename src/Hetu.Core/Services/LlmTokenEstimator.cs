namespace Hetu.Core.Services;

/// <summary>
/// Token 估算。Provider 只在流式响应里上报 usage，非流式调用（技能、图谱抽取、
/// 查询改写、Wiki 生成等）拿不到真实用量，用字符数粗估以让用量统计覆盖全部来源。
/// </summary>
public static class LlmTokenEstimator
{
    /// <summary>约 3 字符 / token</summary>
    public const int CharsPerToken = 3;

    public static int Estimate(string? text)
        => string.IsNullOrEmpty(text) ? 0 : (int)Math.Ceiling(text.Length / (double)CharsPerToken);

    public static int Estimate(IEnumerable<string> texts)
        => texts.Sum(Estimate);
}
