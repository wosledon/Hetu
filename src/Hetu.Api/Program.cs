using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Infrastructure.AI;
using Hetu.Infrastructure.Background;
using Hetu.Infrastructure.Data;
using Hetu.Infrastructure.Repositories;
using Hetu.Infrastructure.SemanticSearch;
using Hetu.Infrastructure.Services;
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

builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.MimeTypes = Microsoft.AspNetCore.ResponseCompression.ResponseCompressionDefaults.MimeTypes.Concat(
        new[] { "application/json", "text/event-stream" });
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
builder.Services.AddScoped<IChunkService, ChunkService>();
builder.Services.AddScoped<ISemanticSearchService, SemanticSearchService>();
builder.Services.AddScoped<IChatGroupService, ChatGroupService>();
builder.Services.AddScoped<IChatTopicService, ChatTopicService>();
builder.Services.AddScoped<IChatMessageService, ChatMessageService>();
builder.Services.AddScoped<IChatOrganizeService, ChatOrganizeService>();
builder.Services.AddScoped<IPromptPresetService, PromptPresetService>();
builder.Services.AddScoped<INoteVersionService, NoteVersionService>();
builder.Services.AddScoped<ISkillService, SkillService>();
builder.Services.AddScoped<ILocalSkillService, LocalSkillService>();
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
builder.Services.AddScoped<IWebSearchService, BingWebSearchService>();
builder.Services.AddScoped<IMemoryService, MemoryService>();
builder.Services.AddHttpContextAccessor();

builder.Services.AddDataProtection();
builder.Services.AddHttpClient();
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<WebContentExtractor>();
builder.Services.AddSingleton<IBackgroundTaskQueue, ChannelBackgroundTaskQueue>();
builder.Services.AddHostedService<BackgroundTaskProcessor>();
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

app.UseResponseCompression();

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
    await SyncVecTablesAsync(db);
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

static async Task SyncVecTablesAsync(HetuDbContext db)
{
    try
    {
        var connection = db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
            await connection.OpenAsync();

        // 检查 vec 表是否存在
        await using var checkCmd = connection.CreateCommand();
        checkCmd.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE name = 'vec_note_embeddings' AND type = 'table'";
        var exists = await checkCmd.ExecuteScalarAsync();
        if (exists is not long count || count == 0) return;

        // 同步 NoteEmbeddings → vec_note_embeddings
        var embeddings = await db.NoteEmbeddings.AsNoTracking().ToListAsync();
        foreach (var emb in embeddings)
        {
            try
            {
                var floats = new float[emb.Embedding.Length / 4];
                for (int i = 0; i < floats.Length; i++)
                    floats[i] = BitConverter.ToSingle(emb.Embedding, i * 4);

                var vectorText = $"[{string.Join(",", floats)}]";
                await using var cmd = connection.CreateCommand();
                cmd.CommandText = $"INSERT OR REPLACE INTO vec_note_embeddings (note_id, embedding) VALUES ('{emb.NoteId}', '{vectorText}')";
                await cmd.ExecuteNonQueryAsync();
            }
            catch
            {
                // 单条失败不影响其他
            }
        }

        // 同步 NoteChunkEmbeddings → vec_chunk_embeddings
        await using var chunkCheckCmd = connection.CreateCommand();
        chunkCheckCmd.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE name = 'vec_chunk_embeddings' AND type = 'table'";
        var chunkExists = await chunkCheckCmd.ExecuteScalarAsync();
        if (chunkExists is long cc && cc > 0)
        {
            var chunkEmbeddings = await db.NoteChunkEmbeddings.AsNoTracking().ToListAsync();
            foreach (var cemb in chunkEmbeddings)
            {
                try
                {
                    var floats = new float[cemb.Embedding.Length / 4];
                    for (int i = 0; i < floats.Length; i++)
                        floats[i] = BitConverter.ToSingle(cemb.Embedding, i * 4);

                    var vectorText = $"[{string.Join(",", floats)}]";
                    await using var cmd = connection.CreateCommand();
                    cmd.CommandText = $"INSERT OR REPLACE INTO vec_chunk_embeddings (chunk_id, embedding) VALUES ('{cemb.ChunkId}', '{vectorText}')";
                    await cmd.ExecuteNonQueryAsync();
                }
                catch
                {
                    // 单条失败不影响其他
                }
            }
        }
    }
    catch
    {
        // vec 表不可用时忽略，搜索会回退到内存计算
    }
}
