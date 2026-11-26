using Hetu.Core.Interfaces;
using Microsoft.Extensions.DependencyInjection;

namespace Hetu.Agents;

public static class ServiceCollectionExtensions
{
    /// <summary>注册基于 Microsoft Agent Framework 的 Agent 运行时。</summary>
    public static IServiceCollection AddHetuAgents(this IServiceCollection services)
    {
        services.AddScoped<AgentModelResolver>();
        services.AddScoped<IAgentFactory, HetuAgentFactory>();
        services.AddScoped<IAgentRunner, HetuAgentRunner>();
        return services;
    }
}