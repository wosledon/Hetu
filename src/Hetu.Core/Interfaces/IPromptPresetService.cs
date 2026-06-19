using Hetu.Shared.Chat;
using Hetu.Shared.Common;

namespace Hetu.Core.Interfaces;

public interface IPromptPresetService
{
    Task<ApiResponse<List<PromptPresetDto>>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<PromptPresetDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<PromptPresetDto>> CreateAsync(CreatePromptPresetRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<PromptPresetDto>> UpdateAsync(Guid id, UpdatePromptPresetRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<List<PromptPresetDto>>> ExportAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<int>> ImportAsync(List<ImportPromptPresetItem> items, CancellationToken cancellationToken = default);
}

public class ImportPromptPresetItem
{
    public string Category { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string? Variables { get; set; }
}
