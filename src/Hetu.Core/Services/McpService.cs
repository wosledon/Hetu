using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.AI;
using Hetu.Shared.Common;

namespace Hetu.Core.Services;

public class McpService : IMcpService
{
    private readonly IUnitOfWork _unitOfWork;

    public McpService(IUnitOfWork unitOfWork)
    {
        _unitOfWork = unitOfWork;
    }

    public async Task<ApiResponse<List<McpServerDto>>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var servers = await _unitOfWork.McpServers.GetAllAsync(cancellationToken);
        return ApiResponse<List<McpServerDto>>.Ok(
            servers.OrderBy(s => s.SortOrder).Select(Map).ToList());
    }

    public async Task<ApiResponse<McpServerDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var server = await _unitOfWork.McpServers.GetByIdAsync(id, cancellationToken);
        if (server == null) return ApiResponse<McpServerDto>.Fail("MCP Server 不存在");
        return ApiResponse<McpServerDto>.Ok(Map(server));
    }

    public async Task<ApiResponse<McpServerDto>> CreateAsync(CreateMcpServerRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.ConnectionConfig))
            return ApiResponse<McpServerDto>.Fail("名称和连接配置不能为空");

        var server = new McpServer
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            Description = request.Description?.Trim() ?? string.Empty,
            Type = request.Type.ToLowerInvariant() == "sse" ? "sse" : "stdio",
            ConnectionConfig = request.ConnectionConfig.Trim(),
            IsEnabled = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow
        };

        await _unitOfWork.McpServers.AddAsync(server, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<McpServerDto>.Ok(Map(server));
    }

    public async Task<ApiResponse<McpServerDto>> UpdateAsync(Guid id, UpdateMcpServerRequest request, CancellationToken cancellationToken = default)
    {
        var server = await _unitOfWork.McpServers.GetByIdAsync(id, cancellationToken);
        if (server == null) return ApiResponse<McpServerDto>.Fail("MCP Server 不存在");

        server.Name = string.IsNullOrWhiteSpace(request.Name) ? server.Name : request.Name.Trim();
        server.Description = request.Description?.Trim() ?? server.Description;
        server.Type = request.Type.ToLowerInvariant() == "sse" ? "sse" : "stdio";
        server.ConnectionConfig = string.IsNullOrWhiteSpace(request.ConnectionConfig) ? server.ConnectionConfig : request.ConnectionConfig.Trim();
        server.IsEnabled = request.IsEnabled;
        server.SortOrder = request.SortOrder;
        server.UpdatedAt = DateTimeOffset.UtcNow;

        await _unitOfWork.McpServers.UpdateAsync(server, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse<McpServerDto>.Ok(Map(server));
    }

    public async Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var server = await _unitOfWork.McpServers.GetByIdAsync(id, cancellationToken);
        if (server == null) return ApiResponse.Fail("MCP Server 不存在");

        await _unitOfWork.McpServers.DeleteAsync(server, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    public async Task<ApiResponse<List<McpToolDto>>> ListToolsAsync(Guid serverId, CancellationToken cancellationToken = default)
    {
        var server = await _unitOfWork.McpServers.GetByIdAsync(serverId, cancellationToken);
        if (server == null) return ApiResponse<List<McpToolDto>>.Fail("MCP Server 不存在");
        if (!server.IsEnabled) return ApiResponse<List<McpToolDto>>.Fail("MCP Server 已禁用");
        if (server.Type != "stdio") return ApiResponse<List<McpToolDto>>.Fail("暂仅支持 stdio 类型 MCP Server");

        try
        {
            using var client = new StdioMcpClient(server.ConnectionConfig);
            var tools = await client.ListToolsAsync(cancellationToken);
            return ApiResponse<List<McpToolDto>>.Ok(tools);
        }
        catch (Exception ex)
        {
            return ApiResponse<List<McpToolDto>>.Fail($"获取工具列表失败：{ex.Message}");
        }
    }

    public async Task<ApiResponse<CallMcpToolResultDto>> CallToolAsync(Guid serverId, CallMcpToolRequest request, CancellationToken cancellationToken = default)
    {
        var server = await _unitOfWork.McpServers.GetByIdAsync(serverId, cancellationToken);
        if (server == null) return ApiResponse<CallMcpToolResultDto>.Fail("MCP Server 不存在");
        if (!server.IsEnabled) return ApiResponse<CallMcpToolResultDto>.Fail("MCP Server 已禁用");
        if (server.Type != "stdio") return ApiResponse<CallMcpToolResultDto>.Fail("暂仅支持 stdio 类型 MCP Server");

        try
        {
            using var client = new StdioMcpClient(server.ConnectionConfig);
            var result = await client.CallToolAsync(request.ToolName, request.Arguments, cancellationToken);
            return ApiResponse<CallMcpToolResultDto>.Ok(result);
        }
        catch (Exception ex)
        {
            return ApiResponse<CallMcpToolResultDto>.Fail($"调用工具失败：{ex.Message}");
        }
    }

    private static McpServerDto Map(McpServer server) => new()
    {
        Id = server.Id,
        Name = server.Name,
        Description = server.Description,
        Type = server.Type,
        ConnectionConfig = server.ConnectionConfig,
        IsEnabled = server.IsEnabled,
        SortOrder = server.SortOrder,
        CreatedAt = server.CreatedAt,
        UpdatedAt = server.UpdatedAt
    };
}
