using System.Security.Cryptography;
using System.Text;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;
using Hetu.Shared.Common;
using Hetu.Shared.Work;
using Microsoft.Extensions.Logging;

namespace Hetu.Core.Services;

/// <summary>
/// 项目代码语义索引实现：遍历项目文本文件 → 按行切块 → 生成 embedding 落库（SQLite 存 byte[]，PostgreSQL 存 vector）。
/// 增量策略：按文件 Hash 比对，未变化的文件跳过；文件删除或变更时清理旧块。
/// </summary>
public class WorkCodeIndexService : IWorkCodeIndexService
{
    /// <summary>单个文件超过该大小时跳过（避免索引构建长期占用）</summary>
    private const long MaxFileBytes = 512 * 1024;

    /// <summary>每个分块的最大行数</summary>
    private const int ChunkLines = 60;

    /// <summary>每个分块的最大字符数</summary>
    private const int ChunkMaxChars = 1600;

    /// <summary>单次构建最多索引的文件数</summary>
    private const int MaxFilesPerRun = 2000;

    /// <summary>单次 Embedding 批量大小</summary>
    private const int EmbedBatchSize = 24;

    /// <summary>数据库侧向量检索不可用时，内存回退扫描的分块上限（超出部分不参与打分）</summary>
    private const int MaxFallbackScanChunks = 20000;

    /// <summary>参与代码语义索引的文件类型</summary>
    private static readonly HashSet<string> IndexableExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".cs", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt",
        ".c", ".h", ".cpp", ".hpp", ".rb", ".php", ".swift", ".scala", ".sh", ".ps1",
        ".cshtml", ".razor", ".vue", ".svelte", ".html", ".css", ".scss",
        ".sql", ".json", ".yml", ".yaml", ".toml", ".md", ".mdx", ".txt"
    };

    private readonly IUnitOfWork _unitOfWork;
    private readonly IEmbeddingProviderFactory _embeddingProviderFactory;
    private readonly IWorkCodeVectorStore _vectorStore;
    private readonly IWorkCodeIndexRefreshQueue? _refreshQueue;
    private readonly ILogger<WorkCodeIndexService> _logger;

    public WorkCodeIndexService(
        IUnitOfWork unitOfWork,
        IEmbeddingProviderFactory embeddingProviderFactory,
        IWorkCodeVectorStore vectorStore,
        ILogger<WorkCodeIndexService> logger,
        IWorkCodeIndexRefreshQueue? refreshQueue = null)
    {
        _unitOfWork = unitOfWork;
        _embeddingProviderFactory = embeddingProviderFactory;
        _vectorStore = vectorStore;
        _logger = logger;
        _refreshQueue = refreshQueue;
    }

    public async Task<ApiResponse<WorkCodeIndexStatusDto>> GetStatusAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var chunks = await _unitOfWork.WorkCodeChunks.FindAsync(c => c.ProjectId == projectId, cancellationToken);
        var indexedAt = chunks.Count > 0 ? chunks.Max(c => c.UpdatedAt) : (DateTimeOffset?)null;
        var status = new WorkCodeIndexStatusDto
        {
            ChunkCount = chunks.Count,
            FileCount = chunks.Select(c => c.FilePath).Distinct(StringComparer.OrdinalIgnoreCase).Count(),
            IndexedAt = indexedAt,
            RefreshPending = _refreshQueue?.IsPending(projectId) ?? false
        };

        // 过期判定：按文件修改时间与索引时间比对（只读元数据，不读文件内容）
        if (indexedAt.HasValue)
        {
            var project = await _unitOfWork.WorkProjects.GetByIdAsync(projectId, cancellationToken);
            if (project != null && !string.IsNullOrWhiteSpace(project.RootPath) && Directory.Exists(project.RootPath))
            {
                status.StaleFileCount = CountStaleFiles(project.RootPath, indexedAt.Value);
                status.IsStale = status.StaleFileCount > 0;
            }
        }

        return ApiResponse<WorkCodeIndexStatusDto>.Ok(status);
    }

    /// <summary>统计索引时间之后被修改或新增的可索引文件数（最多扫描 <see cref="MaxFilesPerRun"/> 个文件）</summary>
    private static int CountStaleFiles(string root, DateTimeOffset indexedAt)
    {
        var stale = 0;
        var scanned = 0;
        foreach (var file in EnumerateFiles(root))
        {
            if (++scanned > MaxFilesPerRun) break;
            if (IsModifiedAfter(file, indexedAt)) stale++;
        }
        return stale;
    }

    /// <summary>文件修改时间是否晚于索引时间</summary>
    private static bool IsModifiedAfter(string fullPath, DateTimeOffset indexedAt)
    {
        try
        {
            return File.GetLastWriteTimeUtc(fullPath) > indexedAt.UtcDateTime;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    public async Task<ApiResponse> ClearAsync(Guid projectId, CancellationToken cancellationToken = default)
    {
        var chunks = await _unitOfWork.WorkCodeChunks.FindAsync(c => c.ProjectId == projectId, cancellationToken);
        foreach (var chunk in chunks)
            await _unitOfWork.WorkCodeChunks.DeleteAsync(chunk, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        await _vectorStore.DeleteAsync(chunks.Select(c => c.Id).ToList(), cancellationToken);
        _logger.LogInformation("[WorkCodeIndex] 清空索引 projectId={ProjectId} chunks={Count}", projectId, chunks.Count);
        return ApiResponse.Ok();
    }

    public async Task<ApiResponse<WorkCodeIndexResultDto>> IndexProjectAsync(
        Guid projectId,
        bool force = false,
        CancellationToken cancellationToken = default)
    {
        var project = await _unitOfWork.WorkProjects.GetByIdAsync(projectId, cancellationToken);
        if (project == null)
            return ApiResponse<WorkCodeIndexResultDto>.Fail("项目不存在");

        if (string.IsNullOrWhiteSpace(project.RootPath) || !Directory.Exists(project.RootPath))
            return ApiResponse<WorkCodeIndexResultDto>.Fail("项目根目录不存在");

        var provider = await _embeddingProviderFactory.CreateEmbeddingProviderAsync(cancellationToken);
        if (provider == null)
            return ApiResponse<WorkCodeIndexResultDto>.Fail("未配置 Embedding 模型，请先在设置中配置");

        var existing = await _unitOfWork.WorkCodeChunks.FindAsync(c => c.ProjectId == projectId, cancellationToken);
        var byPath = existing.GroupBy(c => c.FilePath, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);

        var result = new WorkCodeIndexResultDto { IndexedAt = DateTimeOffset.UtcNow };
        var indexedAt = existing.Count > 0 ? existing.Max(c => c.UpdatedAt) : (DateTimeOffset?)null;
        var seenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var addedChunks = new List<WorkCodeChunk>();
        var removedChunkIds = new List<Guid>();

        foreach (var file in EnumerateFiles(project.RootPath))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (seenPaths.Count >= MaxFilesPerRun) break;

            var relative = Path.GetRelativePath(project.RootPath, file).Replace('\\', '/');
            seenPaths.Add(relative);
            string content;
            try
            {
                content = await File.ReadAllTextAsync(file, cancellationToken);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException)
            {
                result.FailedFiles++;
                continue;
            }

            var hash = ComputeHash(content);
            byPath.TryGetValue(relative, out var old);
            if (!force && old != null && old.Count > 0 && old.All(c => c.Hash == hash))
            {
                result.SkippedFiles++;
                // 内容未变但文件已被改写：刷新分块时间戳，否则状态会永远停留在“待刷新”
                if (indexedAt.HasValue && IsModifiedAfter(file, indexedAt.Value))
                {
                    foreach (var chunk in old)
                        await _unitOfWork.WorkCodeChunks.TouchUpdatedAtAsync(chunk.Id, cancellationToken);
                }
                continue;
            }

            if (old != null)
            {
                foreach (var chunk in old)
                {
                    await _unitOfWork.WorkCodeChunks.DeleteAsync(chunk, cancellationToken);
                    removedChunkIds.Add(chunk.Id);
                }
                result.RemovedChunks += old.Count;
            }

            var pieces = SplitIntoChunks(content);
            if (pieces.Count == 0)
            {
                result.SkippedFiles++;
                continue;
            }

            try
            {
                for (var start = 0; start < pieces.Count; start += EmbedBatchSize)
                {
                    var batch = pieces.Skip(start).Take(EmbedBatchSize).ToList();
                    var vectors = await provider.EmbedAsync(batch.Select(p => p.Text).ToList(), cancellationToken);

                    for (var i = 0; i < batch.Count; i++)
                    {
                        var vector = i < vectors.Length ? vectors[i] : [];
                        if (vector.Length == 0)
                            throw new InvalidOperationException("Embedding 返回空向量，请检查 Embedding 模型与维度配置");
                        var chunk = new WorkCodeChunk
                        {
                            Id = Guid.NewGuid(),
                            ProjectId = projectId,
                            FilePath = relative,
                            StartLine = batch[i].StartLine,
                            Content = batch[i].Text,
                            Hash = hash,
                            Embedding = FloatArrayToBytes(vector),
                            Vector = vector,
                            Model = provider.Dimensions > 0 ? $"{provider.GetType().Name}:{provider.Dimensions}" : provider.GetType().Name,
                            CreatedAt = DateTimeOffset.UtcNow,
                            UpdatedAt = DateTimeOffset.UtcNow
                        };
                        await _unitOfWork.WorkCodeChunks.AddAsync(chunk, cancellationToken);
                        addedChunks.Add(chunk);
                        result.IndexedChunks++;
                    }
                }
                result.IndexedFiles++;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[WorkCodeIndex] 索引文件失败 path={Path}", relative);
                result.FailedFiles++;
            }
        }

        // 清理已不存在的文件
        foreach (var (path, old) in byPath)
        {
            if (seenPaths.Contains(path)) continue;
            foreach (var chunk in old)
            {
                await _unitOfWork.WorkCodeChunks.DeleteAsync(chunk, cancellationToken);
                removedChunkIds.Add(chunk.Id);
            }
            result.RemovedChunks += old.Count;
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // 同步数据库侧向量索引：删除失效分块，并把本次保留 + 新增的分块全量回写，
        // 这样即使 vec 虚表曾被重建也能自愈；写入失败只记日志，不影响索引结果。
        await SyncVectorStoreAsync(projectId, byPath, seenPaths, addedChunks, removedChunkIds, cancellationToken);

        _logger.LogInformation(
            "[WorkCodeIndex] 构建完成 projectId={ProjectId} files={Files} chunks={Chunks} skipped={Skipped} removed={Removed} failed={Failed}",
            projectId, result.IndexedFiles, result.IndexedChunks, result.SkippedFiles, result.RemovedChunks, result.FailedFiles);

        return ApiResponse<WorkCodeIndexResultDto>.Ok(result);
    }

    /// <summary>把本次保留与新增的分块同步到数据库侧向量索引，并清理被替换/删除的分块</summary>
    private async Task SyncVectorStoreAsync(
        Guid projectId,
        IReadOnlyDictionary<string, List<WorkCodeChunk>> byPath,
        HashSet<string> seenPaths,
        List<WorkCodeChunk> added,
        List<Guid> removedIds,
        CancellationToken cancellationToken)
    {
        try
        {
            if (removedIds.Count > 0)
                await _vectorStore.DeleteAsync(removedIds, cancellationToken);

            var kept = byPath
                .Where(kv => seenPaths.Contains(kv.Key))
                .SelectMany(kv => kv.Value)
                .ToList();

            var toUpsert = kept.Concat(added).ToList();
            if (toUpsert.Count > 0)
                await _vectorStore.UpsertAsync(toUpsert, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[WorkCodeIndex] 同步向量索引失败 projectId={ProjectId}", projectId);
        }
    }

    public async Task<ApiResponse<List<WorkCodeSearchHitDto>>> SearchAsync(
        Guid projectId,
        string query,
        int limit = 8,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(query))
            return ApiResponse<List<WorkCodeSearchHitDto>>.Fail("查询内容不能为空");

        var provider = await _embeddingProviderFactory.CreateEmbeddingProviderAsync(cancellationToken);
        if (provider == null)
            return ApiResponse<List<WorkCodeSearchHitDto>>.Fail("未配置 Embedding 模型");

        float[] queryVector;
        try
        {
            queryVector = await provider.EmbedAsync(query.Trim(), cancellationToken);
        }
        catch (Exception ex)
        {
            return ApiResponse<List<WorkCodeSearchHitDto>>.Fail($"生成查询向量失败：{ex.Message}");
        }

        var topK = Math.Clamp(limit, 1, 30);

        // 优先走数据库侧向量检索（sqlite-vec / pgvector）：只取候选分块，避免把整个索引读进内存
        var candidateIds = await _vectorStore.SearchAsync(projectId, queryVector, topK, cancellationToken);
        if (candidateIds is { Count: > 0 })
        {
            var candidates = await _unitOfWork.WorkCodeChunks.FindAsync(c => candidateIds.Contains(c.Id), cancellationToken);
            var byId = candidates.ToDictionary(c => c.Id);
            var ordered = candidateIds
                .Where(byId.ContainsKey)
                .Select(id => byId[id])
                .Where(c => c.ProjectId == projectId)
                .Take(topK)
                .ToList();

            // 多项目共用一张向量表时，候选可能全部属于其他项目，此时继续回退到本项目分块检索
            if (ordered.Count > 0)
                return ApiResponse<List<WorkCodeSearchHitDto>>.Ok(BuildHits(ordered, queryVector));
        }

        if (candidateIds is { Count: 0 } && await _vectorStore.CountAsync(projectId, cancellationToken) > 0)
        {
            // 数据库侧索引可用但整表都没有命中，说明确实没有匹配内容
            return ApiResponse<List<WorkCodeSearchHitDto>>.Ok([]);
        }

        // 回退：数据库侧向量检索不可用，或索引尚未同步（例如索引在本次升级前构建）
        var chunks = await _unitOfWork.WorkCodeChunks.FindAsync(c => c.ProjectId == projectId, cancellationToken);
        if (chunks.Count == 0)
            return ApiResponse<List<WorkCodeSearchHitDto>>.Ok([]);

        var scanned = chunks;
        if (chunks.Count > MaxFallbackScanChunks)
        {
            _logger.LogWarning(
                "[WorkCodeIndex] 内存回退扫描超过上限 projectId={ProjectId} chunks={Count} limit={Limit}，建议重建索引",
                projectId, chunks.Count, MaxFallbackScanChunks);
            scanned = chunks.Take(MaxFallbackScanChunks).ToList();
        }

        var hits = scanned
            .Select(c => new { Chunk = c, Vector = BytesToFloatArray(c.Embedding) })
            .Where(x => x.Vector.Length > 0 && x.Vector.Length == queryVector.Length)
            .Select(x => new { x.Chunk, Score = CosineSimilarity(queryVector, x.Vector) })
            .OrderByDescending(x => x.Score)
            .Take(topK)
            .Select(x => new WorkCodeSearchHitDto
            {
                Path = x.Chunk.FilePath,
                StartLine = x.Chunk.StartLine,
                Snippet = x.Chunk.Content.Length > 600 ? x.Chunk.Content[..600] + "…" : x.Chunk.Content,
                Score = Math.Round(x.Score, 4)
            })
            .ToList();

        return ApiResponse<List<WorkCodeSearchHitDto>>.Ok(hits);
    }

    /// <summary>按候选分块真正计算余弦相似度并组装命中结果（数据库侧只提供候选，分数口径与内存回退保持一致）</summary>
    private static List<WorkCodeSearchHitDto> BuildHits(IReadOnlyList<WorkCodeChunk> chunks, float[] queryVector)
        => chunks
            .Select(c => new { Chunk = c, Score = CosineSimilarity(queryVector, BytesToFloatArray(c.Embedding)) })
            .OrderByDescending(x => x.Score)
            .Select(x => new WorkCodeSearchHitDto
            {
                Path = x.Chunk.FilePath,
                StartLine = x.Chunk.StartLine,
                Snippet = x.Chunk.Content.Length > 600 ? x.Chunk.Content[..600] + "…" : x.Chunk.Content,
                Score = Math.Round(x.Score, 4)
            })
            .ToList();

    /// <summary>枚举项目内可索引的文本文件（跳过忽略目录、二进制与超大文件）</summary>
    private static IEnumerable<string> EnumerateFiles(string root)
    {
        var stack = new Stack<string>();
        stack.Push(root);

        while (stack.Count > 0)
        {
            var dir = stack.Pop();
            string[] subDirs;
            string[] files;
            try
            {
                subDirs = Directory.GetDirectories(dir);
                files = Directory.GetFiles(dir);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                continue;
            }

            foreach (var sub in subDirs)
            {
                if (WorkProjectRules.IsBuiltinIgnoredDir(Path.GetFileName(sub))) continue;
                if (WorkProjectRules.IsIgnored(root, Path.GetRelativePath(root, sub))) continue;
                stack.Push(sub);
            }

            foreach (var file in files)
            {
                if (!IndexableExtensions.Contains(Path.GetExtension(file))) continue;
                if (WorkProjectRules.IsIgnored(root, Path.GetRelativePath(root, file))) continue;

                FileInfo info;
                try { info = new FileInfo(file); }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { continue; }

                if (!info.Exists || info.Length == 0 || info.Length > MaxFileBytes) continue;
                if (!WorkProjectRules.IsProbablyText(file)) continue;

                yield return file;
            }
        }
    }

    /// <summary>按行切块：每块最多 <see cref="ChunkLines"/> 行且不超过 <see cref="ChunkMaxChars"/> 字符</summary>
    internal static List<(int StartLine, string Text)> SplitIntoChunks(string content)
    {
        var result = new List<(int, string)>();
        if (string.IsNullOrWhiteSpace(content)) return result;

        var lines = content.Replace("\r\n", "\n").Split('\n');
        var buffer = new StringBuilder();
        var startLine = 1;
        var lineCount = 0;

        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i];
            if (lineCount == 0) startLine = i + 1;

            if (buffer.Length + line.Length + 1 > ChunkMaxChars && buffer.Length > 0)
            {
                result.Add((startLine, buffer.ToString().TrimEnd()));
                buffer.Clear();
                startLine = i + 1;
                lineCount = 0;
            }

            buffer.Append(line).Append('\n');
            lineCount++;

            if (lineCount >= ChunkLines)
            {
                result.Add((startLine, buffer.ToString().TrimEnd()));
                buffer.Clear();
                lineCount = 0;
            }
        }

        if (buffer.Length > 0)
        {
            var tail = buffer.ToString().TrimEnd();
            if (tail.Length > 0) result.Add((startLine, tail));
        }

        return result;
    }

    private static string ComputeHash(string content)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(content)));

    private static byte[] FloatArrayToBytes(float[] floats)
    {
        var bytes = new byte[floats.Length * sizeof(float)];
        Buffer.BlockCopy(floats, 0, bytes, 0, bytes.Length);
        return bytes;
    }

    private static float[] BytesToFloatArray(byte[] bytes)
    {
        if (bytes.Length == 0) return [];
        var floats = new float[bytes.Length / sizeof(float)];
        Buffer.BlockCopy(bytes, 0, floats, 0, floats.Length * sizeof(float));
        return floats;
    }

    private static double CosineSimilarity(float[] a, float[] b)
    {
        double dot = 0, normA = 0, normB = 0;
        for (var i = 0; i < a.Length; i++)
        {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        if (normA == 0 || normB == 0) return 0;
        return dot / (Math.Sqrt(normA) * Math.Sqrt(normB));
    }
}
