using System.Globalization;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.AI;
using Hetu.Shared.Common;

namespace Hetu.Core.Services;

public class AiModelService : IAiModelService
{
    private readonly IUnitOfWork _unitOfWork;

    public AiModelService(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    public async Task<ApiResponse<List<AiModelDto>>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var models = await _unitOfWork.AiModels.GetAllAsync(cancellationToken);
        return ApiResponse<List<AiModelDto>>.Ok(models.Select(Map).ToList());
    }

    public async Task<ApiResponse<List<AiModelDto>>> GetByProviderAsync(Guid providerId, CancellationToken cancellationToken = default)
    {
        var models = await _unitOfWork.AiModels.GetByProviderAsync(providerId, cancellationToken);
        return ApiResponse<List<AiModelDto>>.Ok(models.Select(Map).ToList());
    }

    public async Task<ApiResponse<AiModelDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var model = await _unitOfWork.AiModels.GetByIdAsync(id, cancellationToken);
        if (model == null) return ApiResponse<AiModelDto>.Fail("模型不存在");
        return ApiResponse<AiModelDto>.Ok(Map(model));
    }

    public async Task<ApiResponse<List<AiModelDto>>> CreateBatchAsync(List<CreateAiModelRequest> requests, CancellationToken cancellationToken = default)
    {
        var valid = requests.Where(r => r != null && r.ProviderId != Guid.Empty && !string.IsNullOrWhiteSpace(r.ModelId)).ToList();
        if (valid.Count == 0) return ApiResponse<List<AiModelDto>>.Ok([]);

        var providerIds = valid.Select(r => r.ProviderId).Distinct().ToArray();
        var purposes = valid.Select(r => NormalizePurpose(r.Purpose)).Distinct().ToArray();

        foreach (var providerId in providerIds)
        {
            if (await _unitOfWork.AiProviders.GetByIdAsync(providerId, cancellationToken) == null)
                return ApiResponse<List<AiModelDto>>.Fail("AI 供应商不存在");
        }

        var existing = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var providerId in providerIds)
        {
            var providerModels = await _unitOfWork.AiModels.GetByProviderAsync(providerId, cancellationToken);
            foreach (var model in providerModels) existing.Add($"{providerId:N}/{model.ModelId}");
        }

        // 批量导入时若该用途下还没有任何模型，自动把首条设为默认，避免用户后续逐个设置
        var needsDefault = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var purpose in purposes)
        {
            if (await _unitOfWork.AiModels.GetDefaultByPurposeAsync(purpose, cancellationToken) == null)
                needsDefault.Add(purpose);
        }

        var created = new List<AiModelDto>();
        var saved = false;
        foreach (var request in valid)
        {
            var purpose = NormalizePurpose(request.Purpose);
            if (!existing.Add($"{request.ProviderId:N}/{request.ModelId.Trim()}"))
                continue;

            var isDefault = request.IsDefault || (needsDefault.Contains(purpose) && created.Count == 0);
            if (isDefault)
            {
                await _unitOfWork.AiModels.ClearDefaultAsync(purpose, cancellationToken);
                needsDefault.Remove(purpose);
            }

            var model = BuildModel(request, isDefault);
            await _unitOfWork.AiModels.AddAsync(model, cancellationToken);
            created.Add(Map(model));
            saved = true;
        }

        if (saved) await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<List<AiModelDto>>.Ok(created);
    }

    public async Task<ApiResponse<AiModelDto>> CreateAsync(CreateAiModelRequest request, CancellationToken cancellationToken = default)
    {
        var provider = await _unitOfWork.AiProviders.GetByIdAsync(request.ProviderId, cancellationToken);
        if (provider == null) return ApiResponse<AiModelDto>.Fail("AI 供应商不存在");

        if (request.IsDefault)
        {
            await _unitOfWork.AiModels.ClearDefaultAsync(request.Purpose, cancellationToken);
        }

        var model = BuildModel(request, request.IsDefault);
        await _unitOfWork.AiModels.AddAsync(model, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<AiModelDto>.Ok(Map(model));
    }

    private static AiModel BuildModel(CreateAiModelRequest request, bool isDefault) => new()
    {
        Id = Guid.NewGuid(),
        ProviderId = request.ProviderId,
        ModelId = request.ModelId.Trim(),
        DisplayName = string.IsNullOrWhiteSpace(request.DisplayName) ? request.ModelId.Trim() : request.DisplayName.Trim(),
        Purpose = NormalizePurpose(request.Purpose),
        IsDefault = isDefault,
        ContextWindow = request.ContextWindow,
        Dimensions = request.Dimensions,
        ReasoningMode = request.ReasoningMode ?? "none",
        ReasoningEffort = NormalizeEffort(request.ReasoningEffort) ?? "medium",
        ReasoningEfforts = NormalizeEfforts(request.ReasoningEfforts),
        ReasoningBudgetTokens = request.ReasoningBudgetTokens,
        SupportsVision = request.SupportsVision,
        SupportsReasoning = request.SupportsReasoning,
        SupportsTools = request.SupportsTools,
        IsVisible = request.IsVisible,
        CreatedAt = DateTimeOffset.UtcNow,
        UpdatedAt = DateTimeOffset.UtcNow
    };

    private static string NormalizePurpose(string? purpose) =>
        string.IsNullOrWhiteSpace(purpose) ? "chat" : purpose.Trim().ToLowerInvariant();

    public async Task<ApiResponse<AiModelDto>> UpdateAsync(Guid id, UpdateAiModelRequest request, CancellationToken cancellationToken = default)
    {
        var model = await _unitOfWork.AiModels.GetByIdAsync(id, cancellationToken);
        if (model == null) return ApiResponse<AiModelDto>.Fail("模型不存在");

        if (request.IsDefault && !model.IsDefault)
        {
            await _unitOfWork.AiModels.ClearDefaultAsync(request.Purpose, cancellationToken);
        }

        model.ModelId = string.IsNullOrWhiteSpace(request.ModelId) ? model.ModelId : request.ModelId.Trim();
        model.DisplayName = string.IsNullOrWhiteSpace(request.DisplayName) ? model.DisplayName : request.DisplayName.Trim();
        model.Purpose = string.IsNullOrWhiteSpace(request.Purpose) ? model.Purpose : request.Purpose.Trim().ToLowerInvariant();
        model.IsDefault = request.IsDefault;
        model.ContextWindow = request.ContextWindow;
        model.Dimensions = request.Dimensions;
        model.ReasoningMode = request.ReasoningMode ?? model.ReasoningMode;
        model.ReasoningEffort = NormalizeEffort(request.ReasoningEffort) ?? model.ReasoningEffort;
        model.ReasoningEfforts = NormalizeEfforts(request.ReasoningEfforts) ?? model.ReasoningEfforts;
        model.ReasoningBudgetTokens = request.ReasoningBudgetTokens ?? model.ReasoningBudgetTokens;
        model.SupportsVision = request.SupportsVision;
        model.SupportsReasoning = request.SupportsReasoning;
        model.SupportsTools = request.SupportsTools;
        model.IsVisible = request.IsVisible;
        model.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.AiModels.UpdateAsync(model, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<AiModelDto>.Ok(Map(model));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var model = await _unitOfWork.AiModels.GetByIdAsync(id, cancellationToken);
        if (model == null) return ApiResponse.Fail("模型不存在");

        await _unitOfWork.AiModels.DeleteAsync(model, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    public async Task<ApiResponse> SetDefaultAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var model = await _unitOfWork.AiModels.GetByIdAsync(id, cancellationToken);
        if (model == null) return ApiResponse.Fail("模型不存在");

        await _unitOfWork.AiModels.ClearDefaultAsync(model.Purpose, cancellationToken);
        model.IsDefault = true;
        model.UpdatedAt = DateTimeOffset.UtcNow;
        await _unitOfWork.AiModels.UpdateAsync(model, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    /// <summary>
    /// 归一化推理强度：允许 off/none/minimal/low/medium/high/xhigh/max、供应商自定义字符串或数字预算。
    /// </summary>
    private static string? NormalizeEffort(string? effort)
    {
        if (string.IsNullOrWhiteSpace(effort)) return null;
        var trimmed = effort.Trim();
        if (int.TryParse(trimmed, out var budget) && budget > 0)
            return budget.ToString(CultureInfo.InvariantCulture);
        return trimmed.ToLowerInvariant();
    }

    /// <summary>
    /// 归一化推理强度档位列表（逗号分隔）：来自模型目录的可选档位，决定选择器的候选项。
    /// 去重、去空、逐个走 NormalizeEffort（数字档位保留为预算 token 数）。
    /// </summary>
    private static string? NormalizeEfforts(string? efforts)
    {
        if (string.IsNullOrWhiteSpace(efforts)) return null;
        var parts = efforts
            .Split([',', '，', ';', '；', '|', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(NormalizeEffort)
            .Where(e => !string.IsNullOrWhiteSpace(e))
            .Select(e => e!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        return parts.Count > 0 ? string.Join(",", parts) : null;
    }

    private static AiModelDto Map(AiModel model) => new()    {
        Id = model.Id,
        ProviderId = model.ProviderId,
        ModelId = model.ModelId,
        DisplayName = model.DisplayName,
        Purpose = model.Purpose,
        IsDefault = model.IsDefault,
        ContextWindow = model.ContextWindow,
        Dimensions = model.Dimensions,
        ReasoningMode = model.ReasoningMode ?? "none",
        ReasoningEffort = NormalizeEffort(model.ReasoningEffort) ?? "medium",
        ReasoningEfforts = model.ReasoningEfforts,
        ReasoningBudgetTokens = model.ReasoningBudgetTokens,
        SupportsVision = model.SupportsVision,
        SupportsReasoning = model.SupportsReasoning,
        SupportsTools = model.SupportsTools,
        IsVisible = model.IsVisible,
        CreatedAt = model.CreatedAt,
        UpdatedAt = model.UpdatedAt
    };
}
