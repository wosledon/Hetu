using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Shared.Common;
using Hetu.Shared.Settings;
using Microsoft.Extensions.Logging;
using NSubstitute;

namespace Hetu.Core.Tests;

/// <summary>
/// 压缩管道节点算法回归：有损节点只允许作用于日志行，散文（用户指令 / 助手结论）逐字保留。
/// 管道的设计目的是「减少进上下文的重复内容」，不是对自然语言做有损 NLP。
/// </summary>
public class CompressionPipelineTests
{
    [Fact]
    public async Task CompressAsync_散文含逻辑词与数字_逐字不变()
    {
        var pipeline = CreatePipeline();
        var lines = Enumerable.Range(0, 30).Select(i =>
            $"如果第 {i} 步失败，但是不要重试，因此改为跳过并记录原因；can should will not {i} but or if 以及 然后 因此");
        var prose = string.Join("\n", lines);

        var result = await pipeline.CompressAsync(prose);

        Assert.Equal(prose, result);
    }

    [Fact]
    public async Task CompressAsync_重复日志_折叠为首次出现加次数标注()
    {
        var pipeline = CreatePipeline();
        var logs = string.Join("\n", Enumerable.Range(0, 200).Select(i =>
            $"2026-11-15 10:00:{i % 60:00} INFO  heartbeat ok seq={i}"));

        var result = await pipeline.CompressAsync(logs);

        Assert.Contains("← 重复 200 次", result);
        Assert.True(result.Length < logs.Length / 10, $"压缩后 {result.Length} 字符，原文 {logs.Length}");
    }

    [Fact]
    public async Task CompressAsync_相似但不同的散文行_不被近重合并()
    {
        var pipeline = CreatePipeline();
        var lines = Enumerable.Range(0, 40).Select(i =>
            $"please update module {i} and keep the existing behavior unchanged");
        var prose = string.Join("\n", lines);

        var result = await pipeline.CompressAsync(prose);

        Assert.Equal(40, result.Split('\n').Count(l => l.StartsWith("please update module", StringComparison.Ordinal)));
    }

    [Fact]
    public async Task CompressAsync_数字不同的日志行_折叠但散文行保留()
    {
        var pipeline = CreatePipeline();
        var mixed = string.Join("\n",
            "结论：不要修改配置项 timeout=300",
            "2026-11-15 10:00:01 INFO  retry attempt=1",
            "2026-11-15 10:00:02 INFO  retry attempt=2",
            "2026-11-15 10:00:03 INFO  retry attempt=3");

        var result = await pipeline.CompressAsync(mixed);

        Assert.Contains("结论：不要修改配置项 timeout=300", result);
        Assert.Contains("← 重复 3 次", result);
    }

    [Fact]
    public async Task PrepareForContextAsync_短文本_原样返回()
    {
        var pipeline = CreatePipeline();
        const string shortText = "只有一句话，没有压缩收益。";

        Assert.Equal(shortText, await pipeline.PrepareForContextAsync(shortText));
    }

    [Fact]
    public async Task PrepareForContextAsync_同内容多次调用_结果逐字一致()
    {
        var pipeline = CreatePipeline();
        var logs = string.Join("\n", Enumerable.Range(0, 100).Select(i =>
            $"2026-11-15 10:00:{i % 60:00} INFO  heartbeat ok seq={i}"));

        var first = await pipeline.PrepareForContextAsync(logs);
        var second = await pipeline.PrepareForContextAsync(logs);

        Assert.Equal(first, second);
        Assert.True(first.Length < logs.Length);
    }

    [Fact]
    public async Task CompressAsync_管道关闭_原样返回()
    {
        var pipeline = CreatePipeline(enabled: false);
        var logs = string.Join("\n", Enumerable.Range(0, 100).Select(i =>
            $"2026-11-15 10:00:{i % 60:00} INFO  heartbeat ok seq={i}"));

        Assert.Equal(logs, await pipeline.CompressAsync(logs));
    }

    private static CompressionPipelineService CreatePipeline(bool enabled = true)
    {
        var settings = Substitute.For<IAppSettingService>();
        settings.GetAsync("CompressionConfig", Arg.Any<CancellationToken>())
            .Returns(ApiResponse<AppSettingDto?>.Ok(new AppSettingDto
            {
                Key = "CompressionConfig",
                Value = JsonSerializer.Serialize(new CompressionPipelineDto { Enabled = enabled, Mode = "algorithmic" }),
            }));
        return new CompressionPipelineService(
            settings,
            Substitute.For<ILogger<CompressionPipelineService>>(),
            Substitute.For<ILLMProviderFactory>(),
            Substitute.For<ILlmUsageRecorder>());
    }
}