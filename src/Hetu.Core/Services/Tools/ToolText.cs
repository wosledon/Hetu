using Hetu.Core.Interfaces;

namespace Hetu.Core.Services.Tools;

/// <summary>
/// 工具描述 / 使用指引的多语言：
/// 文案以工具名为键放在 Locales/{zh,en}/toolText.json（toolDesc.* / toolGuide.*），
/// 缺失时回退工具类里写死的中文原文，因此没翻译的工具也能正常工作。
/// </summary>
public static class ToolText
{
    public static string Describe(ILocalizer localizer, string toolName, string fallback)
        => localizer.Get($"toolDesc.{toolName}") ?? fallback;

    public static string? Guideline(ILocalizer localizer, string toolName, string? fallback)
        => fallback == null ? null : localizer.Get($"toolGuide.{toolName}") ?? fallback;
}
