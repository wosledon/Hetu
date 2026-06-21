using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;

namespace Hetu.Core.Services;

public class PromptPresetService : IPromptPresetService
{
    private readonly IUnitOfWork _unitOfWork;

    public PromptPresetService(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    public async Task<ApiResponse<List<PromptPresetDto>>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var presets = await _unitOfWork.PromptPresets.GetAllAsync(cancellationToken);
        return ApiResponse<List<PromptPresetDto>>.Ok(presets.OrderBy(p => p.Category).ThenBy(p => p.SortOrder).Select(Map).ToList());
    }

    public async Task<ApiResponse<PromptPresetDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var preset = await _unitOfWork.PromptPresets.GetByIdAsync(id, cancellationToken);
        if (preset == null) return ApiResponse<PromptPresetDto>.Fail("预设不存在");
        return ApiResponse<PromptPresetDto>.Ok(Map(preset));
    }

    public async Task<ApiResponse<PromptPresetDto>> CreateAsync(CreatePromptPresetRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.Content))
            return ApiResponse<PromptPresetDto>.Fail("名称和内容不能为空");

        var preset = new PromptPreset
        {
            Id = Guid.NewGuid(),
            Category = string.IsNullOrWhiteSpace(request.Category) ? "自定义" : request.Category.Trim(),
            Name = request.Name.Trim(),
            Content = request.Content.Trim(),
            Variables = request.Variables,
            ToolsConfig = request.ToolsConfig,
            IsBuiltIn = false,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.PromptPresets.AddAsync(preset, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<PromptPresetDto>.Ok(Map(preset));
    }

    public async Task<ApiResponse<PromptPresetDto>> UpdateAsync(Guid id, UpdatePromptPresetRequest request, CancellationToken cancellationToken = default)
    {
        var preset = await _unitOfWork.PromptPresets.GetByIdAsync(id, cancellationToken);
        if (preset == null) return ApiResponse<PromptPresetDto>.Fail("预设不存在");
        if (preset.IsBuiltIn) return ApiResponse<PromptPresetDto>.Fail("内置预设不能编辑");

        preset.Category = string.IsNullOrWhiteSpace(request.Category) ? preset.Category : request.Category.Trim();
        preset.Name = string.IsNullOrWhiteSpace(request.Name) ? preset.Name : request.Name.Trim();
        preset.Content = string.IsNullOrWhiteSpace(request.Content) ? preset.Content : request.Content.Trim();
        preset.Variables = request.Variables;
        preset.ToolsConfig = request.ToolsConfig;
        preset.SortOrder = request.SortOrder;
        preset.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.PromptPresets.UpdateAsync(preset, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<PromptPresetDto>.Ok(Map(preset));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var preset = await _unitOfWork.PromptPresets.GetByIdAsync(id, cancellationToken);
        if (preset == null) return ApiResponse.Fail("预设不存在");
        if (preset.IsBuiltIn) return ApiResponse.Fail("内置预设不能删除");

        await _unitOfWork.PromptPresets.DeleteAsync(preset, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    private static PromptPresetDto Map(PromptPreset preset) => new()
    {
        Id = preset.Id,
        Category = preset.Category,
        Name = preset.Name,
        Content = preset.Content,
        Variables = preset.Variables,
        ToolsConfig = preset.ToolsConfig,
        IsBuiltIn = preset.IsBuiltIn,
        SortOrder = preset.SortOrder,
        CreatedAt = preset.CreatedAt,
        UpdatedAt = preset.UpdatedAt
    };

    public async Task<ApiResponse<List<PromptPresetDto>>> ExportAsync(CancellationToken cancellationToken = default)
    {
        var presets = await _unitOfWork.PromptPresets.GetAllAsync(cancellationToken);
        var userPresets = presets.Where(p => !p.IsBuiltIn).Select(Map).ToList();
        return ApiResponse<List<PromptPresetDto>>.Ok(userPresets);
    }

    public async Task<ApiResponse<int>> ImportAsync(List<ImportPromptPresetItem> items, CancellationToken cancellationToken = default)
    {
        if (items == null || items.Count == 0)
            return ApiResponse<int>.Ok(0);

        var existing = await _unitOfWork.PromptPresets.GetAllAsync(cancellationToken);
        var existingNames = new HashSet<string>(existing.Select(p => p.Name), StringComparer.OrdinalIgnoreCase);
        var count = 0;

        foreach (var item in items)
        {
            if (string.IsNullOrWhiteSpace(item.Name) || string.IsNullOrWhiteSpace(item.Content))
                continue;
            if (existingNames.Contains(item.Name.Trim()))
                continue;

            var preset = new PromptPreset
            {
                Id = Guid.NewGuid(),
                Category = string.IsNullOrWhiteSpace(item.Category) ? "导入" : item.Category.Trim(),
                Name = item.Name.Trim(),
                Content = item.Content.Trim(),
                Variables = item.Variables,
                IsBuiltIn = false,
                SortOrder = existing.Count + count,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow
            };

            await _unitOfWork.PromptPresets.AddAsync(preset, cancellationToken);
            existingNames.Add(item.Name.Trim());
            count++;
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<int>.Ok(count);
    }
}
