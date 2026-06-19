using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Infrastructure.AI;
using Hetu.Infrastructure.Background;
using Hetu.Infrastructure.Data;
using Hetu.Infrastructure.Repositories;
using Hetu.Infrastructure.SemanticSearch;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Pgvector.EntityFrameworkCore;
using Scalar.AspNetCore;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Debug()
    .MinimumLevel.Override("Microsoft", Serilog.Events.LogEventLevel.Information)
    .Enrich.FromLogContext()
    .WriteTo.Console()
    .WriteTo.File("logs/hetu-.log", rollingInterval: RollingInterval.Day, retainedFileCountLimit: 7)
    .CreateLogger();

builder.Host.UseSerilog();

builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    });

builder.Services.AddOpenApi();

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection") ?? "Data Source=hetu.db";
var databaseProvider = builder.Configuration.GetValue<string>("DatabaseProvider")?.ToLowerInvariant() ?? "sqlite";

builder.Services.AddSingleton<SqliteVecInterceptor>();

builder.Services.AddDbContext<HetuDbContext>((sp, options) =>
{
    if (databaseProvider == "postgresql" || databaseProvider == "postgres")
    {
        options.UseNpgsql(connectionString, npgsql =>
        {
            npgsql.UseVector();
            npgsql.MigrationsAssembly("Hetu.Infrastructure.PostgresMigrations");
        });
    }
    else
    {
        options.UseSqlite(connectionString)
            .AddInterceptors(sp.GetRequiredService<SqliteVecInterceptor>());
    }
});

builder.Services.AddSingleton(new DatabaseProviderInfo(databaseProvider, connectionString));

if (databaseProvider == "postgresql" || databaseProvider == "postgres")
{
    builder.Services.AddScoped<ISemanticSearchStrategy, PostgresSemanticSearchStrategy>();
}
else
{
    builder.Services.AddScoped<ISemanticSearchStrategy, SqliteSemanticSearchStrategy>();
}

builder.Services.AddScoped<IUnitOfWork, UnitOfWork>();
builder.Services.AddScoped<INotebookService, NotebookService>();
builder.Services.AddScoped<INoteService, NoteService>();
builder.Services.AddScoped<ITagService, TagService>();
builder.Services.AddScoped<ISearchService, SearchService>();
builder.Services.AddScoped<IAppSettingService, AppSettingService>();
builder.Services.AddScoped<IAiProviderService, AiProviderService>();
builder.Services.AddScoped<IAiModelService, AiModelService>();
builder.Services.AddScoped<ILLMProviderFactory, LlmProviderFactory>();
builder.Services.AddScoped<IEmbeddingProviderFactory, EmbeddingProviderFactory>();
builder.Services.AddScoped<INoteEmbeddingService, NoteEmbeddingService>();
builder.Services.AddScoped<ISemanticSearchService, SemanticSearchService>();
builder.Services.AddScoped<IChatGroupService, ChatGroupService>();
builder.Services.AddScoped<IChatTopicService, ChatTopicService>();
builder.Services.AddScoped<IChatMessageService, ChatMessageService>();
builder.Services.AddScoped<IChatOrganizeService, ChatOrganizeService>();
builder.Services.AddScoped<IPromptPresetService, PromptPresetService>();
builder.Services.AddScoped<INoteVersionService, NoteVersionService>();
builder.Services.AddScoped<ISkillService, SkillService>();
builder.Services.AddScoped<IMcpService, McpService>();
builder.Services.AddScoped<IExportService>(sp =>
{
    var unitOfWork = sp.GetRequiredService<IUnitOfWork>();
    var providerInfo = sp.GetRequiredService<DatabaseProviderInfo>();
    return new Hetu.Infrastructure.Services.ExportService(unitOfWork, providerInfo);
});
builder.Services.AddScoped<INoteAiService, NoteAiService>();
builder.Services.AddScoped<IGraphService, GraphService>();
builder.Services.AddScoped<IShareLinkService, ShareLinkService>();
builder.Services.AddHttpContextAccessor();

builder.Services.AddDataProtection();
builder.Services.AddHttpClient();
builder.Services.AddHostedService<TrashCleanupService>();
builder.Services.AddHostedService<AutoOrganizeService>();

builder.Services.AddCors(options =>
{
    options.AddPolicy("Development", policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});

var app = builder.Build();

app.UseSerilogRequestLogging();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
    app.UseCors("Development");
}

app.UseAuthorization();
app.MapControllers();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<HetuDbContext>();
    await db.Database.MigrateAsync();
    await SeedPromptPresetsAsync(db);
    await SeedSkillsAsync(db);
}

app.Run();

static async Task SeedPromptPresetsAsync(HetuDbContext db)
{
    if (await db.PromptPresets.AnyAsync()) return;

    var now = DateTimeOffset.UtcNow;
    var presets = new List<PromptPreset>
    {
        new()
        {
            Id = Guid.NewGuid(),
            Category = "通用",
            Name = "翻译助手",
            Content = "请将以下内容翻译为中文，保持原意和语气：\n\n{{text}}",
            Variables = "[\"text\"]",
            IsBuiltIn = true,
            SortOrder = 1,
            CreatedAt = now,
            UpdatedAt = now
        },
        new()
        {
            Id = Guid.NewGuid(),
            Category = "通用",
            Name = "语法修正",
            Content = "请修正以下文本中的语法和表达问题，只输出修改后的文本：\n\n{{text}}",
            Variables = "[\"text\"]",
            IsBuiltIn = true,
            SortOrder = 2,
            CreatedAt = now,
            UpdatedAt = now
        },
        new()
        {
            Id = Guid.NewGuid(),
            Category = "写作",
            Name = "头脑风暴",
            Content = "请围绕以下主题进行头脑风暴，列出 5-10 个相关的观点、角度或创意：\n\n{{text}}",
            Variables = "[\"text\"]",
            IsBuiltIn = true,
            SortOrder = 3,
            CreatedAt = now,
            UpdatedAt = now
        },
        new()
        {
            Id = Guid.NewGuid(),
            Category = "写作",
            Name = "润色优化",
            Content = "请润色以下文字，使其表达更流畅、专业，同时保持原意：\n\n{{text}}",
            Variables = "[\"text\"]",
            IsBuiltIn = true,
            SortOrder = 4,
            CreatedAt = now,
            UpdatedAt = now
        },
        new()
        {
            Id = Guid.NewGuid(),
            Category = "编程",
            Name = "代码解释",
            Content = "请解释以下代码的功能、主要逻辑和注意事项：\n\n```\n{{text}}\n```",
            Variables = "[\"text\"]",
            IsBuiltIn = true,
            SortOrder = 5,
            CreatedAt = now,
            UpdatedAt = now
        }
    };

    await db.PromptPresets.AddRangeAsync(presets);
    await db.SaveChangesAsync();
}

static async Task SeedSkillsAsync(HetuDbContext db)
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
