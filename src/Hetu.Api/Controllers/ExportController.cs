using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/export")]
public class ExportController : ControllerBase
{
    private readonly IExportService _exportService;

    public ExportController(IExportService exportService)
    {
        _exportService = exportService;
    }

    [HttpGet("notes")]
    public async Task<IActionResult> ExportNotes(CancellationToken cancellationToken)
    {
        var zipBytes = await _exportService.ExportNotesAsZipAsync(cancellationToken);
        return File(zipBytes, "application/zip", $"hetu-notes-{DateTimeOffset.UtcNow:yyyyMMdd}.zip");
    }

    [HttpGet("backup")]
    public async Task<IActionResult> BackupDatabase(CancellationToken cancellationToken)
    {
        var dbBytes = await _exportService.BackupDatabaseAsync(cancellationToken);
        return File(dbBytes, "application/octet-stream", $"hetu-backup-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}.db");
    }

    [HttpPost("restore")]
    public async Task<ApiResponse<string>> RestoreDatabase(IFormFile file, CancellationToken cancellationToken)
    {
        if (file == null || file.Length == 0)
            return ApiResponse<string>.Fail("请选择有效的备份文件");

        await using var stream = file.OpenReadStream();
        var message = await _exportService.RestoreDatabaseAsync(stream, cancellationToken);
        return ApiResponse<string>.Ok(message);
    }
}
