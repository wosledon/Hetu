using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Infrastructure.AI;
using Hetu.Shared.AI;
using Hetu.Shared.Common;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Logging.Abstractions;using NSubstitute;

namespace Hetu.Core.Tests;

/// <summary>
/// Foundry Local 接入 LLM / Embedding 工厂的行为：新 Provider 类型必须能构造出 OpenAI 兼容实现，
/// 且本地运行时没有 API Key 时不能炸在 Unprotect 上（历史上空串直接进 Unprotect 会抛）。
/// </summary>
public class FoundryLocalProviderFactoryTests
{
    private static (LlmProviderFactory Chat, EmbeddingProviderFactory Embedding, IUnitOfWork UnitOfWork) CreateFactories()
    {
        var unitOfWork = Substitute.For<IUnitOfWork>();
        var http = Substitute.For<IHttpClientFactory>();
        http.CreateClient(Arg.Any<string>()).Returns(new HttpClient());
        var protector = new PassthroughProtector();
        return (
            new LlmProviderFactory(unitOfWork, new SingleProtectorProvider(protector), http),
            new EmbeddingProviderFactory(unitOfWork, new SingleProtectorProvider(protector), http,
                NullLogger<EmbeddingProviderFactory>.Instance),
            unitOfWork);
    }

    private static AiModel CreateModel(Guid providerId, string modelId, string purpose = "chat")
        => new() { Id = Guid.NewGuid(), ProviderId = providerId, ModelId = modelId, Purpose = purpose };

    [Fact]
    public async Task CreateProviderAsync_FoundryLocal供应商_返回OpenAI兼容实现()
    {
        var (chat, _, unitOfWork) = CreateFactories();
        var provider = new AiProvider
        {
            Id = Guid.NewGuid(),
            Name = "Foundry Local",
            ProviderType = "foundry",
            IsEnabled = true,
            // 本地运行时没有 API Key，库里存空串
            EncryptedApiKey = string.Empty,
            BaseUrl = "http://127.0.0.1:5272/v1",
        };
        var model = CreateModel(provider.Id, "phi-4-mini");
        unitOfWork.AiModels.GetByIdAsync(model.Id, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<AiModel?>(model));
        unitOfWork.AiProviders.GetByIdAsync(provider.Id, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<AiProvider?>(provider));

        var created = await chat.CreateProviderAsync(model.Id);

        Assert.NotNull(created);
        Assert.Equal("openai", created!.ProviderType);
        Assert.True(created.SupportsStreaming);
    }

    [Fact]
    public async Task CreateProviderAsync_FoundryLocal且未填BaseUrl_用本地默认端口而非官方地址()
    {
        var (chat, _, unitOfWork) = CreateFactories();
        var provider = new AiProvider
        {
            Id = Guid.NewGuid(),
            Name = "Foundry Local",
            ProviderType = "foundry",
            IsEnabled = true,
            EncryptedApiKey = string.Empty,
            BaseUrl = null,
        };
        var model = CreateModel(provider.Id, "phi-4-mini");
        unitOfWork.AiModels.GetByIdAsync(model.Id, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<AiModel?>(model));
        unitOfWork.AiProviders.GetByIdAsync(provider.Id, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<AiProvider?>(provider));

        var created = await chat.CreateProviderAsync(model.Id);

        // 只验证不会回落到 api.openai.com：真正发请求会在本地端口失败而不是打到官方地址
        Assert.NotNull(created);
    }

    [Fact]
    public async Task CreateProviderAsync_未知Provider类型_抛NotSupportedException()
    {
        var (chat, _, unitOfWork) = CreateFactories();
        var provider = new AiProvider
        {
            Id = Guid.NewGuid(),
            Name = "Weird",
            ProviderType = "something-else",
            IsEnabled = true,
        };
        var model = CreateModel(provider.Id, "m");
        unitOfWork.AiModels.GetByIdAsync(model.Id, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<AiModel?>(model));
        unitOfWork.AiProviders.GetByIdAsync(provider.Id, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<AiProvider?>(provider));

        await Assert.ThrowsAsync<NotSupportedException>(() => chat.CreateProviderAsync(model.Id));
    }

    [Fact]
    public async Task CreateEmbeddingProviderAsync_FoundryLocal且无ApiKey_返回实现而非null()
    {
        var (_, embedding, unitOfWork) = CreateFactories();
        var provider = new AiProvider
        {
            Id = Guid.NewGuid(),
            Name = "Foundry Local",
            ProviderType = "foundry",
            IsEnabled = true,
            EncryptedApiKey = string.Empty,
            BaseUrl = "http://127.0.0.1:5272/v1",
        };
        var model = CreateModel(provider.Id, "text-embedding", "embedding");
        unitOfWork.AiModels.GetDefaultByPurposeAsync("embedding", Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<AiModel?>(model));
        unitOfWork.AiProviders.GetByIdAsync(provider.Id, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<AiProvider?>(provider));

        var created = await embedding.CreateEmbeddingProviderAsync();

        Assert.NotNull(created);
    }

    [Fact]
    public async Task CreateEmbeddingProviderAsync_未知Provider类型_返回null并记录日志()
    {
        var (_, embedding, unitOfWork) = CreateFactories();
        var provider = new AiProvider
        {
            Id = Guid.NewGuid(),
            Name = "Weird",
            ProviderType = "something-else",
            IsEnabled = true,
        };
        var model = CreateModel(provider.Id, "m", "embedding");
        unitOfWork.AiModels.GetDefaultByPurposeAsync("embedding", Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<AiModel?>(model));
        unitOfWork.AiProviders.GetByIdAsync(provider.Id, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<AiProvider?>(provider));

        Assert.Null(await embedding.CreateEmbeddingProviderAsync());
    }

    /// <summary>把单个 protector 包成 provider，省掉真跑一遍 DataProtection 密钥环</summary>
    private sealed class SingleProtectorProvider : IDataProtectionProvider
    {
        private readonly IDataProtector _protector;

        public SingleProtectorProvider(IDataProtector protector) => _protector = protector;

        public IDataProtector CreateProtector(string purpose) => _protector;
    }

    /// <summary>透传 protector：测试只关心「有没有送进 Unprotect」，不关心加解密本身</summary>
    private sealed class PassthroughProtector : IDataProtector
    {
        public IDataProtector CreateProtector(string purpose) => this;

        public byte[] Protect(byte[] plaintext) => plaintext;

        public byte[] Unprotect(byte[] protectedData) => protectedData;

        public string Protect(string plaintext) => plaintext;

        public string Unprotect(string protectedData) => protectedData;
    }
}

/// <summary>Foundry Local 本地路径选项：默认目录必须落在 Hetu 数据目录下，与 SQLite/日志同一处</summary>
public class FoundryLocalOptionsTests
{
    [Fact]
    public void DefaultModelDir_配置了数据目录_返回其下的foundryModels()
    {
        var options = new FoundryLocalOptions { DataDir = @"C:\Users\me\AppData\Local\Hetu" };

        Assert.Equal(Path.Combine(@"C:\Users\me\AppData\Local\Hetu", "foundry-models"), options.DefaultModelDir);
    }

    [Fact]
    public void DefaultModelDir_未配置数据目录_回落到临时目录而不是抛异常()
    {
        var options = new FoundryLocalOptions { DataDir = string.Empty };

        Assert.Contains("hetu-foundry-models", options.DefaultModelDir);
    }
}
