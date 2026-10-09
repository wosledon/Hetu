using System.Text.Json;
using Hetu.Core.Utilities;

namespace Hetu.Core.Services.Tools;

/// <summary>工具返回值序列化：统一 camelCase，避免 DTO 字段以 PascalCase 出现在模型上下文里。</summary>
internal static class ToolJson
{
    public static string Serialize(object value) => JsonSerializer.Serialize(value, JsonDefaults.CamelCase);
}
