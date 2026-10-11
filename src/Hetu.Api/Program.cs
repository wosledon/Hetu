using Hetu.Api.Extensions;
using Hetu.Api.Hosting;
using Hetu.Api.Seeding;
using Hetu.Api.Services;
using Hetu.Infrastructure.Data;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;
using Serilog;

var webRoot = WebRootLocator.Locate();

var builder = webRoot != null
    ? WebApplication.CreateBuilder(new WebApplicationOptions
    {
        Args = args,
        ContentRootPath = AppContext.BaseDirectory,
        WebRootPath = webRoot,
    })
    : WebApplication.CreateBuilder(args);

Console.WriteLine(webRoot != null
    ? $"[Hetu] WebRoot = {webRoot}"
    : "[Hetu] 未找到打包 wwwroot，使用默认 WebRoot（dev 模式）");

var dataDir = DataDirectoryResolver.Resolve(builder.Configuration);
Directory.CreateDirectory(dataDir);

HetuLogging.Configure(dataDir);
builder.Host.UseSerilog();

builder.Services.AddHetuWebInfrastructure();
// 只读列表接口的短时响应缓存（knowledge-base 状态/索引列表被页面反复拉取）
builder.Services.AddResponseCaching();
// 固定 DataProtection 应用判别值：默认值取自 content root（bin 目录），
// 不同检出目录/部署位置的实例无法解密彼此加密的 API Key
builder.Services.AddDataProtection(options => options.ApplicationDiscriminator = "Hetu");
var providerInfo = builder.Services.AddHetuDatabase(builder.Configuration, dataDir);
builder.Services.AddHetuDomainServices();
builder.Services.AddHetuBackgroundWorkers();
// 桌面外壳启动的后端：外壳被强杀时自行退出，避免留下占用端口/文件的孤儿进程
builder.Services.AddHostedService<ParentProcessWatchdog>();

var app = builder.Build();

app.UseSerilogRequestLogging();
app.UseResponseCompression();
app.UseResponseCaching();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
    app.UseCors("Development");
}

app.UseAuthorization();
app.UseWebSockets();
app.MapControllers();

// 健康检查端点：供桌面外壳 (Tauri shell) 轮询确认就绪
app.MapGet("/api/health", () => Results.Json(new
{
    status = "ok",
    provider = providerInfo.Provider,
    dataDir,
    version = typeof(Program).Assembly.GetName().Version?.ToString() ?? "0.0.0"
}));

// 只要检测到 index.html 就托管 SPA，避免环境变量异常导致桌面端黑屏。
var indexPath = Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "index.html");
if (File.Exists(indexPath))
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
    app.MapFallbackToFile("index.html");
}

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<HetuDbContext>();
    await db.Database.MigrateAsync();
    await PromptPresetSeeder.SeedIfEmptyAsync(db);
    await SkillSeeder.SeedIfEmptyAsync(db);
    await SqliteVecTableSynchronizer.SyncAsync(db);
}

app.Run();
