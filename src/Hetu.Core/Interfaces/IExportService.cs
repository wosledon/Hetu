using Hetu.Shared.Common;

namespace Hetu.Core.Interfaces;

public interface IExportService
{
    Task<byte[]> ExportNotesAsZipAsync(CancellationToken cancellationToken = default);
    Task<byte[]> BackupDatabaseAsync(CancellationToken cancellationToken = default);
    Task<string> RestoreDatabaseAsync(Stream backupFile, CancellationToken cancellationToken = default);
}
