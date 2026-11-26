using Anthropic;
using Hetu.Core.Services;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using OpenAI;
using OpenAI.Chat;

namespace Hetu.Agents;

/// <summary>用官方 MAF Provider 包创建 <see cref="AIAgent"/>；不经过任何自实现的 HTTP Provider。</summary>
internal sealed class HetuAgentFactory : IAgentFactory
{
    private readonly AgentModelResolver _resolver;
    private readonly ILlmUsageRecorder _usageRecorder;
    private readonly ILoggerFactory _loggerFactory;

    public HetuAgentFactory(AgentModelResolver resolver, ILlmUsageRecorder usageRecorder, ILoggerFactory loggerFactory)
    {
        _resolver = resolver;
        _usageRecorder = usageRecorder;
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
        return model.ProviderType switch
        {
            "anthropic" => CreateAnthropicAgent(model, agentOptions, state, maxIterations),
            "openai" or "foundry" => CreateOpenAiAgent(model, agentOptions, state, maxIterations),
            _ => throw new NotSupportedException($"不支持的 Provider 类型: {model.Provider.ProviderType}"),
        };
    }

    private AIAgent CreateOpenAiAgent(
        ResolvedAgentModel model,
        ChatClientAgentOptions agentOptions,
        AgentRunState state,
        int maxIterations)
    {
        var credential = new System.ClientModel.ApiKeyCredential(
            string.IsNullOrWhiteSpace(model.ApiKey) ? "local" : model.ApiKey);
        var client = new OpenAIClient(credential, new OpenAIClientOptions
        {
            Endpoint = new Uri(model.BaseUrl, UriKind.Absolute),
        });
        var chatClient = client.GetChatClient(model.Model.ModelId).AsIChatClient();
        return BuildPipeline(chatClient, state, maxIterations)
            .AsAIAgent(agentOptions, loggerFactory: _loggerFactory);
    }

    private AIAgent CreateAnthropicAgent(
        ResolvedAgentModel model,
        ChatClientAgentOptions agentOptions,
        AgentRunState state,
        int maxIterations)
    {
        var client = new AnthropicClient
        {
            ApiKey = model.ApiKey,
            BaseUrl = model.Provider.BaseUrl is { Length: > 0 } ? model.BaseUrl : "https://api.anthropic.com",
        };

        return client.AsAIAgent(
            agentOptions,
            clientFactory: inner => BuildPipeline(inner, state, maxIterations),
            loggerFactory: _loggerFactory);
    }

    private FunctionInvokingChatClient BuildPipeline(
        IChatClient innerClient,
        AgentRunState state,
        int maxIterations)
    {
        var observer = new AgentContextChatClient(
            innerClient,
            state,
            _usageRecorder,
            _loggerFactory.CreateLogger<AgentContextChatClient>());

        return new FunctionInvokingChatClient(observer, _loggerFactory)
        {
            MaximumIterationsPerRequest = Math.Max(1, maxIterations),
            MaximumConsecutiveErrorsPerRequest = 0,
            AllowConcurrentInvocation = false,
            IncludeDetailedErrors = false,
        };
    }
}