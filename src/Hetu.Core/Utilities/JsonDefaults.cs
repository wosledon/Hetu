using System.Text.Json;

namespace Hetu.Core.Utilities;

/// <summary>解析第三方 JSON（LLM 输出、外部配置等）时共用的序列化选项。</summary>
public static class JsonDefaults
{
    /// <summary>属性名忽略大小写：外部来源的命名风格不可控。</summary>
    public static readonly JsonSerializerOptions CaseInsensitive = new()
    {
        PropertyNameCaseInsensitive = true,
    };
}
