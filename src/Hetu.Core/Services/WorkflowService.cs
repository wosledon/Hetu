using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Hetu.Shared.Workflow;

namespace Hetu.Core.Services;

public class WorkflowService : IWorkflowService
{
    private readonly IUnitOfWork _unitOfWork;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public WorkflowService(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    public async Task<ApiResponse<List<WorkflowDto>>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var workflows = await _unitOfWork.Workflows.GetAllAsync(cancellationToken);
        return ApiResponse<List<WorkflowDto>>.Ok(
            workflows.OrderBy(w => w.SortOrder).ThenByDescending(w => w.UpdatedAt).Select(Map).ToList());
    }

    public async Task<ApiResponse<WorkflowDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var wf = await _unitOfWork.Workflows.GetByIdAsync(id, cancellationToken);
        if (wf == null) return ApiResponse<WorkflowDto>.Fail("工作流不存在");
        return ApiResponse<WorkflowDto>.Ok(Map(wf));
    }

    public async Task<ApiResponse<WorkflowDto>> CreateAsync(CreateWorkflowRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return ApiResponse<WorkflowDto>.Fail("工作流名称不能为空");

        var wf = new Workflow
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            Description = request.Description?.Trim() ?? string.Empty,
            Nodes = JsonSerializer.Serialize(request.Nodes ?? new List<NodeDto>()),
            Edges = JsonSerializer.Serialize(request.Edges ?? new List<EdgeDto>()),
            InputSchema = request.InputSchema,
            Variables = request.Variables,
            Version = 1,
            IsEnabled = request.IsEnabled,
            SortOrder = request.SortOrder,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.Workflows.AddAsync(wf, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<WorkflowDto>.Ok(Map(wf));
    }

    public async Task<ApiResponse<WorkflowDto>> UpdateAsync(Guid id, UpdateWorkflowRequest request, CancellationToken cancellationToken = default)
    {
        var wf = await _unitOfWork.Workflows.GetByIdAsync(id, cancellationToken);
        if (wf == null) return ApiResponse<WorkflowDto>.Fail("工作流不存在");

        wf.Name = string.IsNullOrWhiteSpace(request.Name) ? wf.Name : request.Name.Trim();
        wf.Description = request.Description?.Trim() ?? wf.Description;
        wf.Nodes = JsonSerializer.Serialize(request.Nodes ?? new List<NodeDto>());
        wf.Edges = JsonSerializer.Serialize(request.Edges ?? new List<EdgeDto>());
        wf.InputSchema = request.InputSchema;
        wf.Variables = request.Variables;
        wf.IsEnabled = request.IsEnabled;
        wf.SortOrder = request.SortOrder;
        wf.Version++;
        wf.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.Workflows.UpdateAsync(wf, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<WorkflowDto>.Ok(Map(wf));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var wf = await _unitOfWork.Workflows.GetByIdAsync(id, cancellationToken);
        if (wf == null) return ApiResponse.Fail("工作流不存在");

        await _unitOfWork.Workflows.DeleteAsync(wf, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    public async Task<ApiResponse<WorkflowDto>> DuplicateAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var wf = await _unitOfWork.Workflows.GetByIdAsync(id, cancellationToken);
        if (wf == null) return ApiResponse<WorkflowDto>.Fail("工作流不存在");

        var clone = new Workflow
        {
            Id = Guid.NewGuid(),
            Name = wf.Name + " 副本",
            Description = wf.Description,
            Nodes = wf.Nodes,
            Edges = wf.Edges,
            InputSchema = wf.InputSchema,
            Variables = wf.Variables,
            Version = 1,
            IsEnabled = wf.IsEnabled,
            SortOrder = wf.SortOrder,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.Workflows.AddAsync(clone, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<WorkflowDto>.Ok(Map(clone));
    }

    public async Task<ApiResponse<ValidationResultDto>> ValidateAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var wf = await _unitOfWork.Workflows.GetByIdAsync(id, cancellationToken);
        if (wf == null) return ApiResponse<ValidationResultDto>.Fail("工作流不存在");

        var result = ValidateGraph(Map(wf));
        return ApiResponse<ValidationResultDto>.Ok(result);
    }

    /// <summary>校验工作流图结构：有且仅有一个 Start、至少一个 End、无孤立节点、边端点存在</summary>
    internal static ValidationResultDto ValidateGraph(WorkflowDto dto)
    {
        var errors = new List<string>();

        if (dto.Nodes.Count == 0)
        {
            return new ValidationResultDto { Valid = false, Errors = new List<string> { "工作流没有任何节点" } };
        }

        var startNodes = dto.Nodes.Where(n => n.Type == WorkflowNodeTypes.Start).ToList();
        if (startNodes.Count == 0)
            errors.Add("工作流缺少 Start 起始节点");
        else if (startNodes.Count > 1)
            errors.Add($"工作流有 {startNodes.Count} 个 Start 节点，只能有 1 个");

        var endNodes = dto.Nodes.Where(n => n.Type == WorkflowNodeTypes.End).ToList();
        if (endNodes.Count == 0)
            errors.Add("工作流缺少 End 结束节点");

        var nodeIds = dto.Nodes.Select(n => n.Id).ToHashSet();
        foreach (var edge in dto.Edges)
        {
            if (!nodeIds.Contains(edge.Source))
                errors.Add($"边 {edge.Id} 的源节点 {edge.Source} 不存在");
            if (!nodeIds.Contains(edge.Target))
                errors.Add($"边 {edge.Id} 的目标节点 {edge.Target} 不存在");
        }

        // 检查孤立节点（除 Start/End 外应有至少一条入边或出边）
        var connected = new HashSet<string>();
        foreach (var edge in dto.Edges)
        {
            connected.Add(edge.Source);
            connected.Add(edge.Target);
        }
        var orphans = dto.Nodes.Where(n => !connected.Contains(n.Id) && n.Type != WorkflowNodeTypes.Start).ToList();
        foreach (var orphan in orphans)
            errors.Add($"节点 {orphan.Label}({orphan.Id}) 未连接到任何边");

        // Agent 节点应有 AgentId（指向智能体页面的 PromptPreset）
        var noAgent = dto.Nodes.Where(n => n.Type == WorkflowNodeTypes.Agent && n.AgentId == null).ToList();
        foreach (var n in noAgent)
            errors.Add($"Agent 节点 {n.Label}({n.Id}) 未配置智能体");

        return new ValidationResultDto { Valid = errors.Count == 0, Errors = errors };
    }

    private static WorkflowDto Map(Workflow w) => new()
    {
        Id = w.Id,
        Name = w.Name,
        Description = w.Description,
        Nodes = Deserialize<List<NodeDto>>(w.Nodes) ?? new(),
        Edges = Deserialize<List<EdgeDto>>(w.Edges) ?? new(),
        InputSchema = w.InputSchema,
        Variables = w.Variables,
        Version = w.Version,
        IsEnabled = w.IsEnabled,
        SortOrder = w.SortOrder,
        CreatedAt = w.CreatedAt,
        UpdatedAt = w.UpdatedAt
    };

    internal static T? Deserialize<T>(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return default;
        try { return JsonSerializer.Deserialize<T>(json, JsonOptions); }
        catch { return default; }
    }
}
