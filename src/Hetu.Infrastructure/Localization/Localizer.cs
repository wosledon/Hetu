using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Hetu.Core.Interfaces;
using Microsoft.AspNetCore.Http;

namespace Hetu.Infrastructure.Localization;

/// <summary>
/// 基于嵌入资源的内置实现：Locales/{zh,en}/*.json 里平铺 "区域.键" 形式的文案。
/// 按区域拆文件是为了让不同模块各自维护，新增区域文件无需改代码。
/// </summary>
public class Localizer : ILocalizer
{
    private static readonly Dictionary<string, Dictionary<string, string>> Bundled = LoadBundled();

    private readonly IHttpContextAccessor _http;
    private readonly ILanguagePreference _preference;

    public Localizer(IHttpContextAccessor http, ILanguagePreference preference)
    {
        _http = http;
        _preference = preference;
    }

    public string Language => Normalize(_http.HttpContext?.Request.Headers.AcceptLanguage.ToString()) ?? _preference.Language;

    public string T(string key, params object[] args)
    {
        var text = Lookup(Language, key) ?? Lookup("zh", key) ?? key;
        return args.Length == 0 ? text : string.Format(CultureInfo.InvariantCulture, text, args);
    }

    public string? Get(string key) => Lookup(Language, key) ?? Lookup("zh", key);

    /// <summary>"zh-CN,zh;q=0.9" 这类取值按前缀识别；识别不出（如 fr）返回 null 交给回退链</summary>
    public static string? Normalize(string? raw)
    {
        var value = raw?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(value)) return null;
        if (value.StartsWith("zh")) return "zh";
        if (value.StartsWith("en")) return "en";
        return null;
    }

    private static string? Lookup(string language, string key)
        => Bundled.TryGetValue(language, out var bucket) && bucket.TryGetValue(key, out var text) ? text : null;

    private static Dictionary<string, Dictionary<string, string>> LoadBundled()
    {
        var assembly = typeof(Localizer).Assembly;
        var result = new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var name in assembly.GetManifestResourceNames())
        {
            var match = Regex.Match(name, @"\.Locales\.(zh|en)\.([A-Za-z0-9_\-]+)\.json$");
            if (!match.Success) continue;
            using var stream = assembly.GetManifestResourceStream(name);
            if (stream == null) continue;
            using var reader = new StreamReader(stream);
            var map = JsonSerializer.Deserialize<Dictionary<string, string>>(reader.ReadToEnd());
            if (map == null) continue;
            var language = match.Groups[1].Value.ToLowerInvariant();
            if (!result.TryGetValue(language, out var bucket))
                result[language] = bucket = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var (key, value) in map) bucket[key] = value;
        }
        return result;
    }
}
