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

    public async Task<ApiResponse<AiModelDto>> CreateAsync(CreateAiModelRequest request, CancellationToken cancellationToken = default)
    {
        var provider = await _unitOfWork.AiProviders.GetByIdAsync(request.ProviderId, cancellationToken);
        if (provider == null) return ApiResponse<AiModelDto>.Fail("AI 供应商不存在");

        if (request.IsDefault)
        {
            await _unitOfWork.AiModels.ClearDefaultAsync(request.Purpose, cancellationToken);
        }

        var model = new AiModel
        {
            Id = Guid.NewGuid(),
            ProviderId = request.ProviderId,
            ModelId = request.ModelId.Trim(),
            DisplayName = string.IsNullOrWhiteSpace(request.DisplayName) ? request.ModelId.Trim() : request.DisplayName.Trim(),
            Purpose = string.IsNullOrWhiteSpace(request.Purpose) ? "chat" : request.Purpose.Trim().ToLowerInvariant(),
            IsDefault = request.IsDefault,
            ContextWindow = request.ContextWindow,
            Dimensions = request.Dimensions,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.AiModels.AddAsync(model, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<AiModelDto>.Ok(Map(model));
    }

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

    private static AiModelDto Map(AiModel model) => new()
    {
        Id = model.Id,
        ProviderId = model.ProviderId,
        ModelId = model.ModelId,
        DisplayName = model.DisplayName,
        Purpose = model.Purpose,
        IsDefault = model.IsDefault,
        ContextWindow = model.ContextWindow,
        Dimensions = model.Dimensions,
        CreatedAt = model.CreatedAt,
        UpdatedAt = model.UpdatedAt
    };
}
