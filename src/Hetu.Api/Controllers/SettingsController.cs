using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Shared.Common;
using Hetu.Shared.Settings;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Npgsql;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class SettingsController : ControllerBase
{
    private readonly IAppSettingService _appSettingService;
    private readonly CompressionPipelineService _compressionService;

    public SettingsController(IAppSettingService appSettingService, CompressionPipelineService compressionService)
    {
        _appSettingService = appSettingService;
        _compressionService = compressionService;
    }

    [HttpGet]
    public Task<ApiResponse<AppSettingsSnapshotDto>> GetSnapshot(CancellationToken cancellationToken)
        => _appSettingService.GetSnapshotAsync(cancellationToken);

    [HttpGet("{key}")]
    public Task<ApiResponse<AppSettingDto?>> Get(string key, CancellationToken cancellationToken)
        => _appSettingService.GetAsync(key, cancellationToken);

    [HttpPut]
    public Task<ApiResponse> Set([FromBody] UpdateAppSettingRequest request, CancellationToken cancellationToken)
        => _appSettingService.SetAsync(request, cancellationToken);

    [HttpGet("compression")]
    public async Task<ApiResponse<CompressionPipelineDto>> GetCompressionConfig(CancellationToken ct)
    {
        var config = await _compressionService.GetConfigAsync(ct);
        return ApiResponse<CompressionPipelineDto>.Ok(config);
    }

    [HttpPut("compression")]
    public async Task<ApiResponse> SetCompressionConfig([FromBody] CompressionPipelineDto config, CancellationToken ct)
    {
        await _compressionService.SaveConfigAsync(config, ct);
        return ApiResponse.Ok();
    }

    [HttpPost("test-database")]
    public async Task<ApiResponse<DatabaseConnectionTestResult>> TestDatabase([FromBody] DatabaseConnectionRequest request, CancellationToken cancellationToken)
    {
        var provider = request.Provider.ToLowerInvariant();
        try
        {
            if (provider == "postgresql" || provider == "postgres")
            {
                await using var connection = new NpgsqlConnection(request.ConnectionString);
                await connection.OpenAsync(cancellationToken);
                await using var command = new NpgsqlCommand("SELECT 1 FROM pg_extension WHERE extname = 'vector'", connection);
                var hasVector = await command.ExecuteScalarAsync(cancellationToken) != null;
                return ApiResponse<DatabaseConnectionTestResult>.Ok(new DatabaseConnectionTestResult
                {
                    CanConnect = true,
                    VectorExtensionAvailable = hasVector,
                    Message = hasVector ? "PostgreSQL 连接成功，已启用 pgvector" : "PostgreSQL 连接成功，但未启用 pgvector"
                });
            }
            else
            {
                await using var connection = new SqliteConnection(request.ConnectionString);
                await connection.OpenAsync(cancellationToken);
                return ApiResponse<DatabaseConnectionTestResult>.Ok(new DatabaseConnectionTestResult
                {
                    CanConnect = true,
                    VectorExtensionAvailable = false,
                    Message = "SQLite 连接成功"
                });
            }
        }
        catch (Exception ex)
        {
            return ApiResponse<DatabaseConnectionTestResult>.Ok(new DatabaseConnectionTestResult
            {
                CanConnect = false,
                VectorExtensionAvailable = false,
                Message = $"连接失败：{ex.Message}"
            });
        }
    }
}
