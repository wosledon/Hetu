using System.Text;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Work;
namespace Hetu.Core.Services.Tools;

/// <summary>
/// SSH 远程项目的文件系统操作：通过远端 shell 命令完成列举/读写/查找，
/// 与本地工具的语义保持一致（相对项目根、防目录穿越、忽略内置目录）。
/// </summary>
public static class WorkRemoteFs
{
    /// <summary>把相对路径拼到项目根下并加双引号（双引号内空格安全，$ 需转义防变量展开）</summary>
    public static string Quote(string root, string relative)
    {
        var rel = (relative ?? string.Empty).Replace('\\', '/').Trim().TrimStart('/');
        var full = string.IsNullOrEmpty(rel) ? root : $"{root.TrimEnd('/')}/{rel}";
        var escaped = full.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("$", "\\$").Replace("`", "\\`");
        return $"\"{escaped}\"";
    }

    /// <summary>相对路径的 shell 引用（用于报错信息）</summary>
    public static string Display(string relative) => string.IsNullOrWhiteSpace(relative) ? "." : relative.Replace('\\', '/');

    /// <summary>校验相对路径不含 .. 穿越</summary>
    public static bool Escapes(string relative)
    {
        var rel = (relative ?? string.Empty).Replace('\\', '/');
        return rel.Split('/', StringSplitOptions.RemoveEmptyEntries).Any(s => s == "..");
    }

    /// <summary>远端目录列举（ls -la 解析：类型、大小、名称）</summary>
    public static async Task<ToolExecutionResult> ListDirAsync(
        IWorkCommandRunner runner, string root, string relative, CancellationToken ct)
    {
        var target = Quote(root, relative);
        var result = await runner.RunAsync($"ls -la {target}", ct);
        if (result.ExitCode != 0)
            return ToolExecutionResult.Error($"列出目录失败: {FirstLine(result.StdErr) ?? "未知错误"}");

        var sb = new StringBuilder();
        var count = 0;
        foreach (var raw in result.StdOut.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            if (line.Length == 0 || line.StartsWith("total ", StringComparison.OrdinalIgnoreCase)) continue;
            // 形如：drwxr-xr-x 2 user group 4096 Oct  7 09:00 name
            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 9) continue;
            var name = string.Join(' ', parts.Skip(8));
            if (name is "." or "..") continue;
            if (relative.Length > 0 && WorkProjectRules.IsBuiltinIgnoredDir(name)) continue;

            var isDir = parts[0].StartsWith('d');
            var size = parts[4];
            sb.AppendLine(isDir ? $"📁 {name}/" : $"📄 {name} ({size} bytes)");
            count++;
            if (count >= 500)
            {
                sb.AppendLine("…（条目过多已截断）");
                break;
            }
        }
        return ToolExecutionResult.Success(count == 0 ? "（空目录）" : sb.ToString());
    }

    /// <summary>远端读取文件（cat 后按行号切片）</summary>
    public static async Task<ToolExecutionResult> ReadFileAsync(
        IWorkCommandRunner runner, string root, string relative, int start, int end, CancellationToken ct)
    {
        var target = Quote(root, relative);
        var result = await runner.RunAsync($"cat {target}", ct);
        if (result.ExitCode != 0)
            return ToolExecutionResult.Error($"读取文件失败: {FirstLine(result.StdErr) ?? "未知错误"}");

        var lines = result.StdOut.Replace("\r\n", "\n").Split('\n');
        if (lines.Length > 0 && lines[^1].Length == 0) lines = lines[..^1];

        var from = Math.Max(1, start);
        var to = Math.Min(lines.Length, end <= 0 ? lines.Length : end);
        if (from > to) return ToolExecutionResult.Error("起始行大于结束行");

        var sb = new StringBuilder();
        for (var i = from - 1; i < to; i++)
        {
            sb.AppendLine($"{i + 1}| {lines[i]}");
            if (sb.Length > 60000)
            {
                sb.AppendLine("…（内容过长已截断）");
                break;
            }
        }
        return ToolExecutionResult.Success(sb.ToString());
    }

    /// <summary>远端写入文件（stdin 交给 cat > 文件，先建目录）</summary>
    public static async Task<ToolExecutionResult> WriteFileAsync(
        IWorkCommandRunner runner, string root, string relative, string content, CancellationToken ct)
    {
        var rel = (relative ?? string.Empty).Replace('\\', '/').Trim().TrimStart('/');
        var dir = rel.Contains('/') ? Quote(root, rel[..rel.LastIndexOf('/')]) : Quote(root, "");
        var target = Quote(root, rel);
        var result = await runner.RunAsync($"mkdir -p {dir} && cat > {target}", content, ct);
        if (result.ExitCode != 0)
            return ToolExecutionResult.Error($"写入文件失败: {FirstLine(result.StdErr) ?? "未知错误"}");
        return ToolExecutionResult.Success($"✅ 已写入 {Display(rel)}（{content.Length} 字符，远端）");
    }

    /// <summary>远端精确替换：读取 → 文本替换 → 写回</summary>
    public static async Task<ToolExecutionResult> ApplyPatchAsync(
        IWorkCommandRunner runner, string root, string relative, string search, string replace, bool replaceAll, CancellationToken ct)
    {
        var target = Quote(root, relative);
        var read = await runner.RunAsync($"cat {target}", ct);
        if (read.ExitCode != 0)
            return ToolExecutionResult.Error($"读取文件失败: {FirstLine(read.StdErr) ?? "未知错误"}");

        var original = read.StdOut;
        var matches = 0;
        var index = 0;
        while ((index = original.IndexOf(search, index, StringComparison.Ordinal)) >= 0)
        {
            matches++;
            index += search.Length;
        }
        if (matches == 0)
            return ToolExecutionResult.Error("未找到 search 片段，文件内容未被修改（请先 work_read_file 确认原文）");
        if (matches > 1 && !replaceAll)
            return ToolExecutionResult.Error($"search 片段匹配到 {matches} 处，请扩大上下文使其唯一，或指定 replaceAll=true");

        var updated = replaceAll ? original.Replace(search, replace) : ReplaceFirst(original, search, replace);
        var write = await runner.RunAsync($"cat > {target}", updated, ct);
        if (write.ExitCode != 0)
            return ToolExecutionResult.Error($"写入文件失败: {FirstLine(write.StdErr) ?? "未知错误"}");

        var delta = updated.Length - original.Length;
        return ToolExecutionResult.Success($"✅ 已修改 {Display(relative)}（{matches} 处替换，长度 {delta:+#;-#;0}，远端）");
    }

    /// <summary>远端删除文件（先确认存在且不是目录）</summary>
    public static async Task<ToolExecutionResult> DeleteFileAsync(
        IWorkCommandRunner runner, string root, string relative, CancellationToken ct)
    {
        var target = Quote(root, relative);
        var check = await runner.RunAsync($"test -f {target} && echo FILE || echo NONE", ct);
        var verdict = check.StdOut.Trim();
        if (verdict.Contains("NONE"))
        {
            var dirCheck = await runner.RunAsync($"test -d {target} && echo DIR || echo MISSING", ct);
            return ToolExecutionResult.Error(dirCheck.StdOut.Contains("DIR") ? "本工具只删除文件，不删除目录" : $"文件不存在: {Display(relative)}");
        }

        var result = await runner.RunAsync($"rm -f {target}", ct);
        if (result.ExitCode != 0)
            return ToolExecutionResult.Error($"删除文件失败: {FirstLine(result.StdErr) ?? "未知错误"}");
        return ToolExecutionResult.Success($"🗑️ 已删除 {Display(relative)}（远端）");
    }

    /// <summary>远端移动/重命名文件</summary>
    public static async Task<ToolExecutionResult> MoveFileAsync(
        IWorkCommandRunner runner, string root, string from, string to, CancellationToken ct)
    {
        var source = Quote(root, from);
        var target = Quote(root, to);
        var toDir = (to ?? "").Replace('\\', '/').Contains('/') ? Quote(root, to[..to.Replace('\\', '/').LastIndexOf('/')]) : Quote(root, "");

        var exists = await runner.RunAsync($"test -e {source} && echo FILE || echo NONE", ct);
        if (exists.StdOut.Contains("NONE")) return ToolExecutionResult.Error($"源文件不存在: {Display(from)}");
        var targetExists = await runner.RunAsync($"test -e {target} && echo FILE || echo NONE", ct);
        if (targetExists.StdOut.Contains("FILE")) return ToolExecutionResult.Error($"目标文件已存在: {Display(to)}");

        var result = await runner.RunAsync($"mkdir -p {toDir} && mv {source} {target}", ct);
        if (result.ExitCode != 0)
            return ToolExecutionResult.Error($"移动文件失败: {FirstLine(result.StdErr) ?? "未知错误"}");
        return ToolExecutionResult.Success($"📦 已移动 {Display(from)} → {Display(to)}（远端）");
    }

    /// <summary>远端 glob：find 列出文件后用同一套 glob 正则匹配相对路径</summary>
    public static async Task<ToolExecutionResult> GlobAsync(
        IWorkCommandRunner runner, string root, string relative, string pattern, int limit, CancellationToken ct)
    {
        var searchRoot = Quote(root, relative);
        var result = await runner.RunAsync($"find {searchRoot} -type f 2>/dev/null | head -n 20000", ct);
        var regex = WorkToolPolicy.GlobToRegex(NormalizeGlob(pattern));

        var matches = new List<string>();
        var scanned = 0;
        foreach (var raw in result.StdOut.Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0) continue;
            scanned++;
            var relativePath = ToRelative(root, line);
            if (relativePath == null) continue;
            if (WorkProjectRules.IsBuiltinIgnoredDir(Path.GetFileName(relativePath))) continue;
            if (regex.IsMatch(relativePath)) matches.Add(relativePath);
            if (matches.Count >= limit) break;
        }

        if (matches.Count == 0)
            return ToolExecutionResult.Success($"未找到匹配 {pattern} 的文件（已扫描 {scanned} 个文件）");

        var sb = new StringBuilder();
        foreach (var m in matches.OrderBy(x => x, StringComparer.Ordinal)) sb.AppendLine(m);
        sb.AppendLine($"（{matches.Count} 个匹配，扫描 {scanned} 个文件，远端）");
        return ToolExecutionResult.Success(sb.ToString());
    }

    /// <summary>远端 grep：grep -rnE（POSIX ERE，与 .NET 正则语法基本兼容的常用子集）</summary>
    public static async Task<ToolExecutionResult> GrepAsync(
        IWorkCommandRunner runner, string root, string relative, string pattern, string glob, bool caseSensitive, int limit, CancellationToken ct)
    {
        var searchRoot = Quote(root, relative);
        var patternArg = SingleQuote(pattern);
        var caseFlag = caseSensitive ? "" : "i";
        var globArgs = string.IsNullOrWhiteSpace(glob) ? "" : $" --include {SingleQuote(NormalizeGlobForFind(glob))}";
        var command = $"grep -rnE{caseFlag}I{globArgs} -e {patternArg} {searchRoot} 2>/dev/null | head -n {limit * 2}";

        var result = await runner.RunAsync(command, ct);
        var hits = new List<string>();
        foreach (var raw in result.StdOut.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            if (line.Length == 0) continue;
            // 形如：/abs/root/src/a.cs:12: code
            var sep = line.IndexOf(": ", StringComparison.Ordinal);
            var firstColon = line.IndexOf(':', StringComparison.Ordinal);
            if (firstColon < 0) continue;
            var secondColon = line.IndexOf(':', firstColon + 1);
            if (secondColon < 0) continue;
            var relativePath = ToRelative(root, line[..firstColon]);
            if (relativePath == null) continue;
            var lineNo = line[(firstColon + 1)..secondColon];
            var text = sep >= 0 && sep > secondColon ? line[(sep + 2)..] : line[(secondColon + 1)..];
            text = text.Trim();
            if (text.Length > 400) text = text[..400] + "…";
            hits.Add($"{relativePath}:{lineNo}: {text}");
            if (hits.Count >= limit) break;
        }

        if (hits.Count == 0)
            return ToolExecutionResult.Success("未找到匹配（远端 grep）");

        var sb = new StringBuilder();
        foreach (var hit in hits) sb.AppendLine(hit);
        sb.AppendLine($"（{hits.Count} 条匹配，远端 grep）");
        return ToolExecutionResult.Success(sb.ToString());
    }

    /// <summary>远端执行 git 只读子命令</summary>
    public static Task<ToolExecutionResult> GitAsync(IWorkCommandRunner runner, string gitArgs, CancellationToken ct)
        => RunShellAsync(runner, $"git {gitArgs}", ct);

    /// <summary>远端执行任意 shell 命令（项目根为工作目录）</summary>
    public static async Task<ToolExecutionResult> RunShellAsync(IWorkCommandRunner runner, string command, CancellationToken ct)
    {
        var result = await runner.RunAsync(command, ct);
        var sb = new StringBuilder();
        if (!string.IsNullOrWhiteSpace(result.StdOut)) sb.AppendLine(result.StdOut.TrimEnd());
        if (!string.IsNullOrWhiteSpace(result.StdErr)) sb.AppendLine("[stderr] " + result.StdErr.TrimEnd());
        sb.AppendLine($"（退出码 {result.ExitCode}）");
        return ToolExecutionResult.Success(sb.ToString());
    }

    /// <summary>归一化 glob：无目录分隔符时按 **/ 前缀处理</summary>
    public static string NormalizeGlob(string pattern)
    {
        var normalized = (pattern ?? string.Empty).Replace('\\', '/').TrimStart('/');
        if (normalized.Length > 0 && !normalized.Contains('/')) normalized = "**/" + normalized;
        return normalized;
    }

    /// <summary>去掉 **/ 前缀，供 grep --include 这类只匹配文件名的场景使用</summary>
    private static string NormalizeGlobForFind(string pattern)
    {
        var normalized = NormalizeGlob(pattern);
        return normalized.StartsWith("**/") ? normalized[3..] : normalized;
    }

    /// <summary>单引号安全包裹（POSIX shell）</summary>
    private static string SingleQuote(string value) => "'" + (value ?? "").Replace("'", "'\\''") + "'";

    /// <summary>把远端绝对路径转成相对项目根的路径（越界返回 null）</summary>
    private static string? ToRelative(string root, string absolute)
    {
        var normalizedRoot = root.TrimEnd('/');
        var path = absolute.Trim();
        if (path.StartsWith("./")) path = path[2..];
        if (!path.StartsWith(normalizedRoot + "/", StringComparison.Ordinal)) return null;
        return path[(normalizedRoot.Length + 1)..];
    }

    private static string ReplaceFirst(string text, string search, string replace)
    {
        var index = text.IndexOf(search, StringComparison.Ordinal);
        return index < 0 ? text : text[..index] + replace + text[(index + search.Length)..];
    }

    private static string? FirstLine(string text) => text.Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim();
}
