using System.Text;
using System.Text.Json;

namespace Hetu.Core.Services.Tools;

/// <summary>
/// GitHub Copilot 资产加载：解析项目 <c>.github</c> 目录下的
/// 指令（copilot-instructions.md / instructions/*.instructions.md）、
/// 提示词模板（prompts/*.prompt.md）、自定义智能体（agents/*.agent.md、chatmodes/*.chatmode.md）
/// 与技能（skills/**/SKILL.md），供 Work 编码 Agent 自动加载使用。
/// </summary>
public static class WorkCopilotAssets
{
    public sealed record CopilotInstruction(string Label, string FilePath, string Content, string? Description, string? ApplyTo);
    public sealed record CopilotAgent(string Name, string Description, string? Model, string? Tools, string FilePath, string Body);
    public sealed record CopilotPrompt(string Name, string Description, string FilePath);
    public sealed record CopilotSkill(string Name, string Description, string FilePath);

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

    private static readonly string[] AgentExtensions = { ".agent.md", ".chatmode.md", ".md" };

    /// <summary>扫描项目根目录下的 .github 资产；目录不存在时返回空集合。</summary>
    public static CopilotAssets Load(string root)
    {
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root)) return Empty;

        var githubDir = Path.Combine(root, ".github");
        if (!Directory.Exists(githubDir)) return Empty;

        var instructions = LoadInstructions(githubDir);
        var agents = LoadAgents(githubDir);
        var prompts = LoadPrompts(githubDir);
        var skills = LoadSkills(githubDir);
        return new CopilotAssets(instructions, agents, prompts, skills);
    }

    public static readonly CopilotAssets Empty = new([], [], [], []);

    private static List<CopilotInstruction> LoadInstructions(string githubDir)
    {
        var files = new List<string>();

        var rootInstructions = Path.Combine(githubDir, "copilot-instructions.md");
        if (File.Exists(rootInstructions)) files.Add(rootInstructions);

        foreach (var file in SafeEnumerateFiles(Path.Combine(githubDir, "instructions"), "*.instructions.md", recursive: true))
            files.Add(file);

        var result = new List<CopilotInstruction>();
        foreach (var file in files)
        {
            var text = ReadText(file);
            if (text == null) continue;

            var (frontmatter, body) = SplitFrontmatter(text);
            var description = frontmatter.GetValueOrDefault("description");
            var applyTo = frontmatter.GetValueOrDefault("applyTo");
            var label = Path.GetRelativePath(Directory.GetParent(githubDir)!.FullName, file).Replace('\\', '/');

            var content = string.IsNullOrWhiteSpace(body) ? text.Trim() : body.Trim();
            if (content.Length > MaxInstructionChars)
                content = content[..MaxInstructionChars] + "\n…（指令过长已截断，完整文件见系统提示中的路径）";

            result.Add(new CopilotInstruction(label, file, content, description, applyTo));
        }
        return result;
    }

    private static List<CopilotAgent> LoadAgents(string githubDir)
    {
        var files = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var dir in new[] { Path.Combine(githubDir, "agents"), Path.Combine(githubDir, "chatmodes") })
        {
            if (!Directory.Exists(dir)) continue;
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

            var (frontmatter, body) = SplitFrontmatter(text);
            var name = frontmatter.GetValueOrDefault("name") ?? Path.GetFileNameWithoutExtension(file);
            if (name.EndsWith(".agent", StringComparison.OrdinalIgnoreCase)) name = name[..^".agent".Length];
            if (name.EndsWith(".chatmode", StringComparison.OrdinalIgnoreCase)) name = name[..^".chatmode".Length];

            var description = frontmatter.GetValueOrDefault("description")
                ?? FirstMeaningfulLine(body)
                ?? "仓库自定义智能体";

            if (body.Length > MaxAgentBodyChars)
                body = body[..MaxAgentBodyChars] + "\n…（人设过长已截断）";

            result.Add(new CopilotAgent(
                name,
                description,
                frontmatter.GetValueOrDefault("model"),
                frontmatter.GetValueOrDefault("tools"),
                file,
                body.Trim()));
        }
        return result;
    }

    private static List<CopilotPrompt> LoadPrompts(string githubDir)
    {
        var files = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in SafeEnumerateFiles(githubDir, "*.prompt.md", recursive: false)
            .Concat(SafeEnumerateFiles(Path.Combine(githubDir, "prompts"), "*.prompt.md", recursive: true)))
        {
            if (seen.Add(file)) files.Add(file);
        }

        var result = new List<CopilotPrompt>();
        foreach (var file in files)
        {
            var text = ReadText(file);
            if (text == null) continue;

            var (frontmatter, body) = SplitFrontmatter(text);
            var name = Path.GetFileNameWithoutExtension(Path.GetFileNameWithoutExtension(file));
            var description = frontmatter.GetValueOrDefault("description") ?? FirstMeaningfulLine(body) ?? "仓库提示词模板";
            result.Add(new CopilotPrompt(name, description, file));
        }
        return result;
    }

    private static List<CopilotSkill> LoadSkills(string githubDir)
    {
        var files = SafeEnumerateFiles(Path.Combine(githubDir, "skills"), "SKILL.md", recursive: true);

        var result = new List<CopilotSkill>();
        foreach (var file in files)
        {
            var text = ReadText(file);
            if (text == null) continue;

            var (frontmatter, _) = SplitFrontmatter(text);
            var name = frontmatter.GetValueOrDefault("name") ?? new DirectoryInfo(Path.GetDirectoryName(file)!).Name;
            var description = frontmatter.GetValueOrDefault("description") ?? "仓库技能";
            result.Add(new CopilotSkill(name, description, file));
        }
        return result;
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
            sb.AppendLine("当用户要求切换到某个角色（如「用 planner 身份」「以测试专家视角」）或任务明显匹配某个智能体职责时，先用 work_read_file 读取对应文件并按其人设执行；也可直接按用户在下拉框中选择的角色行动。");
            foreach (var agent in assets.Agents)
            {
                var extras = new List<string>();
                if (!string.IsNullOrWhiteSpace(agent.Model)) extras.Add($"model: {agent.Model}");
                if (!string.IsNullOrWhiteSpace(agent.Tools)) extras.Add($"tools: {agent.Tools}");
                var extra = extras.Count > 0 ? $"（{string.Join("，", extras)}）" : "";
                sb.AppendLine($"- {agent.Name}{extra}: {agent.Description} [文件: {Relative(root, agent.FilePath)}]");
            }
        }

        if (assets.Prompts.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("### 提示词模板（.github/prompts）");
            sb.AppendLine("用户以 /模板名 形式触发（如 /review、/explain）时，先用 work_read_file 读取对应文件，严格按其中的步骤执行。");
            foreach (var prompt in assets.Prompts)
                sb.AppendLine($"- /{prompt.Name}: {prompt.Description} [文件: {Relative(root, prompt.FilePath)}]");
        }

        if (assets.Skills.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("### 仓库技能（.github/skills）");
            sb.AppendLine("任务匹配某个技能的用途时，先用 work_read_file 读取对应 SKILL.md，再按其中的步骤执行。");
            foreach (var skill in assets.Skills)
                sb.AppendLine($"- {skill.Name}: {skill.Description} [文件: {Relative(root, skill.FilePath)}]");
        }

        return sb.ToString().TrimEnd();
    }

    private static string Relative(string root, string file)
    {
        try
        {
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
