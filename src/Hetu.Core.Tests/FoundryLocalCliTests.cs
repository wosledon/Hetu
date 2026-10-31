using Hetu.Infrastructure.FoundryLocal;

namespace Hetu.Core.Tests;

/// <summary>
/// CLI 输出解析的纯逻辑测试。FoundryLocalCliService 整体要真起 foundry 进程，
/// 这里只覆盖其中不依赖外部进程的部分——下载进度的文本行解析。
/// </summary>
public class FoundryLocalCliTests
{
    [Theory]
    [InlineData("qwen3-0.6b-pp-finetuned-generic-cpu:4: 42%", 42)]
    [InlineData("qwen3-0.6b-pp-finetuned-generic-cpu:4: 0%", 0)]
    [InlineData("qwen3-0.6b-pp-finetuned-generic-cpu:4: 100%", 100)]
    [InlineData("some-model:1: 7.5%", 7.5)]
    public void ParseDownloadProgress_进度行_返回百分比(string line, double expected)
        => Assert.Equal(expected, FoundryLocalCli.ParseDownloadProgress(line));

    [Theory]
    [InlineData("Downloading model (qwen3-0.6b-generic-cpu:4, 505.0 MB)")]
    [InlineData("✔ success: Downloaded 'qwen3-0.6b-generic-cpu:4' to the local cache.")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("no colon at all")]
    [InlineData("model: notapercent")]
    [InlineData("model: %")]
    public void ParseDownloadProgress_非进度行_返回null(string line)
        => Assert.Null(FoundryLocalCli.ParseDownloadProgress(line));

    /// <summary>CLI 偶尔会吐出超过 100 的值，夹到 100 免得进度条溢出 */
    [Fact]
    public void ParseDownloadProgress_超过100_夹到100()
        => Assert.Equal(100, FoundryLocalCli.ParseDownloadProgress("model:1: 10000%"));

    /// <summary>带空格的路径不能被 CLI 当成两个参数，必须整体加引号 */
    [Theory]
    [InlineData("simple", "simple")]
    [InlineData("C:\\models", "C:\\models")]
    [InlineData("C:\\my models", "\"C:\\my models\"")]
    [InlineData("qwen3-0.6b-generic-cpu:4", "qwen3-0.6b-generic-cpu:4")]
    public void Quote_按需加引号(string input, string expected)
        => Assert.Equal(expected, FoundryLocalCliService.Quote(input));
}
