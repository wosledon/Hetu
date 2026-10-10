using Hetu.Core.Interfaces;

namespace Hetu.Infrastructure.Localization;

/// <summary>界面语言偏好的进程内副本；写入端为应用设置（Language），启动时由 LanguageWarmupService 预热。</summary>
public class LanguagePreference : ILanguagePreference
{
    private volatile string _language = "zh";

    public string Language
    {
        get => _language;
        set => _language = Localizer.Normalize(value) ?? "zh";
    }
}
