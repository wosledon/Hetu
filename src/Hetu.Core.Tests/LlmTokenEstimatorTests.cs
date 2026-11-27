using Hetu.Core.Interfaces;
using Hetu.Core.Services;

namespace Hetu.Core.Tests;

public class LlmTokenEstimatorTests
{
    [Theory]
    [InlineData(null, 0)]
    [InlineData("", 0)]
    [InlineData("abc", 1)]
    [InlineData("abcd", 2)]
    [InlineData("中文测试", 2)]
    public void Estimate_按每三个字符一个Token估算(string? text, int expected)
        => Assert.Equal(expected, LlmTokenEstimator.Estimate(text));

    [Theory]
    [InlineData(0, 0)]
    [InlineData(-1, 0)]
    [InlineData(3, 1)]
    [InlineData(4, 2)]
    public void EstimateChars_非正数返回零_否则向上取整(long chars, int expected)
        => Assert.Equal(expected, LlmTokenEstimator.EstimateChars(chars));

    [Fact]
    public void Estimate_多段文本累加()
        => Assert.Equal(3, LlmTokenEstimator.Estimate(["abc", "def", "ghi"]));

    [Fact]
    public void EstimateRequestTokens_包含消息系统提示与工具schema()
    {
        List<LlmChatMessage> messages = [new() { Role = "user", Content = "123456" }];

        var tokens = LlmTokenEstimator.EstimateRequestTokens(messages, "abc", 9);

        Assert.Equal(6, tokens);
    }
}
