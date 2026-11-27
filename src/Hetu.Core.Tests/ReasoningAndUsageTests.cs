using Hetu.Agents;
using Microsoft.Extensions.AI;

namespace Hetu.Core.Tests;

public class ReasoningAndUsageTests
{
    [Fact]
    public void ToUsage_映射Anthropic缓存写入令牌()
    {
        var usage = AgentRunState.ToUsage(new UsageDetails
        {
            InputTokenCount = 100,
            OutputTokenCount = 10,
            CachedInputTokenCount = 40,
            AdditionalCounts = new AdditionalPropertiesDictionary<long>
            {
                ["CacheCreationInputTokens"] = 20,
            },
        });

        Assert.Equal(100, usage.PromptTokens);
        Assert.Equal(10, usage.CompletionTokens);
        Assert.Equal(40, usage.CachedTokens);
        Assert.Equal(20, usage.CacheCreationTokens);
    }

    [Fact]
    public void ReasoningOptions_显式强度优先于预算()
    {
        var options = ReasoningOptionsMapper.Create("high", 1024);

        Assert.NotNull(options);
        Assert.Equal(ReasoningEffort.High, options!.Effort);
    }

    [Theory]
    [InlineData(512, ReasoningEffort.Low)]
    [InlineData(4096, ReasoningEffort.Medium)]
    [InlineData(12000, ReasoningEffort.High)]
    [InlineData(32000, ReasoningEffort.ExtraHigh)]
    public void ReasoningOptions_预算按区间映射(int budget, ReasoningEffort expected)
    {
        var options = ReasoningOptionsMapper.Create(null, budget);

        Assert.NotNull(options);
        Assert.Equal(expected, options!.Effort);
    }

    [Fact]
    public void ReasoningOptions_未配置返回null()
    {
        Assert.Null(ReasoningOptionsMapper.Create(null, null));
    }
}