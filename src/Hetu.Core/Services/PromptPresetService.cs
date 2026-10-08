using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;

namespace Hetu.Core.Services;

public class PromptPresetService : IPromptPresetService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILocalPromptPresetService _localPromptPresetService;

    public PromptPresetService(IUnitOfWork unitOfWork, ILocalPromptPresetService localPromptPresetService)
    {
        _unitOfWork = unitOfWork;
        _localPromptPresetService = localPromptPresetService;
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
            AgentType = NormalizeAgentType(request.AgentType),
            SubAgentIds = request.SubAgentIds,
            ModelId = request.ModelId,
            ReasoningEffort = request.ReasoningEffort,
            SkillIds = request.SkillIds,
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
        preset.AgentType = NormalizeAgentType(request.AgentType);
        preset.SubAgentIds = request.SubAgentIds;
        preset.ModelId = request.ModelId;
        preset.ReasoningEffort = request.ReasoningEffort;
        preset.SkillIds = request.SkillIds;
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

    public async Task<ApiResponse<PromptPresetDto>> CreateProfessionalFromAsync(Guid sourceId, CancellationToken cancellationToken = default)
    {
        var source = await _unitOfWork.PromptPresets.GetByIdAsync(sourceId, cancellationToken);
        if (source == null) return ApiResponse<PromptPresetDto>.Fail("源智能体不存在");
        if (string.Equals(source.AgentType, "Professional", StringComparison.OrdinalIgnoreCase))
            return ApiResponse<PromptPresetDto>.Fail("源智能体已是专业智能体");

        var preset = new PromptPreset
        {
            Id = Guid.NewGuid(),
            Category = source.Category,
            Name = await EnsureUniqueNameAsync(source.Name + " 专业版", cancellationToken),
            Content = source.Content,
            Variables = source.Variables,
            ToolsConfig = source.ToolsConfig,
            IsBuiltIn = false,
            AgentType = "Professional",
            SortOrder = source.SortOrder,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.PromptPresets.AddAsync(preset, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<PromptPresetDto>.Ok(Map(preset));
    }

    /// <summary>
    /// 从本地（目录扫描得到）通用智能体创建专业智能体：本地智能体不可编辑，
    /// 需要落库为数据库中的专业智能体草稿后再继续配置。
    /// </summary>
    public async Task<ApiResponse<PromptPresetDto>> CreateProfessionalFromLocalAsync(string localId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(localId))
            return ApiResponse<PromptPresetDto>.Fail("本地智能体 ID 不能为空");

        var localResult = await _localPromptPresetService.ScanAllAsync(cancellationToken);
        var local = localResult.Data?.FirstOrDefault(p => p.Id == localId);
        if (local == null) return ApiResponse<PromptPresetDto>.Fail("本地智能体不存在");

        var preset = new PromptPreset
        {
            Id = Guid.NewGuid(),
            Category = string.IsNullOrWhiteSpace(local.Category) ? "本地" : local.Category,
            Name = await EnsureUniqueNameAsync(local.Name + " 专业版", cancellationToken),
            Content = local.Content,
            Variables = local.Variables,
            ToolsConfig = local.ToolsConfig,
            IsBuiltIn = false,
            AgentType = "Professional",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.PromptPresets.AddAsync(preset, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<PromptPresetDto>.Ok(Map(preset));
    }

    private async Task<string> EnsureUniqueNameAsync(string name, CancellationToken cancellationToken)
    {
        var existing = await _unitOfWork.PromptPresets.GetAllAsync(cancellationToken);
        var names = new HashSet<string>(existing.Select(p => p.Name), StringComparer.OrdinalIgnoreCase);
        if (names.Add(name)) return name;
        for (var i = 2; ; i++)
        {
            var candidate = $"{name} {i}";
            if (names.Add(candidate)) return candidate;
        }
    }

    private static string NormalizeAgentType(string? agentType)
        => string.Equals(agentType, "Professional", StringComparison.OrdinalIgnoreCase) ? "Professional" : "General";

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
        AgentType = NormalizeAgentType(preset.AgentType),
        SubAgentIds = preset.SubAgentIds,
        ModelId = preset.ModelId,
        ReasoningEffort = preset.ReasoningEffort,
        SkillIds = preset.SkillIds,
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
