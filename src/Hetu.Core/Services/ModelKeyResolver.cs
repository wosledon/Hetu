using Hetu.Core.Entities;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services;

/// <summary>
/// 解析 "providerId:modelId" 复合键为供应商+模型，区分不同供应商下的同名模型。
/// </summary>
public class ModelKeyResolver
{
    private readonly IUnitOfWork _unitOfWork;

    public ModelKeyResolver(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    /// <summary>构造复合键</summary>
    public static string Compose(Guid providerId, string modelId) => $"{providerId}:{modelId}";

    /// <summary>解析复合键。返回 null 表示格式非法或模型/供应商不存在。</summary>
    public async Task<(AiProvider provider, AiModel model)?> ResolveAsync(string? modelKey, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(modelKey)) return null;
        var idx = modelKey.IndexOf(':');
        if (idx <= 0) return null;
        if (!Guid.TryParse(modelKey[..idx], out var providerId)) return null;
        var modelId = modelKey[(idx + 1)..];
        if (string.IsNullOrWhiteSpace(modelId)) return null;

        var provider = await _unitOfWork.AiProviders.GetByIdAsync(providerId, ct);
        if (provider == null || !provider.IsEnabled) return null;
        var model = provider.Models.FirstOrDefault(m => m.ModelId == modelId);
        if (model == null) return null;
        return (provider, model);
    }
}
