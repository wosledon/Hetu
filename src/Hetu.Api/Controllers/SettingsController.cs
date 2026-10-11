using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Infrastructure.Data;
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
    private readonly IMemoryService _memoryService;
    private readonly Hetu.Core.Services.Work.WorktreeCleanupService _worktreeCleanup;
    private readonly ILocalizer _localizer;

    public SettingsController(
        IAppSettingService appSettingService,
        CompressionPipelineService compressionService,
        IMemoryService memoryService,
        Hetu.Core.Services.Work.WorktreeCleanupService worktreeCleanup,
        ILocalizer localizer)
    {
        _appSettingService = appSettingService;
        _compressionService = compressionService;
        _memoryService = memoryService;
        _worktreeCleanup = worktreeCleanup;
        _localizer = localizer;
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

    /// <summary>Dream（记忆巩固）配置：自动开关、周期与巩固阈值</summary>
    [HttpGet("dream")]
    public async Task<ApiResponse<DreamConfigDto>> GetDreamConfig(CancellationToken ct)
        => ApiResponse<DreamConfigDto>.Ok(await _memoryService.GetDreamConfigAsync(ct));

    /// <summary>Code 工作树自动清理配置：开关、周期、空闲阈值、是否删分支</summary>
    [HttpGet("worktree-cleanup")]
    public async Task<ApiResponse<WorktreeCleanupConfigDto>> GetWorktreeCleanupConfig(CancellationToken ct)
        => ApiResponse<WorktreeCleanupConfigDto>.Ok(await _worktreeCleanup.GetConfigAsync(ct));

    [HttpPut("worktree-cleanup")]
    public async Task<ApiResponse> SetWorktreeCleanupConfig([FromBody] WorktreeCleanupConfigDto config, CancellationToken ct)
    {
        await _worktreeCleanup.SaveConfigAsync(config ?? new WorktreeCleanupConfigDto(), ct);
        return ApiResponse.Ok();
    }

    /// <summary>立即检查并清理；默认 force（忽略自动开关与空闲阈值，仍要求工作树干净且已完成）</summary>
    [HttpPost("worktree-cleanup/run")]
    public async Task<ApiResponse<WorktreeCleanupResultDto>> RunWorktreeCleanup([FromQuery] bool force, CancellationToken ct)
    {
        var result = await _worktreeCleanup.CleanupAllAsync(force: force, ct);
        return ApiResponse<WorktreeCleanupResultDto>.Ok(new WorktreeCleanupResultDto
        {
            Removed = result.Removed,
            Checked = result.Checked,
            Kept = result.Kept
        });
    }

    [HttpPut("dream")]
    public async Task<ApiResponse> SetDreamConfig([FromBody] DreamConfigDto config, CancellationToken ct)
    {
        await _memoryService.SaveDreamConfigAsync(config ?? new DreamConfigDto(), ct);
        return ApiResponse.Ok();
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
        try
        {
            if (DatabaseProviderInfo.IsPostgreSqlName(request.Provider))
            {
                await using var connection = new NpgsqlConnection(request.ConnectionString);
                await connection.OpenAsync(cancellationToken);
                await using var command = new NpgsqlCommand("SELECT 1 FROM pg_extension WHERE extname = 'vector'", connection);
                var hasVector = await command.ExecuteScalarAsync(cancellationToken) != null;
                return ApiResponse<DatabaseConnectionTestResult>.Ok(new DatabaseConnectionTestResult
                {
                    CanConnect = true,
                    VectorExtensionAvailable = hasVector,
                    Message = hasVector ? _localizer.T("settings.pgConnectedWithVector") : _localizer.T("settings.pgConnectedWithoutVector")
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
                    Message = _localizer.T("settings.sqliteConnected")
                });
            }
        }
        catch (Exception ex)
        {
            return ApiResponse<DatabaseConnectionTestResult>.Ok(new DatabaseConnectionTestResult
            {
                CanConnect = false,
                VectorExtensionAvailable = false,
                Message = _localizer.T("settings.connectionFailed", ex.Message)
            });
        }
    }
}
