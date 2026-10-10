using Hetu.Core.Interfaces;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.Mvc;

namespace Hetu.Api.Controllers;

[ApiController]
[Route("api/export")]
public class ExportController : ControllerBase
{
    private readonly IExportService _exportService;
    private readonly ILocalizer _localizer;

    public ExportController(IExportService exportService, ILocalizer localizer)
    {
        _exportService = exportService;
        _localizer = localizer;
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
            return ApiResponse<string>.Fail(_localizer.T("export.fileRequired"));

        await using var stream = file.OpenReadStream();
        var message = await _exportService.RestoreDatabaseAsync(stream, cancellationToken);
        return ApiResponse<string>.Ok(message);
    }
}
