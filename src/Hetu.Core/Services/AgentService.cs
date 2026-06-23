using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.AI;
using Hetu.Shared.Common;

namespace Hetu.Core.Services;

public class AgentService : IAgentService
{
    private readonly IUnitOfWork _unitOfWork;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public AgentService(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    public async Task<ApiResponse<List<AgentDto>>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var agents = await _unitOfWork.Agents.GetAllAsync(cancellationToken);
        return ApiResponse<List<AgentDto>>.Ok(
            agents.OrderBy(a => a.Category).ThenBy(a => a.SortOrder).Select(Map).ToList());
    }

    public async Task<ApiResponse<AgentDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var agent = await _unitOfWork.Agents.GetByIdAsync(id, cancellationToken);
        if (agent == null) return ApiResponse<AgentDto>.Fail("Agent 不存在");
        return ApiResponse<AgentDto>.Ok(Map(agent));
    }

    public async Task<ApiResponse<AgentDto>> CreateAsync(CreateAgentRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.SystemPrompt))
            return ApiResponse<AgentDto>.Fail("名称和系统提示词不能为空");

        var agent = new Agent
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            Description = request.Description?.Trim() ?? string.Empty,
            Category = string.IsNullOrWhiteSpace(request.Category) ? "自定义" : request.Category.Trim(),
            SystemPrompt = request.SystemPrompt,
            ModelId = request.ModelId,
            ToolNames = SerializeList(request.ToolNames),
            McpServerIds = SerializeList(request.McpServerIds?.Select(g => g.ToString()).ToList()),
            SkillIds = SerializeList(request.SkillIds?.Select(g => g.ToString()).ToList()),
            ToolApprovals = SerializeDict(request.ToolApprovals),
            MaxToolCallsPerTurn = request.MaxToolCallsPerTurn,
            MaxAgentIterations = request.MaxAgentIterations,
            IsEnabled = request.IsEnabled,
            SortOrder = request.SortOrder,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.Agents.AddAsync(agent, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<AgentDto>.Ok(Map(agent));
    }

    public async Task<ApiResponse<AgentDto>> UpdateAsync(Guid id, UpdateAgentRequest request, CancellationToken cancellationToken = default)
    {
        var agent = await _unitOfWork.Agents.GetByIdAsync(id, cancellationToken);
        if (agent == null) return ApiResponse<AgentDto>.Fail("Agent 不存在");

        agent.Name = string.IsNullOrWhiteSpace(request.Name) ? agent.Name : request.Name.Trim();
        agent.Description = request.Description?.Trim() ?? agent.Description;
        agent.Category = string.IsNullOrWhiteSpace(request.Category) ? agent.Category : request.Category.Trim();
        agent.SystemPrompt = string.IsNullOrWhiteSpace(request.SystemPrompt) ? agent.SystemPrompt : request.SystemPrompt;
        agent.ModelId = request.ModelId;
        agent.ToolNames = SerializeList(request.ToolNames);
        agent.McpServerIds = SerializeList(request.McpServerIds?.Select(g => g.ToString()).ToList());
        agent.SkillIds = SerializeList(request.SkillIds?.Select(g => g.ToString()).ToList());
        agent.ToolApprovals = SerializeDict(request.ToolApprovals);
        agent.MaxToolCallsPerTurn = request.MaxToolCallsPerTurn;
        agent.MaxAgentIterations = request.MaxAgentIterations;
        agent.IsEnabled = request.IsEnabled;
        agent.SortOrder = request.SortOrder;
        agent.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.Agents.UpdateAsync(agent, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<AgentDto>.Ok(Map(agent));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var agent = await _unitOfWork.Agents.GetByIdAsync(id, cancellationToken);
        if (agent == null) return ApiResponse.Fail("Agent 不存在");

        await _unitOfWork.Agents.DeleteAsync(agent, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    private static AgentDto Map(Agent a) => new()
    {
        Id = a.Id,
        Name = a.Name,
        Description = a.Description,
        Category = a.Category,
        SystemPrompt = a.SystemPrompt,
        ModelId = a.ModelId,
        ToolNames = DeserializeList(a.ToolNames),
        McpServerIds = DeserializeGuidList(a.McpServerIds),
        SkillIds = DeserializeGuidList(a.SkillIds),
        ToolApprovals = DeserializeDict(a.ToolApprovals),
        MaxToolCallsPerTurn = a.MaxToolCallsPerTurn,
        MaxAgentIterations = a.MaxAgentIterations,
        IsEnabled = a.IsEnabled,
        SortOrder = a.SortOrder,
        CreatedAt = a.CreatedAt,
        UpdatedAt = a.UpdatedAt
    };

    internal static string? SerializeList(List<string>? list)
        => list is null || list.Count == 0 ? null : JsonSerializer.Serialize(list);

    internal static string? SerializeDict(Dictionary<string, string>? dict)
        => dict is null || dict.Count == 0 ? null : JsonSerializer.Serialize(dict);

    internal static List<string> DeserializeList(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();
        try { return JsonSerializer.Deserialize<List<string>>(json, JsonOptions) ?? new(); }
        catch { return new(); }
    }

    internal static List<Guid> DeserializeGuidList(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();
        try
        {
            var strs = JsonSerializer.Deserialize<List<string>>(json, JsonOptions) ?? new();
            return strs.Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).ToList();
        }
        catch { return new(); }
    }

    internal static Dictionary<string, string> DeserializeDict(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();
        try { return JsonSerializer.Deserialize<Dictionary<string, string>>(json, JsonOptions) ?? new(); }
        catch { return new(); }
    }
}
