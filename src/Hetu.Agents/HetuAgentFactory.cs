using Anthropic;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using OpenAI;
using OpenAI.Chat;
using AiChatOptions = Microsoft.Extensions.AI.ChatOptions;

namespace Hetu.Agents;

/// <summary>用官方 MAF Provider 包创建 <see cref="AIAgent"/>；不经过任何自实现的 HTTP Provider。</summary>
internal sealed class HetuAgentFactory : IAgentFactory
{
    private readonly AgentModelResolver _resolver;
    private readonly ILlmUsageRecorder _usageRecorder;
    private readonly ILocalizer _localizer;
    private readonly IServiceProvider _services;
    private readonly ILoggerFactory _loggerFactory;

    public HetuAgentFactory(
        AgentModelResolver resolver,
        ILlmUsageRecorder usageRecorder,
        ILocalizer localizer,
        IServiceProvider services,
        ILoggerFactory loggerFactory)
    {
        _resolver = resolver;
        _usageRecorder = usageRecorder;
        _localizer = localizer;
        _services = services;
        _loggerFactory = loggerFactory;
    }

    public Task<ResolvedAgentModel?> ResolveAsync(Guid? modelId, CancellationToken ct)
        => _resolver.ResolveAsync(modelId, ct);

    public AIAgent Create(
        ResolvedAgentModel model,
        ChatClientAgentOptions agentOptions,
        AgentRunState state,
        int maxIterations)
    {
        var contextProviders = new List<AIContextProvider>();
        var agentProviders = new List<AIContextProvider>();
        foreach (var provider in agentOptions.AIContextProviders ?? [])
        {
            // AgentSkillsProvider 会往 ChatOptions 里加工具，必须在 FunctionInvokingChatClient 之上（agent 级）执行；
            // 其余消息类 provider 放进 chat client 管道，每次模型调用前都会执行。
            if (provider is AgentSkillsProvider) agentProviders.Add(provider);
            else contextProviders.Add(provider);
        }
        agentOptions.AIContextProviders = agentProviders.Count > 0 ? agentProviders : null;

        return model.ProviderType switch
        {
            "anthropic" => CreateAnthropicAgent(model, agentOptions, state, maxIterations, contextProviders),
            "openai" or "foundry" => CreateOpenAiAgent(model, agentOptions, state, maxIterations, contextProviders),
            _ => throw new NotSupportedException($"不支持的 Provider 类型: {model.Provider.ProviderType}"),
        };
    }

    private AIAgent CreateOpenAiAgent(
        ResolvedAgentModel model,
        ChatClientAgentOptions agentOptions,
        AgentRunState state,
        int maxIterations,
        IReadOnlyList<AIContextProvider> contextProviders)
    {
        var chatClient = CreateOpenAiClient(model).GetChatClient(model.Model.ModelId).AsIChatClient();
        var agent = BuildPipeline(chatClient, state, maxIterations, contextProviders)
            .AsAIAgent(agentOptions, loggerFactory: _loggerFactory);
        return WrapObservability(agent);
    }

    private AIAgent CreateAnthropicAgent(
        ResolvedAgentModel model,
        ChatClientAgentOptions agentOptions,
        AgentRunState state,
        int maxIterations,
        IReadOnlyList<AIContextProvider> contextProviders)
    {
        var agent = CreateAnthropicClient(model).AsAIAgent(
            agentOptions,
            clientFactory: inner => BuildPipeline(inner, state, maxIterations, contextProviders),
            loggerFactory: _loggerFactory);
        return WrapObservability(agent);
    }

    private AIAgent WrapObservability(AIAgent agent)
        => new AIAgentBuilder(agent)
            .UseOpenTelemetry("Hetu.Agents")
            .Build(_services);

    public async Task<AIAgent?> CreateTextAgentAsync(
        Guid? modelId,
        string? instructions,
        AiChatOptions? overrides,
        CancellationToken ct)
    {
        var model = await ResolveAsync(modelId, ct);
        if (model == null) return null;

        var chatOptions = overrides?.Clone() ?? new AiChatOptions();
        chatOptions.Instructions = instructions;
        chatOptions.ModelId = model.Model.ModelId;
        chatOptions.Tools = null;
        chatOptions.ToolMode = ChatToolMode.None;

        var agentOptions = new ChatClientAgentOptions
        {
            Name = "hetu-text",
            ChatOptions = chatOptions,
        };

        return model.ProviderType switch
        {
            "anthropic" => CreateAnthropicClient(model).AsAIAgent(agentOptions, loggerFactory: _loggerFactory),
            "openai" or "foundry" => CreateOpenAiClient(model)
                .GetChatClient(model.Model.ModelId)
                .AsIChatClient()
                .AsAIAgent(agentOptions, loggerFactory: _loggerFactory),
            _ => throw new NotSupportedException($"不支持的 Provider 类型: {model.Provider.ProviderType}"),
        };
    }

    private static OpenAIClient CreateOpenAiClient(ResolvedAgentModel model)
    {
        var credential = new System.ClientModel.ApiKeyCredential(
            string.IsNullOrWhiteSpace(model.ApiKey) ? "local" : model.ApiKey);
        return new OpenAIClient(credential, new OpenAIClientOptions
        {
            Endpoint = new Uri(model.BaseUrl, UriKind.Absolute),
        });
    }

    private static AnthropicClient CreateAnthropicClient(ResolvedAgentModel model)
        => new()
        {
            ApiKey = model.ApiKey,
            BaseUrl = model.Provider.BaseUrl is { Length: > 0 } ? model.BaseUrl : "https://api.anthropic.com",
        };

    private FunctionInvokingChatClient BuildPipeline(
        IChatClient innerClient,
        AgentRunState state,
        int maxIterations,
        IReadOnlyList<AIContextProvider> contextProviders)
    {
        var compression = _services.GetRequiredService<CompressionPipelineService>();
        var observer = new AgentContextChatClient(
            innerClient,
            state,
            _usageRecorder,
            compression,
            _localizer,
            _loggerFactory.CreateLogger<AgentContextChatClient>());

        IChatClient configured = observer;
        if (contextProviders.Count > 0)
        {
            configured = new ChatClientBuilder(observer)
                .UseAIContextProviders(contextProviders.ToArray())
                .Build(_services);
        }

        return new FunctionInvokingChatClient(configured, _loggerFactory)
        {
            MaximumIterationsPerRequest = Math.Max(1, maxIterations),
            MaximumConsecutiveErrorsPerRequest = 0,
            AllowConcurrentInvocation = false,
            IncludeDetailedErrors = false,
        };
    }
}