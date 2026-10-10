namespace Hetu.Core.Interfaces;

/// <summary>
/// 用户偏好的界面语言（应用设置 Language 的内存副本）。
/// 请求线程优先用 Accept-Language；后台任务没有请求头，因此需要这个全局值。
/// </summary>
public interface ILanguagePreference
{
    string Language { get; set; }
}
