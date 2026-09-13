using Hetu.Core.Entities;
using Hetu.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Hetu.Api.Seeding;

/// <summary>
/// 首次启动时写入内置提示词预设，后续启动不再覆盖用户改动。
/// </summary>
internal static class PromptPresetSeeder
{
    public static async Task SeedIfEmptyAsync(HetuDbContext db)
    {
        if (await db.PromptPresets.AnyAsync()) return;

        var now = DateTimeOffset.UtcNow;
        var presets = new List<PromptPreset>
        {
            new()
            {
                Id = Guid.NewGuid(),
                Category = "通用",
                Name = "通用助手",
                Content = "你是一个友好的通用 AI 助手，擅长回答各种问题、提供建议和帮助用户完成任务。请用清晰、准确的语言回复。",
                IsBuiltIn = true,
                SortOrder = 1,
                CreatedAt = now,
                UpdatedAt = now
            },
            new()
            {
                Id = Guid.NewGuid(),
                Category = "通用",
                Name = "翻译专家",
                Content = "你是一个专业的多语言翻译专家。请将用户输入的内容翻译为目标语言（默认中文），保持原意、语气和专业术语的准确性。如果用户未指定目标语言，请翻译为中文。",
                IsBuiltIn = true,
                SortOrder = 2,
                CreatedAt = now,
                UpdatedAt = now
            },
            new()
            {
                Id = Guid.NewGuid(),
                Category = "写作",
                Name = "写作助手",
                Content = "你是一个专业的写作助手，擅长各种文体的写作。请帮助用户润色、优化文本，使其表达更流畅、专业，同时保持原意。提供具体的修改建议和理由。",
                IsBuiltIn = true,
                SortOrder = 3,
                CreatedAt = now,
                UpdatedAt = now
            },
            new()
            {
                Id = Guid.NewGuid(),
                Category = "编程",
                Name = "编程导师",
                Content = "你是一个经验丰富的编程导师和技术顾问。请帮助用户理解代码、调试问题、优化性能，并解释技术概念。回答时请提供清晰的代码示例和最佳实践建议。支持各种编程语言和框架。",
                IsBuiltIn = true,
                SortOrder = 4,
                CreatedAt = now,
                UpdatedAt = now
            },
            new()
            {
                Id = Guid.NewGuid(),
                Category = "分析",
                Name = "数据分析师",
                Content = "你是一个专业的数据分析师。请帮助用户分析数据、发现趋势、生成洞察。回答时请用结构化的方式呈现分析结果，包含关键指标、结论和可操作的建议。",
                IsBuiltIn = true,
                SortOrder = 5,
                CreatedAt = now,
                UpdatedAt = now
            },
            new()
            {
                Id = Guid.NewGuid(),
                Category = "创意",
                Name = "创意顾问",
                Content = "你是一个富有创造力的创意顾问，擅长头脑风暴、品牌策划和内容创意。请帮助用户激发灵感、探索新角度、提出创新方案。回答时请提供多个选项并解释每个方案的优势。",
                IsBuiltIn = true,
                SortOrder = 6,
                CreatedAt = now,
                UpdatedAt = now
            }
        };

        await db.PromptPresets.AddRangeAsync(presets);
        await db.SaveChangesAsync();
    }
}
