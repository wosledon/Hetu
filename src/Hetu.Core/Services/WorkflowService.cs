using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Utilities;
using Hetu.Shared.Common;
using Hetu.Shared.Workflow;

namespace Hetu.Core.Services;

public class WorkflowService : IWorkflowService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILocalizer _localizer;

    public WorkflowService(IUnitOfWork unitOfWork, ILocalizer localizer)
    {
        _unitOfWork = unitOfWork;
        _localizer = localizer;
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
        if (wf == null) return ApiResponse<WorkflowDto>.Fail(_localizer.T("workflow.notFound"));
        return ApiResponse<WorkflowDto>.Ok(Map(wf));
    }

    public async Task<ApiResponse<WorkflowDto>> CreateAsync(CreateWorkflowRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return ApiResponse<WorkflowDto>.Fail(_localizer.T("workflow.nameRequired"));

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
        if (wf == null) return ApiResponse<WorkflowDto>.Fail(_localizer.T("workflow.notFound"));

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
        if (wf == null) return ApiResponse.Fail(_localizer.T("workflow.notFound"));

        await _unitOfWork.Workflows.DeleteAsync(wf, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    public async Task<ApiResponse<WorkflowDto>> DuplicateAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var wf = await _unitOfWork.Workflows.GetByIdAsync(id, cancellationToken);
        if (wf == null) return ApiResponse<WorkflowDto>.Fail(_localizer.T("workflow.notFound"));

        var clone = new Workflow
        {
            Id = Guid.NewGuid(),
            Name = wf.Name + " " + _localizer.T("workflow.copySuffix"),
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
        if (wf == null) return ApiResponse<ValidationResultDto>.Fail(_localizer.T("workflow.notFound"));

        var result = ValidateGraph(Map(wf), _localizer);
        return ApiResponse<ValidationResultDto>.Ok(result);
    }

    /// <summary>校验工作流图结构：有且仅有一个 Start、至少一个 End、无孤立节点、边端点存在</summary>
    internal static ValidationResultDto ValidateGraph(WorkflowDto dto, ILocalizer localizer)
    {
        var errors = new List<string>();

        if (dto.Nodes.Count == 0)
        {
            return new ValidationResultDto { Valid = false, Errors = new List<string> { localizer.T("workflow.noNodes") } };
        }

        var startNodes = dto.Nodes.Where(n => n.Type == WorkflowNodeTypes.Start).ToList();
        if (startNodes.Count == 0)
            errors.Add(localizer.T("workflow.noStartNode"));
        else if (startNodes.Count > 1)
            errors.Add(localizer.T("workflow.multipleStartNodes", startNodes.Count));

        var endNodes = dto.Nodes.Where(n => n.Type == WorkflowNodeTypes.End).ToList();
        if (endNodes.Count == 0)
            errors.Add(localizer.T("workflow.noEndNode"));

        var nodeIds = dto.Nodes.Select(n => n.Id).ToHashSet();
        foreach (var edge in dto.Edges)
        {
            if (!nodeIds.Contains(edge.Source))
                errors.Add(localizer.T("workflow.edgeSourceMissing", edge.Id, edge.Source));
            if (!nodeIds.Contains(edge.Target))
                errors.Add(localizer.T("workflow.edgeTargetMissing", edge.Id, edge.Target));
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
            errors.Add(localizer.T("workflow.orphanNode", orphan.Label, orphan.Id));

        // Agent 节点应有 AgentId（指向智能体页面的 PromptPreset）
        var noAgent = dto.Nodes.Where(n => n.Type == WorkflowNodeTypes.Agent && n.AgentId == null).ToList();
        foreach (var n in noAgent)
            errors.Add(localizer.T("workflow.agentNotConfigured", n.Label, n.Id));

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
        try { return JsonSerializer.Deserialize<T>(json, JsonDefaults.CaseInsensitive); }
        catch { return default; }
    }
}
