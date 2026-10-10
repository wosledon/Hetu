using System.Text;
using System.Text.Json;
using Hetu.Core.Services.Work;

namespace Hetu.Core.Services.Tools;

/// <summary>
/// GitHub Copilot 资产加载：解析项目 <c>.github</c> 目录下的
/// 指令（copilot-instructions.md / instructions/*.instructions.md）、
/// 提示词模板（prompts/*.prompt.md）、自定义智能体（agents/*.agent.md、chatmodes/*.chatmode.md）
/// 与技能（skills/**/SKILL.md），供 Work 编码 Agent 自动加载使用。
/// 本地项目直接读文件系统（<c>.github</c> 为软链时跟随链接）；SSH 项目走远端 shell。
/// </summary>
public static class WorkCopilotAssets
{
    public sealed record CopilotInstruction(string Label, string FilePath, string Content, string? Description, string? ApplyTo);
    public sealed record CopilotAgent(string Name, string Description, string? Model, string? Tools, string FilePath, string Body);
    public sealed record CopilotPrompt(string Name, string Description, string FilePath, string Text);
    public sealed record CopilotSkill(string Name, string Description, string FilePath, string Text);

    public sealed record CopilotAssets(
        IReadOnlyList<CopilotInstruction> Instructions,
        IReadOnlyList<CopilotAgent> Agents,
        IReadOnlyList<CopilotPrompt> Prompts,
        IReadOnlyList<CopilotSkill> Skills)
    {
        public bool IsEmpty => Instructions.Count == 0 && Agents.Count == 0 && Prompts.Count == 0 && Skills.Count == 0;
    }

    private const int MaxInstructionChars = 3000;
    private const int MaxInstructionTotalChars = 6000;
    private const int MaxAgentBodyChars = 4000;
    /// <summary>远端单次扫描的文件数上限与单文件字节上限（避免一条 ssh 回传过多内容）</summary>
    private const int MaxRemoteFiles = 400;
    private const int MaxRemoteFileBytes = 64 * 1024;
    /// <summary>远端分段标记：每段以该标记 + 项目内相对路径开头</summary>
    private const string RemoteFileMarker = "@@HETU-FILE@@";

    private static readonly string[] AgentExtensions = { ".agent.md", ".chatmode.md", ".md" };

    /// <summary>扫描项目根目录下的 .github 资产；目录不存在时返回空集合。</summary>
    public static CopilotAssets Load(string root)
    {
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root)) return Empty;

        var githubDir = ResolveDir(Path.Combine(root, ".github"));
        if (githubDir == null) return Empty;

        var instructions = LoadInstructions(root, githubDir);
        var agents = LoadAgents(githubDir);
        var prompts = LoadPrompts(githubDir);
        var skills = LoadSkills(githubDir);
        return new CopilotAssets(instructions, agents, prompts, skills);
    }

    /// <summary>
    /// 按项目类型加载：SSH 项目通过远端 shell 扫描（远端 <c>.github</c> 常是软链），
    /// 本地项目直接读文件系统。
    /// <paramref name="force"/> 为 false 时远端结果走短缓存（每条消息都 ssh 一次既慢又怕网络抽风）。
    /// </summary>
    public static async Task<CopilotAssets> LoadAsync(string root, IWorkCommandRunner? runner, CancellationToken ct = default, bool force = false)
    {
        if (runner is { IsRemote: true }) return await LoadRemoteAsync(runner, force, ct);
        return Load(root);
    }

    public static readonly CopilotAssets Empty = new([], [], [], []);

    /// <summary>
    /// 解析目录入口，兼容 .github 为软链的多种形态：
    /// 普通目录 / 软链目录（mklink /D、ln -s、junction）直接可用；
    /// Windows 上 git 默认 <c>core.symlinks=false</c>，会把符号链接检出成“内容为目标路径的普通文件”，
    /// 此时按文件内容解析目标路径，否则整个 .github 会被当成不存在。
    /// </summary>
    private static string? ResolveDir(string path)
    {
        if (Directory.Exists(path)) return path;
        if (!File.Exists(path)) return null;

        try
        {
            var link = File.ResolveLinkTarget(path, returnFinalTarget: true);
            if (link is { Exists: true } && Directory.Exists(link.FullName)) return link.FullName;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            // 非链接或平台不支持时继续按“链接文件内容”解析
        }

        try
        {
            var info = new FileInfo(path);
            if (info.Length == 0 || info.Length > 4096) return null;

            var target = File.ReadAllText(path).Trim().Trim('"', '\'');
            if (target.Length is 0 or > 2048 || target.Contains('\0') || target.Contains('\n') || target.Contains('\r'))
                return null;

            var candidate = Path.IsPathRooted(target)
                ? target
                : Path.Combine(Path.GetDirectoryName(path) ?? string.Empty, target);
            candidate = candidate.Replace('\\', Path.DirectorySeparatorChar).Replace('/', Path.DirectorySeparatorChar);
            return Directory.Exists(candidate) ? Path.GetFullPath(candidate) : null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static List<CopilotInstruction> LoadInstructions(string root, string githubDir)
    {
        var files = new List<string>();

        var rootInstructions = Path.Combine(githubDir, "copilot-instructions.md");
        if (File.Exists(rootInstructions)) files.Add(rootInstructions);

        var instructionsDir = ResolveDir(Path.Combine(githubDir, "instructions"));
        if (instructionsDir != null)
            foreach (var file in SafeEnumerateFiles(instructionsDir, "*.instructions.md", recursive: true))
                files.Add(file);

        var result = new List<CopilotInstruction>();
        foreach (var file in files)
        {
            var text = ReadText(file);
            if (text == null) continue;
            result.Add(BuildInstruction(Relative(root, file), file, text));
        }
        return result;
    }

    private static List<CopilotAgent> LoadAgents(string githubDir)
    {
        var files = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var name in new[] { "agents", "chatmodes" })
        {
            var dir = ResolveDir(Path.Combine(githubDir, name));
            if (dir == null) continue;
            foreach (var ext in AgentExtensions)
            {
                foreach (var file in SafeEnumerateFiles(dir, $"*{ext}", recursive: false))
                {
                    if (seen.Add(file)) files.Add(file);
                }
            }
        }

        var result = new List<CopilotAgent>();
        foreach (var file in files)
        {
            var text = ReadText(file);
            if (text == null) continue;
            result.Add(BuildAgent(file, text, Path.GetFileNameWithoutExtension(file)));
        }
        return result;
    }

    private static List<CopilotPrompt> LoadPrompts(string githubDir)
    {
        var files = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var promptsDir = ResolveDir(Path.Combine(githubDir, "prompts"));
        foreach (var file in SafeEnumerateFiles(githubDir, "*.prompt.md", recursive: false)
            .Concat(promptsDir == null ? [] : SafeEnumerateFiles(promptsDir, "*.prompt.md", recursive: true)))
        {
            if (seen.Add(file)) files.Add(file);
        }

        var result = new List<CopilotPrompt>();
        foreach (var file in files)
        {
            var text = ReadText(file);
            if (text == null) continue;
            result.Add(BuildPrompt(file, text));
        }
        return result;
    }

    private static List<CopilotSkill> LoadSkills(string githubDir)
    {
        var skillsDir = ResolveDir(Path.Combine(githubDir, "skills"));
        if (skillsDir == null) return [];

        var result = new List<CopilotSkill>();
        foreach (var file in SafeEnumerateFiles(skillsDir, "SKILL.md", recursive: true))
        {
            var text = ReadText(file);
            if (text == null) continue;
            result.Add(BuildSkill(file, text));
        }
        return result;
    }

    /// <summary>资产文件 → 记录：本地与远端共用同一套解析规则，保证两条链路结果一致。</summary>
    private static CopilotInstruction BuildInstruction(string label, string filePath, string text)
    {
        var (frontmatter, body) = SplitFrontmatter(text);
        var content = string.IsNullOrWhiteSpace(body) ? text.Trim() : body.Trim();
        if (content.Length > MaxInstructionChars)
            content = content[..MaxInstructionChars] + "\n…（指令过长已截断，完整文件见系统提示中的路径）";

        return new CopilotInstruction(
            label, filePath, content,
            frontmatter.GetValueOrDefault("description"),
            frontmatter.GetValueOrDefault("applyTo"));
    }

    private static CopilotAgent BuildAgent(string filePath, string text, string nameFallback)
    {
        var (frontmatter, body) = SplitFrontmatter(text);
        var name = frontmatter.GetValueOrDefault("name") ?? nameFallback;
        if (name.EndsWith(".agent", StringComparison.OrdinalIgnoreCase)) name = name[..^".agent".Length];
        if (name.EndsWith(".chatmode", StringComparison.OrdinalIgnoreCase)) name = name[..^".chatmode".Length];

        var description = frontmatter.GetValueOrDefault("description")
            ?? FirstMeaningfulLine(body)
            ?? "仓库自定义智能体";

        if (body.Length > MaxAgentBodyChars)
            body = body[..MaxAgentBodyChars] + "\n…（人设过长已截断）";

        return new CopilotAgent(
            name,
            description,
            frontmatter.GetValueOrDefault("model"),
            frontmatter.GetValueOrDefault("tools"),
            filePath,
            body.Trim());
    }

    private static CopilotPrompt BuildPrompt(string filePath, string text)
    {
        var (frontmatter, body) = SplitFrontmatter(text);
        var fileName = Path.GetFileName(filePath);
        var name = Path.GetFileNameWithoutExtension(Path.GetFileNameWithoutExtension(fileName));
        var description = frontmatter.GetValueOrDefault("description") ?? FirstMeaningfulLine(body) ?? "仓库提示词模板";
        return new CopilotPrompt(name, description, filePath, text);
    }

    private static CopilotSkill BuildSkill(string filePath, string text)
    {
        var (frontmatter, _) = SplitFrontmatter(text);
        var name = frontmatter.GetValueOrDefault("name")
            ?? new DirectoryInfo(Path.GetDirectoryName(filePath.Replace('\\', '/')) ?? string.Empty).Name;
        var description = frontmatter.GetValueOrDefault("description") ?? "仓库技能";
        return new CopilotSkill(name, description, filePath, text);
    }

    /// <summary>
    /// 远端（SSH）扫描：一条命令列出并回传 .github 下的资产文件内容，避免逐文件一次 ssh。
    /// 远端 .github 常是软链（<c>ln -s ~/dev-collection .github</c>），<c>cd</c> 会跟随链接；
    /// find 同时接受普通文件与软链文件（<c>-type f -o -type l</c>），否则软链进来的文件会被漏掉。
    ///
    /// 这里必须「失败也不影响发消息」：SSH 网络抖动时若让异常冒到控制器，
    /// 整轮请求会 500（用户看到的是「发了没回复、也没有日志」）。所以超时/失败一律降级为空资产，
    /// 并把结果（含失败）短缓存，避免每条消息都卡一次超时。
    /// </summary>
    private static async Task<CopilotAssets> LoadRemoteAsync(IWorkCommandRunner runner, bool force, CancellationToken ct)
    {
        var cacheKey = runner.RootPath ?? string.Empty;
        if (!force && RemoteCache.TryGetValue(cacheKey, out var cached) && DateTimeOffset.UtcNow - cached.At < RemoteCacheTtl)
            return cached.Assets;

        var names = "\\( -name 'copilot-instructions.md' -o -name '*.instructions.md' -o -name '*.agent.md' " +
                    "-o -name '*.chatmode.md' -o -name '*.prompt.md' -o -name 'SKILL.md' " +
                    "-o -path './agents/*.md' -o -path './chatmodes/*.md' \\)";
        var command =
            $"if cd .github 2>/dev/null; then find . \\( -type f -o -type l \\) {names} | head -n {MaxRemoteFiles} | " +
            $"while IFS= read -r f; do printf '{RemoteFileMarker}%s\\n' \"$f\"; head -c {MaxRemoteFileBytes} \"$f\" 2>/dev/null; echo; done; fi";

        WorkCommandResult result;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(RemoteScanTimeout);
        try
        {
            result = await runner.RunAsync(command, timeout.Token);
        }
        catch (Exception ex)
        {
            // 超时（网络抖动 / 远端命令卡住）或执行失败：本轮按「没有 .github 资产」继续
            Console.Error.WriteLine($"[WorkCopilotAssets] 远端扫描失败，按无资产继续：{ex.GetType().Name} {ex.Message}");
            RemoteCache[cacheKey] = (DateTimeOffset.UtcNow, Empty);
            return Empty;
        }

        var stdout = result.StdOut;
        if (string.IsNullOrWhiteSpace(stdout))
        {
            RemoteCache[cacheKey] = (DateTimeOffset.UtcNow, Empty);
            return Empty;
        }

        var instructions = new List<CopilotInstruction>();
        var agents = new List<CopilotAgent>();
        var prompts = new List<CopilotPrompt>();
        var skills = new List<CopilotSkill>();

        foreach (var (relative, text) in ParseRemoteDump(stdout))
        {
            var fileName = Path.GetFileName(relative);
            // 项目内相对路径：远端工具（work_read_file 等）可直接使用
            var projectPath = $".github/{relative}";

            if (fileName.Equals("copilot-instructions.md", StringComparison.OrdinalIgnoreCase) ||
                (relative.StartsWith("instructions/", StringComparison.Ordinal) && fileName.EndsWith(".instructions.md", StringComparison.OrdinalIgnoreCase)))
            {
                instructions.Add(BuildInstruction(projectPath, projectPath, text));
            }
            else if ((relative.StartsWith("agents/", StringComparison.Ordinal) || relative.StartsWith("chatmodes/", StringComparison.Ordinal)) &&
                     fileName.EndsWith(".md", StringComparison.OrdinalIgnoreCase))
            {
                agents.Add(BuildAgent(projectPath, text, Path.GetFileNameWithoutExtension(fileName)));
            }
            else if (fileName.EndsWith(".prompt.md", StringComparison.OrdinalIgnoreCase) &&
                     (relative.StartsWith("prompts/", StringComparison.Ordinal) || !relative.Contains('/')))
            {
                prompts.Add(BuildPrompt(projectPath, text));
            }
            else if (fileName.Equals("SKILL.md", StringComparison.OrdinalIgnoreCase) &&
                     relative.StartsWith("skills/", StringComparison.Ordinal))
            {
                skills.Add(BuildSkill(projectPath, text));
            }
        }

        var assets = new CopilotAssets(instructions, agents, prompts, skills);
        RemoteCache[cacheKey] = (DateTimeOffset.UtcNow, assets);
        return assets;
    }

    /// <summary>远端扫描超时：正常 0.5s 内返回；压到 10s 是为了网络抽风时不拖垮整轮对话</summary>
    private static readonly TimeSpan RemoteScanTimeout = TimeSpan.FromSeconds(10);

    /// <summary>远端资产缓存（含失败结果）：避免每条消息都 ssh 一次</summary>
    private static readonly TimeSpan RemoteCacheTtl = TimeSpan.FromMinutes(2);

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (DateTimeOffset At, CopilotAssets Assets)> RemoteCache = new();

    /// <summary>解析远端回传的分段输出：<c>@@HETU-FILE@@相对路径</c> 起一段，段内余下内容为该文件正文。</summary>
    private static List<(string Relative, string Text)> ParseRemoteDump(string stdout)
    {
        var items = new List<(string, string)>();
        foreach (var part in stdout.Split(RemoteFileMarker, StringSplitOptions.RemoveEmptyEntries))
        {
            var newline = part.IndexOf('\n');
            if (newline < 0) continue;

            var relative = part[..newline].Trim().TrimStart('.', '/').Replace('\\', '/');
            if (relative.Length == 0) continue;

            items.Add((relative, part[(newline + 1)..].TrimEnd('\n', '\r')));
        }
        return items;
    }

    /// <summary>
    /// 把 .github 资产拼成注入 system prompt 的上下文：
    /// 指令全文注入；智能体/提示词/技能给出索引与文件路径，按需读取。
    /// </summary>
    public static string BuildContext(CopilotAssets assets, string root)
    {
        if (assets.IsEmpty) return string.Empty;

        var sb = new StringBuilder();
        sb.AppendLine("GitHub Copilot 兼容配置已从仓库 .github 目录自动加载（应视同项目规范优先遵守）：");

        if (assets.Instructions.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("### 仓库指令");
            var budget = MaxInstructionTotalChars;
            foreach (var instruction in assets.Instructions)
            {
                if (budget <= 0) break;
                var content = instruction.Content;
                var scope = !string.IsNullOrWhiteSpace(instruction.ApplyTo) ? $"（applyTo: {instruction.ApplyTo}）" : "";
                var header = $"- {instruction.Label}{scope}:";
                if (content.Length > budget)
                    content = content[..budget] + "\n…（已截断）";
                budget -= content.Length + header.Length;

                sb.AppendLine(header);
                sb.AppendLine(Indent(content));
                budget -= 200;
            }
        }

        if (assets.Agents.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("### 自定义智能体（.github/agents、.github/chatmodes）");
            sb.AppendLine("用户在下拉框选中的角色已完整注入（见「当前智能体」）；需要切换到其它角色时，用 work_read_file 读取 `.github/agents/<名字>.agent.md`（chatmode 为 `.github/chatmodes/<名字>.chatmode.md`）再按其人设执行。");
            foreach (var agent in assets.Agents)
            {
                var extras = new List<string>();
                if (!string.IsNullOrWhiteSpace(agent.Model)) extras.Add($"model: {agent.Model}");
                if (!string.IsNullOrWhiteSpace(agent.Tools)) extras.Add($"tools: {agent.Tools}");
                var extra = extras.Count > 0 ? $"（{string.Join("，", extras)}）" : "";
                sb.AppendLine($"- {agent.Name}{extra}: {Shorten(agent.Description)}");
            }
        }

        if (assets.Prompts.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("### 提示词模板（.github/prompts）");
            sb.AppendLine("用户以 /模板名 形式触发时正文会随本轮下发；需要时也可用 work_read_file 读取 `.github/prompts/<名字>.prompt.md`，严格按其中的步骤执行。");
            foreach (var prompt in assets.Prompts)
                sb.AppendLine($"- /{prompt.Name}: {Shorten(prompt.Description)}");
        }

        if (assets.Skills.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("### 仓库技能（.github/skills）");
            sb.AppendLine("任务匹配某个技能的用途时，用 work_skill(技能名) 读取完整说明，再按其中的步骤执行。");
            foreach (var skill in assets.Skills)
                sb.AppendLine($"- {skill.Name}: {Shorten(skill.Description)}");
        }

        return sb.ToString().TrimEnd();
    }

    private static string Relative(string root, string file)
    {
        try
        {
            // SSH 项目的资产路径本身就是项目内相对路径（.github/...），直接用
            if (!Path.IsPathRooted(file)) return file.Replace('\\', '/');
            return string.IsNullOrWhiteSpace(root) ? file : Path.GetRelativePath(root, file).Replace('\\', '/');
        }
        catch
        {
            return file;
        }
    }

    private static string Indent(string text)
    {
        var lines = text.Split('\n').Select(l => l.TrimEnd('\r'));
        return string.Join('\n', lines.Select(l => l.Length == 0 ? l : "  " + l));
    }

    /// <summary>资产索引里的描述压缩到一行：完整说明在文件里，索引只用于挑选（省系统提示占用）</summary>
    private static string Shorten(string? text, int maxChars = 120)
    {
        if (string.IsNullOrWhiteSpace(text)) return "";
        var oneLine = text.Replace('\r', ' ').Replace('\n', ' ').Trim();
        return oneLine.Length > maxChars ? oneLine[..maxChars] + "…" : oneLine;
    }

    private static IEnumerable<string> SafeEnumerateFiles(string dir, string searchPattern, bool recursive)
    {
        if (!Directory.Exists(dir)) return [];
        try
        {
            return Directory.EnumerateFiles(dir, searchPattern,
                recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly).ToList();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return [];
        }
    }

    private static string? ReadText(string file)
    {
        try
        {
            if (!WorkProjectRules.IsProbablyText(file)) return null;
            return File.ReadAllText(file);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    /// <summary>
    /// 解析 YAML frontmatter（--- 包裹的 key: value 行）与正文
    /// </summary>
    public static (Dictionary<string, string> Frontmatter, string Body) SplitPromptBody(string text)
        => SplitFrontmatter(text);

    private static (Dictionary<string, string> Frontmatter, string Body) SplitFrontmatter(string text)
    {
        var frontmatter = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var trimmed = text.TrimStart('\uFEFF', ' ', '\r', '\n');
        if (!trimmed.StartsWith("---")) return (frontmatter, text);

        var endIndex = trimmed.IndexOf("\n---", 3, StringComparison.Ordinal);
        if (endIndex < 0) return (frontmatter, text);

        var rawFrontmatter = trimmed[3..endIndex];
        var body = trimmed[(endIndex + 4)..];

        foreach (var line in rawFrontmatter.Split('\n'))
        {
            var trimmedLine = line.Trim();
            if (trimmedLine.Length == 0 || trimmedLine.StartsWith('#')) continue;
            var colon = trimmedLine.IndexOf(':');
            if (colon <= 0) continue;
            var key = trimmedLine[..colon].Trim();
            var value = trimmedLine[(colon + 1)..].Trim().Trim('"', '\'');
            if (key.Length > 0) frontmatter[key] = value;
        }

        return (frontmatter, body);
    }

    private static string? FirstMeaningfulLine(string body)
    {
        foreach (var line in body.Split('\n'))
        {
            var trimmed = line.Trim().TrimStart('#', '*', '-', '>').Trim();
            if (trimmed.Length == 0) continue;
            return trimmed.Length > 120 ? trimmed[..120] + "…" : trimmed;
        }
        return null;
    }
}
