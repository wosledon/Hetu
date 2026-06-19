using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.AI;
using Hetu.Shared.Common;

namespace Hetu.Core.Services;

public class SkillService : ISkillService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILLMProviderFactory _llmProviderFactory;

    public SkillService(IUnitOfWork unitOfWork, ILLMProviderFactory llmProviderFactory)
    {
        _unitOfWork = unitOfWork;
        _llmProviderFactory = llmProviderFactory;
    }

    public async Task<ApiResponse<List<SkillDto>>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var skills = await _unitOfWork.Skills.GetAllAsync(cancellationToken);
        return ApiResponse<List<SkillDto>>.Ok(
            skills.OrderBy(s => s.Category).ThenBy(s => s.SortOrder).Select(Map).ToList());
    }

    public async Task<ApiResponse<SkillDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var skill = await _unitOfWork.Skills.GetByIdAsync(id, cancellationToken);
        if (skill == null) return ApiResponse<SkillDto>.Fail("Skill 不存在");
        return ApiResponse<SkillDto>.Ok(Map(skill));
    }

    public async Task<ApiResponse<SkillDto>> CreateAsync(CreateSkillRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.Description))
            return ApiResponse<SkillDto>.Fail("名称和描述不能为空");

        var skill = new Skill
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            Description = request.Description.Trim(),
            Category = string.IsNullOrWhiteSpace(request.Category) ? "自定义" : request.Category.Trim(),
            Config = request.Config,
            IsBuiltIn = false,
            IsEnabled = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.Skills.AddAsync(skill, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<SkillDto>.Ok(Map(skill));
    }

    public async Task<ApiResponse<SkillDto>> UpdateAsync(Guid id, UpdateSkillRequest request, CancellationToken cancellationToken = default)
    {
        var skill = await _unitOfWork.Skills.GetByIdAsync(id, cancellationToken);
        if (skill == null) return ApiResponse<SkillDto>.Fail("Skill 不存在");
        if (skill.IsBuiltIn) return ApiResponse<SkillDto>.Fail("内置 Skill 不能编辑");

        skill.Name = string.IsNullOrWhiteSpace(request.Name) ? skill.Name : request.Name.Trim();
        skill.Description = string.IsNullOrWhiteSpace(request.Description) ? skill.Description : request.Description.Trim();
        skill.Category = string.IsNullOrWhiteSpace(request.Category) ? skill.Category : request.Category.Trim();
        skill.IsEnabled = request.IsEnabled;
        skill.Config = request.Config;
        skill.SortOrder = request.SortOrder;
        skill.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.Skills.UpdateAsync(skill, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<SkillDto>.Ok(Map(skill));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var skill = await _unitOfWork.Skills.GetByIdAsync(id, cancellationToken);
        if (skill == null) return ApiResponse.Fail("Skill 不存在");
        if (skill.IsBuiltIn) return ApiResponse.Fail("内置 Skill 不能删除");

        await _unitOfWork.Skills.DeleteAsync(skill, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    public async Task<ApiResponse<string>> InvokeAsync(string nameOrId, InvokeSkillRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(nameOrId))
            return ApiResponse<string>.Fail("Skill 名称或 ID 不能为空");

        Skill? skill = null;
        if (Guid.TryParse(nameOrId, out var id))
        {
            skill = await _unitOfWork.Skills.GetByIdAsync(id, cancellationToken);
        }

        if (skill == null)
        {
            skill = (await _unitOfWork.Skills.FindAsync(s => s.Name == nameOrId, cancellationToken)).FirstOrDefault();
        }

        if (skill == null) return ApiResponse<string>.Fail($"Skill '{nameOrId}' 不存在");
        if (!skill.IsEnabled) return ApiResponse<string>.Fail($"Skill '{skill.Name}' 已禁用");

        return await InvokeSkillAsync(skill, request.Input, cancellationToken);
    }

    public async Task<ApiResponse<string>> InvokeByIdAsync(Guid id, InvokeSkillRequest request, CancellationToken cancellationToken = default)
    {
        var skill = await _unitOfWork.Skills.GetByIdAsync(id, cancellationToken);
        if (skill == null) return ApiResponse<string>.Fail("Skill 不存在");
        if (!skill.IsEnabled) return ApiResponse<string>.Fail($"Skill '{skill.Name}' 已禁用");

        return await InvokeSkillAsync(skill, request.Input, cancellationToken);
    }

    private async Task<ApiResponse<string>> InvokeSkillAsync(Skill skill, string input, CancellationToken cancellationToken)
    {
        var config = ParseConfig(skill.Config);
        var promptTemplate = config?.PromptTemplate ?? "{{input}}";
        var systemPrompt = config?.SystemPrompt ?? "你是智能助手。";

        var prompt = promptTemplate.Replace("{{input}}", input);

        var provider = await _llmProviderFactory.CreateChatProviderAsync(cancellationToken);
        if (provider == null) return ApiResponse<string>.Fail("未找到可用的对话模型");

        var result = await provider.ChatAsync(
            [new LlmChatMessage { Role = "user", Content = prompt }],
            new ChatOptions { ModelId = string.Empty, SystemPrompt = systemPrompt },
            cancellationToken);

        return ApiResponse<string>.Ok(result);
    }

    private static SkillConfig? ParseConfig(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            return JsonSerializer.Deserialize<SkillConfig>(json);
        }
        catch
        {
            return null;
        }
    }

    private static SkillDto Map(Skill skill) => new()
    {
        Id = skill.Id,
        Name = skill.Name,
        Description = skill.Description,
        Category = skill.Category,
        IsBuiltIn = skill.IsBuiltIn,
        IsEnabled = skill.IsEnabled,
        Config = skill.Config,
        SortOrder = skill.SortOrder,
        CreatedAt = skill.CreatedAt,
        UpdatedAt = skill.UpdatedAt
    };

    private class SkillConfig
    {
        public string PromptTemplate { get; set; } = "{{input}}";
        public string SystemPrompt { get; set; } = string.Empty;
    }
}
