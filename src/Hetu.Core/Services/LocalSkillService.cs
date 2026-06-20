using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Shared.AI;
using Hetu.Shared.Common;
using Microsoft.Extensions.Logging;

namespace Hetu.Core.Services;

public class LocalSkillService : ILocalSkillService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILogger<LocalSkillService> _logger;
    private const string SettingKey = "SkillDirectories";

    public LocalSkillService(IUnitOfWork unitOfWork, ILogger<LocalSkillService> logger)
    {
        _unitOfWork = unitOfWork;
        _logger = logger;
    }

    public async Task<ApiResponse<List<LocalSkillDto>>> ScanAllAsync(CancellationToken cancellationToken = default)
    {
        var directories = await GetConfiguredDirectoriesAsync(cancellationToken);
        var skills = new List<LocalSkillDto>();

        foreach (var dir in directories)
        {
            if (!Directory.Exists(dir))
            {
                _logger.LogWarning("技能目录不存在: {Dir}", dir);
                continue;
            }

            try
            {
                var found = ScanDirectory(dir);
                skills.AddRange(found);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "扫描技能目录失败: {Dir}", dir);
            }
        }

        return ApiResponse<List<LocalSkillDto>>.Ok(skills);
    }

    public async Task<ApiResponse<List<string>>> GetDirectoriesAsync(CancellationToken cancellationToken = default)
    {
        var directories = await GetConfiguredDirectoriesAsync(cancellationToken);
        return ApiResponse<List<string>>.Ok(directories);
    }

    public async Task<ApiResponse> UpdateDirectoriesAsync(List<string> directories, CancellationToken cancellationToken = default)
    {
        var json = JsonSerializer.Serialize(directories);
        await _unitOfWork.AppSettings.SetAsync(new Entities.AppSetting
        {
            Key = SettingKey,
            Value = json,
            UpdatedAt = DateTimeOffset.UtcNow
        }, cancellationToken);

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return ApiResponse.Ok();
    }

    private async Task<List<string>> GetConfiguredDirectoriesAsync(CancellationToken cancellationToken)
    {
        var setting = await _unitOfWork.AppSettings.GetByKeyAsync(SettingKey, cancellationToken);
        if (setting?.Value == null) return [];

        try
        {
            var dirs = JsonSerializer.Deserialize<List<string>>(setting.Value) ?? [];
            // 展开 ~ 为用户主目录
            return dirs.Select(ExpandPath).ToList();
        }
        catch
        {
            return [];
        }
    }

    private static string TrimQuotes(string s)
    {
        if (s.Length >= 2 && ((s[0] == '"' && s[^1] == '"') || (s[0] == '\'' && s[^1] == '\'')))
            return s[1..^1];
        return s;
    }

    private static string ExpandPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return path;
        if (path.StartsWith("~/") || path == "~")
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return path == "~" ? home : Path.Combine(home, path[2..]);
        }
        return path;
    }

    private static List<LocalSkillDto> ScanDirectory(string baseDir)
    {
        var skills = new List<LocalSkillDto>();

        // 策略1: 每个子文件夹是一个技能，包含 skill.json
        foreach (var subDir in Directory.GetDirectories(baseDir))
        {
            var skillJsonPath = Path.Combine(subDir, "skill.json");
            if (File.Exists(skillJsonPath))
            {
                var skill = LoadSkillFromFile(skillJsonPath, subDir);
                if (skill != null) skills.Add(skill);
                continue;
            }

            // 也支持 SKILL.md（frontmatter 格式）
            var skillMdPath = Path.Combine(subDir, "SKILL.md");
            if (File.Exists(skillMdPath))
            {
                var skill = LoadSkillFromMarkdown(skillMdPath, subDir);
                if (skill != null) skills.Add(skill);
            }
        }

        // 策略2: 根目录下的 .json 文件直接作为技能
        foreach (var file in Directory.GetFiles(baseDir, "*.json"))
        {
            var skill = LoadSkillFromFile(file, baseDir);
            if (skill != null) skills.Add(skill);
        }

        return skills;
    }

    private static LocalSkillDto? LoadSkillFromFile(string filePath, string skillDir)
    {
        try
        {
            var json = File.ReadAllText(filePath);
            var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            var name = root.TryGetProperty("name", out var n) ? n.GetString() : Path.GetFileNameWithoutExtension(filePath);
            var description = root.TryGetProperty("description", out var d) ? d.GetString() ?? "" : "";
            var category = root.TryGetProperty("category", out var c) ? c.GetString() ?? "本地" : "本地";

            string? config = null;
            if (root.TryGetProperty("config", out var cfg))
            {
                config = cfg.GetRawText();
            }
            else if (root.TryGetProperty("promptTemplate", out _))
            {
                // 兼容顶层直接写 promptTemplate 的格式
                config = root.GetRawText();
            }

            return new LocalSkillDto
            {
                Id = $"local:{skillDir}:{name}",
                Name = name ?? "unknown",
                Description = description,
                Category = category,
                IsEnabled = true,
                Config = config,
                FilePath = filePath,
                Source = "local"
            };
        }
        catch
        {
            return null;
        }
    }

    private static LocalSkillDto? LoadSkillFromMarkdown(string filePath, string skillDir)
    {
        try
        {
            var content = File.ReadAllText(filePath);

            // 简单解析 frontmatter: ---\nkey: value\n---\n
            if (!content.StartsWith("---")) return null;

            var endIndex = content.IndexOf("---", 3, StringComparison.Ordinal);
            if (endIndex < 0) return null;

            var frontmatter = content[3..endIndex].Trim();
            var body = content[(endIndex + 3)..].Trim();

            var name = Path.GetFileName(skillDir);
            var description = "";
            var category = "本地";

            foreach (var line in frontmatter.Split('\n'))
            {
                var colonIdx = line.IndexOf(':');
                if (colonIdx < 0) continue;
                var key = line[..colonIdx].Trim().ToLowerInvariant();
                var value = TrimQuotes(line[(colonIdx + 1)..].Trim());

                switch (key)
                {
                    case "name": name = value; break;
                    case "description": description = value; break;
                    case "category": category = value; break;
                }
            }

            var config = JsonSerializer.Serialize(new
            {
                promptTemplate = body.Contains("{{input}}") ? body : $"请处理以下内容：\n\n{{{{input}}}}\n\n参考指令：\n{body}",
                systemPrompt = $"你是一个{name}助手。{description}"
            });

            return new LocalSkillDto
            {
                Id = $"local:{skillDir}:{name}",
                Name = name ?? "unknown",
                Description = description,
                Category = category,
                IsEnabled = true,
                Config = config,
                FilePath = filePath,
                Source = "local"
            };
        }
        catch
        {
            return null;
        }
    }
}
