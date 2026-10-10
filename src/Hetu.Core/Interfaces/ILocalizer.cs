namespace Hetu.Core.Interfaces;

/// <summary>
/// 后端文案本地化：键形如 "memory.notFound"，按请求头 Accept-Language → 应用设置 Language → 中文逐级回退。
/// 资源位于 Hetu.Infrastructure/Localization/Locales/{zh,en}/*.json（嵌入资源，按区域文件拆分）。
/// </summary>
public interface ILocalizer
{
    /// <summary>当前生效语言（zh / en）</summary>
    string Language { get; }

    /// <summary>取文案；缺失时回退中文，再回退键名。args 对应文案里的 {0}/{1} 占位符</summary>
    string T(string key, params object[] args);
}
