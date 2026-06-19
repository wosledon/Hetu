using Hetu.Shared.AI;
using Hetu.Shared.Common;

namespace Hetu.Core.Interfaces;

public interface IMcpService
{
    Task<ApiResponse<List<McpServerDto>>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<ApiResponse<McpServerDto>> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<McpServerDto>> CreateAsync(CreateMcpServerRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse<McpServerDto>> UpdateAsync(Guid id, UpdateMcpServerRequest request, CancellationToken cancellationToken = default);
    Task<ApiResponse> DeleteAsync(Guid id, CancellationToken cancellationToken = default);
    Task<ApiResponse<List<McpToolDto>>> ListToolsAsync(Guid serverId, CancellationToken cancellationToken = default);
    Task<ApiResponse<CallMcpToolResultDto>> CallToolAsync(Guid serverId, CallMcpToolRequest request, CancellationToken cancellationToken = default);
}
