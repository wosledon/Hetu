using Hetu.Core.Entities;
using Hetu.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Hetu.Api.Seeding;

/// <summary>
/// 首次启动时写入内置技能（翻译 / 摘要 / 解释 / 润色），后续启动不再覆盖用户改动。
/// </summary>
internal static class SkillSeeder
{
    public static async Task SeedIfEmptyAsync(HetuDbContext db)
    {
        if (await db.Skills.AnyAsync()) return;

        var now = DateTimeOffset.UtcNow;
        var skills = new List<Skill>
        {
            new()
            {
                Id = Guid.NewGuid(),
                Name = "translate",
                Description = "将输入文本翻译为中文",
                Category = "通用",
                IsBuiltIn = true,
                IsEnabled = true,
                Config = "{\"promptTemplate\":\"请将以下内容翻译为中文，保持原意和语气：\\n\\n{{input}}\",\"systemPrompt\":\"你是翻译助手。\"}",
                SortOrder = 1,
                CreatedAt = now,
                UpdatedAt = now
            },
            new()
            {
                Id = Guid.NewGuid(),
                Name = "summarize",
                Description = "为输入文本生成简洁摘要",
                Category = "通用",
                IsBuiltIn = true,
                IsEnabled = true,
                Config = "{\"promptTemplate\":\"请为以下内容生成一段简洁的摘要（200字以内）：\\n\\n{{input}}\",\"systemPrompt\":\"你是摘要助手，擅长提炼要点。\"}",
                SortOrder = 2,
                CreatedAt = now,
                UpdatedAt = now
            },
            new()
            {
                Id = Guid.NewGuid(),
                Name = "explain",
                Description = "解释代码或概念",
                Category = "编程",
                IsBuiltIn = true,
                IsEnabled = true,
                Config = "{\"promptTemplate\":\"请解释以下内容的功能、主要逻辑和注意事项：\\n\\n{{input}}\",\"systemPrompt\":\"你是技术解释助手，擅长用清晰的语言解释代码和概念。\"}",
                SortOrder = 3,
                CreatedAt = now,
                UpdatedAt = now
            },
            new()
            {
                Id = Guid.NewGuid(),
                Name = "polish",
                Description = "润色和优化文本表达",
                Category = "写作",
                IsBuiltIn = true,
                IsEnabled = true,
                Config = "{\"promptTemplate\":\"请润色以下文字，使其表达更流畅、专业，同时保持原意：\\n\\n{{input}}\",\"systemPrompt\":\"你是写作助手，擅长优化文本表达。\"}",
                SortOrder = 4,
                CreatedAt = now,
                UpdatedAt = now
            }
        };

        await db.Skills.AddRangeAsync(skills);
        await db.SaveChangesAsync();
    }
}
