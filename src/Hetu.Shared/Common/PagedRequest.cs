namespace Hetu.Shared.Common;

/// <summary>
/// 分页请求参数
/// </summary>
public class PagedRequest
{
    /// <summary>
    /// 页码，从 1 开始
    /// </summary>
    public int Page { get; set; } = 1;

    /// <summary>
    /// 每页大小，默认 20
    /// </summary>
    public int PageSize { get; set; } = 20;
}
