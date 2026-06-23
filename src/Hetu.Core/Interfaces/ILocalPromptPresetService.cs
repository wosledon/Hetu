using Hetu.Shared.Chat;
using Hetu.Shared.Common;

namespace Hetu.Core.Interfaces;

public interface ILocalPromptPresetService
{
    /// <summary>
    /// 扫描配置的目录，返回所有本地智能体（Prompt Preset）
    /// </summary>
    Task<ApiResponse<List<LocalPromptPresetDto>>> ScanAllAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// 获取已配置的智能体目录列表
    /// </summary>
    Task<ApiResponse<List<string>>> GetDirectoriesAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// 更新智能体目录列表
    /// </summary>
    Task<ApiResponse> UpdateDirectoriesAsync(List<string> directories, CancellationToken cancellationToken = default);
}
