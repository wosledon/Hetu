using Microsoft.Extensions.DependencyInjection;
using Hetu.Core.Interfaces;

namespace Hetu.Core.Services.Tools;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddToolExecutors(this IServiceCollection services)
    {
        services.AddScoped<IToolExecutor, SearchNotesTool>();
        services.AddScoped<IToolExecutor, ReadNoteTool>();
        services.AddScoped<IToolExecutor, CreateNoteTool>();
        services.AddScoped<IToolExecutor, UpdateNoteTool>();
        services.AddScoped<IToolExecutor, SearchWebTool>();
        services.AddScoped<IToolExecutor, SearchMemoryTool>();
        services.AddScoped<IToolExecutor, CreateMemoryTool>();
        services.AddScoped<IToolExecutor, SearchGraphTool>();
        services.AddScoped<IToolExecutor, AskQuestionTool>();
        services.AddScoped<IToolExecutor, TodoTool>();
        services.AddScoped<IToolExecutor, RunCommandTool>();
        services.AddScoped<ToolRegistry>();
        services.AddScoped<PromptComposer>();
        return services;
    }
}
