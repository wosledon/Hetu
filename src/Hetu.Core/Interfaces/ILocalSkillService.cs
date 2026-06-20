using Hetu.Shared.AI;
using Hetu.Shared.Common;

namespace Hetu.Core.Interfaces;

public interface ILocalSkillService
{
    /// <summary>
    /// 扫描配置的目录，返回所有本地技能
    /// </summary>
    Task<ApiResponse<List<LocalSkillDto>>> ScanAllAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// 获取已配置的技能目录列表
    /// </summary>
    Task<ApiResponse<List<string>>> GetDirectoriesAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// 更新技能目录列表
    /// </summary>
    Task<ApiResponse> UpdateDirectoriesAsync(List<string> directories, CancellationToken cancellationToken = default);
}
