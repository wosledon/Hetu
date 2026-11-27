using System.Text.Json;
using System.Text.RegularExpressions;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.AI;
using Microsoft.Agents.AI;

namespace Hetu.Agents;

/// <summary>
/// 把 Hetu 的数据库技能与本地技能目录适配成 MAF AgentSkillsSource，
/// 由 AgentSkillsProvider 负责 advertise / load_skill 的渐进式披露。
/// </summary>
internal sealed class HetuAgentSkillsSource : AgentSkillsSource
{
    private const int MaxInstructionsChars = 8_000;

    private readonly IUnitOfWork _unitOfWork;
    private readonly ILocalSkillService _localSkills;
    private readonly IReadOnlyList<string> _skillIds;
    private readonly IReadOnlyList<string> _extraDirectories;
    private readonly AgentFileSkillScriptRunner? _scriptRunner;

    public HetuAgentSkillsSource(
        IUnitOfWork unitOfWork,
        ILocalSkillService localSkills,
        IReadOnlyList<string> skillIds,
        IReadOnlyList<string>? extraDirectories = null,
        AgentFileSkillScriptRunner? scriptRunner = null)
    {
        _unitOfWork = unitOfWork;
        _localSkills = localSkills;
        _skillIds = skillIds;
        _extraDirectories = extraDirectories ?? [];
        _scriptRunner = scriptRunner;
    }

    public override Task<IList<AgentSkill>> GetSkillsAsync(
        AgentSkillsSourceContext context,
        CancellationToken cancellationToken = default)
        => LoadSkillsAsync(context, cancellationToken);

    internal Task<IList<AgentSkill>> LoadSkillsAsync(CancellationToken cancellationToken = default)
        => LoadSkillsAsync(null, cancellationToken);

    internal async Task<IList<AgentSkill>> LoadSkillsAsync(
        AgentSkillsSourceContext? context,
        CancellationToken cancellationToken = default)
    {
        var requested = new HashSet<string>(_skillIds, StringComparer.OrdinalIgnoreCase);
        var configuredDirectories = (await _localSkills.GetDirectoriesAsync(cancellationToken))?.Data ?? [];
        var directories = configuredDirectories.Concat(_extraDirectories)
            .Where(Directory.Exists)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (requested.Count == 0 && directories.Count == 0) return [];

        var skills = new List<AgentSkill>();
        var usedNames = new HashSet<string>(StringComparer.Ordinal);

        if (requested.Count > 0)
        {
            var localResult = await _localSkills.ScanAllAsync(cancellationToken);
            foreach (var local in (localResult?.Data ?? []).Where(skill =>
                         skill.IsEnabled && (requested.Contains(skill.Id) || requested.Contains(skill.Name))))
            {
                var instructions = ReadLocalInstructions(local);
                Add(skills, usedNames, local.Name, local.Description, instructions);
            }

            var dbSkills = await _unitOfWork.Skills.FindAsync(skill => skill.IsEnabled, cancellationToken);
            foreach (var skill in dbSkills.Where(skill =>
                         requested.Contains(skill.Id.ToString()) || requested.Contains(skill.Name)))
            {
                Add(skills, usedNames, skill.Name, skill.Description, ReadConfigInstructions(skill.Config));
            }
        }

        if (context is not null && directories.Count > 0)
        {
            using var fileSource = new AgentFileSkillsSource(directories, _scriptRunner);
            var fileSkills = await fileSource.GetSkillsAsync(context, cancellationToken);
            foreach (var skill in fileSkills)
            {
                var name = skill.Frontmatter.Name;
                if (requested.Count > 0 && !IsRequested(requested, name)) continue;
                if (!usedNames.Add(name)) continue;
                skills.Add(skill);
            }
        }

        return skills;
    }

    private static bool IsRequested(IReadOnlySet<string> requested, string name)
        => requested.Contains(name)
           || requested.Any(id =>
               id.EndsWith(":" + name, StringComparison.OrdinalIgnoreCase)
               || id.EndsWith("/" + name, StringComparison.OrdinalIgnoreCase));

    private static void Add(
        List<AgentSkill> skills,
        HashSet<string> usedNames,
        string name,
        string description,
        string instructions)
    {
        var slug = ToSlug(name);
        var unique = slug;
        for (var i = 2; !usedNames.Add(unique); i++) unique = $"{slug}-{i}";

        var text = string.IsNullOrWhiteSpace(instructions) ? name : instructions;
        if (text.Length > MaxInstructionsChars) text = text[..MaxInstructionsChars];
        var desc = string.IsNullOrWhiteSpace(description) ? name : description;
        if (desc.Length > 1024) desc = desc[..1024];

        try
        {
            skills.Add(new AgentInlineSkill(unique, desc, text));
        }
        catch (ArgumentException)
        {
            // 名称或描述不符合 Agent Skills 规范时跳过，不影响其他技能。
        }
    }

    private static string ReadLocalInstructions(LocalSkillDto skill)
    {
        var fromConfig = ReadConfigInstructions(skill.Config);
        if (!string.IsNullOrWhiteSpace(fromConfig)) return fromConfig;

        try
        {
            return File.Exists(skill.FilePath)
                ? File.ReadAllText(skill.FilePath)
                : string.Empty;
        }
        catch (Exception)
        {
            return string.Empty;
        }
    }

    private static string ReadConfigInstructions(string? config)
    {
        if (string.IsNullOrWhiteSpace(config)) return string.Empty;
        try
        {
            using var doc = JsonDocument.Parse(config);
            var root = doc.RootElement;
            if (root.TryGetProperty("config", out var nested) && nested.ValueKind == JsonValueKind.Object)
                root = nested;

            var systemPrompt = root.TryGetProperty("systemPrompt", out var sp) && sp.ValueKind == JsonValueKind.String
                ? sp.GetString()
                : null;
            var promptTemplate = root.TryGetProperty("promptTemplate", out var pt) && pt.ValueKind == JsonValueKind.String
                ? pt.GetString()
                : null;

            return string.Join("\n\n", new[] { systemPrompt, promptTemplate }.Where(text => !string.IsNullOrWhiteSpace(text)));
        }
        catch (JsonException)
        {
            return string.Empty;
        }
    }

    private static string ToSlug(string name)
    {
        var slug = Regex.Replace(name.Trim().ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
        if (slug.Length > 64) slug = slug[..64].Trim('-');
        if (slug.Length == 0)
            slug = "skill-" + Math.Abs(StringComparer.Ordinal.GetHashCode(name)).ToString("x8");
        return slug;
    }
}