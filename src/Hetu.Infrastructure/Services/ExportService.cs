using System.Diagnostics;
using System.IO.Compression;
using System.Text;
using Hetu.Core.Interfaces;
using Hetu.Infrastructure.Data;
using Hetu.Shared.Common;
using Npgsql;

namespace Hetu.Infrastructure.Services;

public class ExportService : IExportService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly DatabaseProviderInfo _providerInfo;
    private readonly ILocalizer _localizer;

    public ExportService(IUnitOfWork unitOfWork, DatabaseProviderInfo providerInfo, ILocalizer localizer)
    {
        _unitOfWork = unitOfWork;
        _providerInfo = providerInfo;
        _localizer = localizer;
    }

    public async Task<byte[]> ExportNotesAsZipAsync(CancellationToken cancellationToken = default)
    {
        var notes = await _unitOfWork.Notes.GetAllAsync(cancellationToken);
        var notebooks = await _unitOfWork.Notebooks.GetAllAsync(cancellationToken);
        var notebookNames = notebooks.ToDictionary(n => n.Id, n => SafeFileName(n.Name));

        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, true, Encoding.UTF8))
        {
            foreach (var note in notes.Where(n => !n.IsDeleted))
            {
                var folder = note.NotebookId.HasValue && notebookNames.TryGetValue(note.NotebookId.Value, out var nbName)
                    ? nbName
                    : _localizer.T("export.uncategorized");
                var fileName = $"{folder}/{SafeFileName(note.Title)}.md";

                var entry = zip.CreateEntry(fileName, CompressionLevel.Optimal);
                await using var entryStream = entry.Open();
                var content = $"# {note.Title}\n\n{note.Content}";
                await entryStream.WriteAsync(Encoding.UTF8.GetBytes(content), cancellationToken);
            }
        }

        return ms.ToArray();
    }

    public async Task<byte[]> BackupDatabaseAsync(CancellationToken cancellationToken = default)
    {
        if (_providerInfo.IsSqlite)
        {
            var dbPath = ParseDataSource(_providerInfo.ConnectionString);
            if (!File.Exists(dbPath))
                throw new FileNotFoundException(_localizer.T("export.dbFileMissing"), dbPath);

            await using var sourceStream = new FileStream(dbPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 4096, FileOptions.Asynchronous);
            using var ms = new MemoryStream();
            await sourceStream.CopyToAsync(ms, cancellationToken);
            return ms.ToArray();
        }

        if (_providerInfo.IsPostgreSql)
        {
            var builder = new NpgsqlConnectionStringBuilder(_providerInfo.ConnectionString);
            var host = builder.Host ?? "localhost";
            var port = builder.Port;
            var database = builder.Database ?? "hetu";
            var username = builder.Username ?? "postgres";
            var password = builder.Password ?? string.Empty;

            var psi = new ProcessStartInfo
            {
                FileName = "pg_dump",
                Arguments = $"-h {host} -p {port} -U {username} -d {database} -Fc",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.Environment["PGPASSWORD"] = password;

            using var process = Process.Start(psi)
                ?? throw new InvalidOperationException(_localizer.T("export.pgDumpMissing"));

            await using var ms = new MemoryStream();
            var copyTask = process.StandardOutput.BaseStream.CopyToAsync(ms, cancellationToken);
            var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);

            await Task.WhenAll(copyTask, errorTask, process.WaitForExitAsync(cancellationToken));

            if (process.ExitCode != 0)
                throw new InvalidOperationException(_localizer.T("export.pgDumpFailed", await errorTask));

            return ms.ToArray();
        }

        throw new NotSupportedException(_localizer.T("export.providerUnsupported", _providerInfo.Provider));
    }

    public async Task<string> RestoreDatabaseAsync(Stream backupFile, CancellationToken cancellationToken = default)
    {
        if (_providerInfo.IsSqlite)
        {
            var dbPath = ParseDataSource(_providerInfo.ConnectionString);
            var restorePath = dbPath + ".restore";
            await using (var fs = new FileStream(restorePath, FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.Asynchronous))
            {
                await backupFile.CopyToAsync(fs, cancellationToken);
            }

            var backupOldPath = dbPath + ".old" + DateTimeOffset.UtcNow.ToString("yyyyMMddHHmmss");
            if (File.Exists(dbPath))
            {
                File.Move(dbPath, backupOldPath);
            }
            File.Move(restorePath, dbPath);

            return _localizer.T("export.restoreSqliteDone");
        }

        if (_providerInfo.IsPostgreSql)
        {
            var builder = new NpgsqlConnectionStringBuilder(_providerInfo.ConnectionString);
            var host = builder.Host ?? "localhost";
            var port = builder.Port;
            var database = builder.Database ?? "hetu";
            var username = builder.Username ?? "postgres";
            var password = builder.Password ?? string.Empty;

            var tempFile = Path.GetTempFileName();
            await using (var fs = new FileStream(tempFile, FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.Asynchronous))
            {
                await backupFile.CopyToAsync(fs, cancellationToken);
            }

            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "pg_restore",
                    Arguments = $"-h {host} -p {port} -U {username} -d {database} -c -O -x {tempFile}",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                psi.Environment["PGPASSWORD"] = password;

                using var process = Process.Start(psi)
            ?? throw new InvalidOperationException(_localizer.T("export.pgRestoreMissing"));

                var outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
                var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);
                await Task.WhenAll(outputTask, errorTask, process.WaitForExitAsync(cancellationToken));

                if (process.ExitCode != 0)
            throw new InvalidOperationException(_localizer.T("export.pgRestoreFailed", await errorTask));

        return _localizer.T("export.restorePostgresDone");
            }
            finally
            {
                File.Delete(tempFile);
            }
        }

        throw new NotSupportedException(_localizer.T("export.providerUnsupported", _providerInfo.Provider));
    }

    private static string ParseDataSource(string connectionString)
    {
        var parts = connectionString.Split(';', StringSplitOptions.RemoveEmptyEntries);
        foreach (var part in parts)
        {
            var kv = part.Split('=', 2);
            if (kv.Length == 2 && kv[0].Trim().Equals("Data Source", StringComparison.OrdinalIgnoreCase))
                return kv[1].Trim();
        }
        return "hetu.db";
    }

    private static string SafeFileName(string name)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var sb = new StringBuilder(name);
        for (var i = 0; i < sb.Length; i++)
        {
            if (invalid.Contains(sb[i]))
                sb[i] = '_';
        }
        var result = sb.ToString().Trim();
        return string.IsNullOrWhiteSpace(result) ? "untitled" : result;
    }
}
