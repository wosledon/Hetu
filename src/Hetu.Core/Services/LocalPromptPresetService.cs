using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;
using Microsoft.Extensions.Logging;

namespace Hetu.Core.Services;

public class LocalPromptPresetService : ILocalPromptPresetService
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly ILogger<LocalPromptPresetService> _logger;
    private const string SettingKey = "PromptPresetDirectories";

    public LocalPromptPresetService(IUnitOfWork unitOfWork, ILogger<LocalPromptPresetService> logger)
    {
        _unitOfWork = unitOfWork;
        _logger = logger;
    }

    public async Task<ApiResponse<List<LocalPromptPresetDto>>> ScanAllAsync(CancellationToken cancellationToken = default)
    {
        var directories = await GetConfiguredDirectoriesAsync(cancellationToken);
        var presets = new List<LocalPromptPresetDto>();

        foreach (var dir in directories)
        {
            if (!Directory.Exists(dir))
            {
                _logger.LogWarning("智能体目录不存在: {Dir}", dir);
                continue;
            }

            try
            {
                var found = ScanDirectory(dir);
                presets.AddRange(found);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "扫描智能体目录失败: {Dir}", dir);
            }
        }

        return ApiResponse<List<LocalPromptPresetDto>>.Ok(presets);
    }

    public async Task<ApiResponse<List<string>>> GetDirectoriesAsync(CancellationToken cancellationToken = default)
    {
        var directories = await GetConfiguredDirectoriesAsync(cancellationToken);
        return ApiResponse<List<string>>.Ok(directories);
    }

    public async Task<ApiResponse> UpdateDirectoriesAsync(List<string> directories, CancellationToken cancellationToken = default)
    {
        var json = JsonSerializer.Serialize(directories ?? new List<string>());
        await _unitOfWork.AppSettings.SetAsync(new AppSetting
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

    private static List<LocalPromptPresetDto> ScanDirectory(string baseDir)
    {
        var presets = new List<LocalPromptPresetDto>();

        // 策略1: 每个子文件夹是一个智能体，包含 agent.json
        foreach (var subDir in Directory.GetDirectories(baseDir))
        {
            var agentJsonPath = Path.Combine(subDir, "agent.json");
            if (File.Exists(agentJsonPath))
            {
                var preset = LoadFromFile(agentJsonPath, subDir);
                if (preset != null) presets.Add(preset);
                continue;
            }

            // 也支持 AGENT.md（frontmatter 格式，正文作为 System Prompt）
            var agentMdPath = Path.Combine(subDir, "AGENT.md");
            if (File.Exists(agentMdPath))
            {
                var preset = LoadFromMarkdown(agentMdPath, subDir);
                if (preset != null) presets.Add(preset);
            }
        }

        // 策略2: 根目录下的 .json 文件直接作为智能体
        foreach (var file in Directory.GetFiles(baseDir, "*.json"))
        {
            var preset = LoadFromFile(file, baseDir);
            if (preset != null) presets.Add(preset);
        }

        return presets;
    }

    private static LocalPromptPresetDto? LoadFromFile(string filePath, string presetDir)
    {
        try
        {
            var json = File.ReadAllText(filePath);
            var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            var name = root.TryGetProperty("name", out var n) ? n.GetString() : Path.GetFileNameWithoutExtension(filePath);
            var category = root.TryGetProperty("category", out var c) ? c.GetString() ?? "本地" : "本地";
            var content = root.TryGetProperty("content", out var ct) ? ct.GetString() ?? "" : "";
            var description = root.TryGetProperty("description", out var d) ? d.GetString() : null;
            var variables = root.TryGetProperty("variables", out var v) ? v.GetString() : null;
            string? toolsConfig = null;
            if (root.TryGetProperty("toolsConfig", out var tc))
            {
                toolsConfig = tc.ValueKind == JsonValueKind.String ? tc.GetString() : tc.GetRawText();
            }

            if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(content))
                return null;

            return new LocalPromptPresetDto
            {
                Id = $"local:{presetDir}:{name}",
                Name = name,
                Category = category,
                Content = content,
                Description = description,
                Variables = variables,
                ToolsConfig = toolsConfig,
                IsEnabled = true,
                FilePath = filePath,
                Source = "local"
            };
        }
        catch
        {
            return null;
        }
    }

    private static LocalPromptPresetDto? LoadFromMarkdown(string filePath, string presetDir)
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

            var name = Path.GetFileName(presetDir);
            var category = "本地";
            string? description = null;

            foreach (var line in frontmatter.Split('\n'))
            {
                var colonIdx = line.IndexOf(':');
                if (colonIdx < 0) continue;
                var key = line[..colonIdx].Trim().ToLowerInvariant();
                var value = TrimQuotes(line[(colonIdx + 1)..].Trim());

                switch (key)
                {
                    case "name": name = value; break;
                    case "category": category = value; break;
                    case "description": description = value; break;
                }
            }

            if (string.IsNullOrWhiteSpace(body)) return null;

            return new LocalPromptPresetDto
            {
                Id = $"local:{presetDir}:{name}",
                Name = name,
                Category = category,
                Content = body,
                Description = description,
                IsEnabled = true,
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
