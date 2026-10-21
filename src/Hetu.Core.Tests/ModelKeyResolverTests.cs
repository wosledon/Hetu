using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using NSubstitute;

namespace Hetu.Core.Tests;

public class ModelKeyResolverTests
{
    private static (ModelKeyResolver resolver, IUnitOfWork unitOfWork) CreateResolver()
    {
        var unitOfWork = Substitute.For<IUnitOfWork>();
        return (new ModelKeyResolver(unitOfWork), unitOfWork);
    }

    private static AiProvider CreateProvider(string modelId)
        => new()
        {
            Id = Guid.NewGuid(),
            Name = "Mock",
            ProviderType = "openai",
            IsEnabled = true,
            Models = [new AiModel { Id = Guid.NewGuid(), ModelId = modelId, Purpose = "chat" }],
        };

    [Fact]
    public async Task ResolveAsync_合法复合键且模型存在_返回供应商与模型()
    {
        var (resolver, unitOfWork) = CreateResolver();
        var provider = CreateProvider("gpt-4o");
        unitOfWork.AiProviders.GetByIdWithModelsAsync(provider.Id, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<AiProvider?>(provider));

        var resolved = await resolver.ResolveAsync(ModelKeyResolver.Compose(provider.Id, "gpt-4o"));

        Assert.NotNull(resolved);
        Assert.Equal("gpt-4o", resolved!.Value.model.ModelId);
        Assert.Equal(provider.Id, resolved.Value.provider.Id);
    }

    /// <summary>
    /// 回归：解析必须走 GetByIdWithModelsAsync。仓库的 GetByIdAsync 不带 Include 且未开懒加载，
    /// provider.Models 恒为空，会让代理请求永远报「no valid target model resolved」。
    /// </summary>
    [Fact]
    public async Task ResolveAsync_使用GetByIdWithModelsAsync查询_而非不带导航集合的GetByIdAsync()
    {
        var (resolver, unitOfWork) = CreateResolver();
        var provider = CreateProvider("gpt-4o");
        unitOfWork.AiProviders.GetByIdWithModelsAsync(provider.Id, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<AiProvider?>(provider));

        await resolver.ResolveAsync(ModelKeyResolver.Compose(provider.Id, "gpt-4o"));

        await unitOfWork.AiProviders.Received(1).GetByIdWithModelsAsync(provider.Id, Arg.Any<CancellationToken>());
        await unitOfWork.AiProviders.DidNotReceive().GetByIdAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("gpt-4o")]
    [InlineData(":gpt-4o")]
    [InlineData("00000000-0000-0000-0000-000000000000:")]
    [InlineData("not-a-guid:gpt-4o")]
    public async Task ResolveAsync_非法复合键_返回null(string? modelKey)
    {
        var (resolver, _) = CreateResolver();

        Assert.Null(await resolver.ResolveAsync(modelKey));
    }

    [Fact]
    public async Task ResolveAsync_供应商已禁用_返回null()
    {
        var (resolver, unitOfWork) = CreateResolver();
        var provider = CreateProvider("gpt-4o");
        provider.IsEnabled = false;
        unitOfWork.AiProviders.GetByIdWithModelsAsync(provider.Id, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<AiProvider?>(provider));

        Assert.Null(await resolver.ResolveAsync(ModelKeyResolver.Compose(provider.Id, "gpt-4o")));
    }

    [Fact]
    public async Task ResolveAsync_供应商下没有该模型_返回null()
    {
        var (resolver, unitOfWork) = CreateResolver();
        var provider = CreateProvider("gpt-4o");
        unitOfWork.AiProviders.GetByIdWithModelsAsync(provider.Id, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<AiProvider?>(provider));

        Assert.Null(await resolver.ResolveAsync(ModelKeyResolver.Compose(provider.Id, "claude-3")));
    }
}
