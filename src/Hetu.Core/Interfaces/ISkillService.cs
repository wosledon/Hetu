using Hetu.Shared.AI;
using Hetu.Shared.Common;

namespace Hetu.Core.Interfaces;

public interface ISkillService
{
    Task<ApiResponse<List<SkillDto>>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<SkillDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<SkillDto>> CreateAsync(CreateSkillRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<SkillDto>> UpdateAsync(Guid id, UpdateSkillRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<string>> InvokeAsync(string nameOrId, InvokeSkillRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<string>> InvokeByIdAsync(Guid id, InvokeSkillRequest request, CancellationToken cancellationToken = default);
    /// <summary>
    /// 执行本地技能（通过 LocalSkillDto 的 Config 配置）
    /// </summary>
    Task<ApiResponse<string>> InvokeLocalAsync(LocalSkillDto skill, string input, CancellationToken cancellationToken = default);
}
