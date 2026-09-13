using Hetu.Api.Services;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Core.Services.Tools;
using Hetu.Core.Services.Workflows;
using Hetu.Core.Services.Workflows.NodeExecutors;
using Hetu.Infrastructure.AI;
using Hetu.Infrastructure.Background;
using Hetu.Infrastructure.Data;
using Hetu.Infrastructure.Repositories;
using Hetu.Infrastructure.ScheduledTasks;
using Hetu.Infrastructure.SemanticSearch;
using Hetu.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Pgvector.EntityFrameworkCore;

namespace Hetu.Api.Extensions;

/// <summary>
/// Hetu 服务注册入口，按关注点拆分为 Web 基础设施、数据访问、业务服务、后台任务四组。
/// </summary>
public static class HetuServiceCollectionExtensions
{
    private const string PostgresMigrationsAssembly = "Hetu.Infrastructure.PostgresMigrations";

    /// <summary>注册 Web 基础设施：控制器、JSON 约定、压缩、OpenAPI、CORS 与通用托管服务。</summary>
    public static IServiceCollection AddHetuWebInfrastructure(this IServiceCollection services)
    {
        services.AddControllers()
            .AddJsonOptions(options =>
                options.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase);

        services.AddResponseCompression(options =>
        {
            options.EnableForHttps = true;
            options.MimeTypes = Microsoft.AspNetCore.ResponseCompression.ResponseCompressionDefaults.MimeTypes
                .Concat(["application/json", "text/event-stream"]);
        });

        services.AddOpenApi();

        services.AddCors(options => options.AddPolicy("Development", policy => policy
            .AllowAnyOrigin()
            .AllowAnyMethod()
            .AllowAnyHeader()));

        services.AddHttpContextAccessor();
        services.AddDataProtection();
        services.AddHttpClient();
        services.AddMemoryCache();

        return services;
    }

    /// <summary>
    /// 注册 EF Core 上下文、迁移程序集与语义搜索策略。
    /// 返回解析后的 <see cref="DatabaseProviderInfo"/> 供健康检查等场景复用。
    /// </summary>
    public static DatabaseProviderInfo AddHetuDatabase(
        this IServiceCollection services,
        IConfiguration configuration,
        string dataDir)
    {
        var connectionString = configuration.GetConnectionString("DefaultConnection") ?? "Data Source=hetu.db";
        var provider = DatabaseProviderInfo.Normalize(configuration.GetValue<string>("DatabaseProvider"));

        // 默认 SQLite 连接字符串改写到用户数据目录
        if (provider == DatabaseProviderInfo.Sqlite && IsDefaultSqliteConnectionString(connectionString))
            connectionString = $"Data Source={Path.Combine(dataDir, "hetu.db")}";

        var providerInfo = new DatabaseProviderInfo(provider, connectionString);

        services.AddSingleton<SqliteVecInterceptor>();
        services.AddSingleton(providerInfo);

        services.AddDbContext<HetuDbContext>((sp, options) =>
        {
            if (providerInfo.IsPostgreSql)
            {
                options.UseNpgsql(connectionString, npgsql =>
                {
                    npgsql.UseVector();
                    npgsql.MigrationsAssembly(PostgresMigrationsAssembly);
                });
            }
            else
            {
                options.UseSqlite(connectionString)
                    .AddInterceptors(sp.GetRequiredService<SqliteVecInterceptor>());
            }
        });

        if (providerInfo.IsPostgreSql)
            services.AddScoped<ISemanticSearchStrategy, PostgresSemanticSearchStrategy>();
        else
            services.AddScoped<ISemanticSearchStrategy, SqliteSemanticSearchStrategy>();

        services.AddScoped<IUnitOfWork, UnitOfWork>();

        return providerInfo;
    }

    /// <summary>注册业务服务：笔记、知识库、对话、工作流、代理、MCP 与工具执行。</summary>
    public static IServiceCollection AddHetuDomainServices(this IServiceCollection services)
    {
        services.AddScoped<INotebookService, NotebookService>();
        services.AddScoped<INoteService, NoteService>();
        services.AddScoped<ITagService, TagService>();
        services.AddScoped<ISearchService, SearchService>();
        services.AddScoped<IAppSettingService, AppSettingService>();
        services.AddScoped<IAiProviderService, AiProviderService>();
        services.AddScoped<IAiModelService, AiModelService>();
        services.AddScoped<ILLMProviderFactory, LlmProviderFactory>();
        services.AddScoped<IEmbeddingProviderFactory, EmbeddingProviderFactory>();
        services.AddScoped<INoteEmbeddingService, NoteEmbeddingService>();
        services.AddScoped<IChunkService, ChunkService>();
        services.AddScoped<ISemanticSearchService, SemanticSearchService>();
        services.AddScoped<INoteVersionService, NoteVersionService>();
        services.AddScoped<INoteAiService, NoteAiService>();
        services.AddScoped<IGraphService, GraphService>();
        services.AddScoped<IShareLinkService, ShareLinkService>();
        services.AddScoped<IWebSearchService, BingWebSearchService>();
        services.AddScoped<IMemoryService, MemoryService>();
        services.AddScoped<ISkillService, SkillService>();
        services.AddScoped<ILocalSkillService, LocalSkillService>();
        services.AddScoped<IPromptPresetService, PromptPresetService>();
        services.AddScoped<ILocalPromptPresetService, LocalPromptPresetService>();
        services.AddScoped<IMcpService, McpService>();

        AddChatServices(services);
        AddProxyServices(services);
        AddWorkflowServices(services);
        AddWorkServices(services);

        services.AddScoped<IExportService>(sp => new ExportService(
            sp.GetRequiredService<IUnitOfWork>(),
            sp.GetRequiredService<DatabaseProviderInfo>()));

        services.AddSingleton<WebContentExtractor>();
        services.AddSingleton<ToolExecutionService>();
        services.AddToolExecutors();

        return services;
    }

    /// <summary>注册后台任务：队列、常驻托管服务与定时任务执行器。</summary>
    public static IServiceCollection AddHetuBackgroundWorkers(this IServiceCollection services)
    {
        services.AddSingleton<IBackgroundTaskQueue, ChannelBackgroundTaskQueue>();
        services.AddHostedService<BackgroundTaskProcessor>();
        services.AddHostedService<TrashCleanupService>();
        services.AddHostedService<AutoOrganizeService>();
        services.AddHostedService<ScheduledTaskRunner>();

        services.AddScoped<IScheduledTaskService, ScheduledTaskService>();
        services.AddScoped<IScheduledTaskExecutor, SkillScheduledTaskExecutor>();
        services.AddScoped<IScheduledTaskExecutor, AiTaskScheduledTaskExecutor>();
        services.AddScoped<IScheduledTaskExecutor, GraphRebuildScheduledTaskExecutor>();
        services.AddScoped<IScheduledTaskExecutor, EmbeddingRegenerateScheduledTaskExecutor>();

        return services;
    }

    private static void AddChatServices(IServiceCollection services)
    {
        services.AddScoped<IChatGroupService, ChatGroupService>();
        services.AddScoped<IChatTopicService, ChatTopicService>();
        services.AddScoped<IChatMessageService, ChatMessageService>();
        services.AddScoped<IChatOrganizeService, ChatOrganizeService>();
        services.AddScoped<UsageService>();
        services.AddScoped<CompressionPipelineService>();
    }

    private static void AddProxyServices(IServiceCollection services)
    {
        services.AddScoped<ModelKeyResolver>();
        services.AddScoped<ProxyRouteClassifier>();
        services.AddScoped<ProxyForwarder>();
        services.AddScoped<ProxyConfigService>();
        services.AddScoped<ProxyService>();
        services.AddScoped<ProxyUsageTracker>();
    }

    private static void AddWorkflowServices(IServiceCollection services)
    {
        services.AddSingleton<WorkflowApprovalService>();
        services.AddScoped<WorkflowExecutionEngine>();

        services.AddScoped<INodeExecutor, StartNodeExecutor>();
        services.AddScoped<INodeExecutor, AgentNodeExecutor>();
        services.AddScoped<INodeExecutor, ConditionNodeExecutor>();
        services.AddScoped<INodeExecutor, EndNodeExecutor>();
        services.AddScoped<INodeExecutor, LoopNodeExecutor>();
        services.AddScoped<INodeExecutor, ParallelNodeExecutor>();
        services.AddScoped<INodeExecutor, MergeNodeExecutor>();
        services.AddScoped<INodeExecutor, ToolNodeExecutor>();
        services.AddScoped<INodeExecutor, HumanNodeExecutor>();
        services.AddScoped<INodeExecutor, SubWorkflowNodeExecutor>();
    }

    private static void AddWorkServices(IServiceCollection services)
    {
        services.AddScoped<IWorkflowService, WorkflowService>();
        services.AddScoped<AgentLoopService>();
        services.AddScoped<IWorkProjectService, WorkProjectService>();
        services.AddScoped<IWorkSessionService, WorkSessionService>();
        services.AddSingleton<WorkTerminalManager>();
    }

    private static bool IsDefaultSqliteConnectionString(string connectionString) =>
        connectionString.Replace(" ", "").Equals("DataSource=hetu.db", StringComparison.OrdinalIgnoreCase);
}
