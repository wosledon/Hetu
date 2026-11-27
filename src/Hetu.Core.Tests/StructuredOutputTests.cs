using System.Runtime.CompilerServices;
using Hetu.Agents;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;

namespace Hetu.Core.Tests;

public class StructuredOutputTests
{
    [Fact]
    public async Task GenerateJsonAsync_Provider返回JSON_按类型反序列化()
    {
        var model = new JsonModel("""{"name":"hetu","count":3}""");
        ITextGenerationClient client = new MafTextGenerationClient(new ScriptedAgentFactory(model), null!);

        var result = await client.GenerateJsonAsync<TestDto>(
            null,
            [new LlmChatMessage { Role = "user", Content = "test" }],
            new ChatOptions());

        Assert.NotNull(result);
        Assert.Equal("hetu", result!.Name);
        Assert.Equal(3, result.Count);
    }

    [Fact]
    public async Task GenerateJsonAsync_模型带代码块_回退宽松解析()
    {
        var model = new JsonModel("```json\n{\"name\":\"hetu\",\"count\":4}\n```");
        ITextGenerationClient client = new MafTextGenerationClient(new ScriptedAgentFactory(model), null!);

        var result = await client.GenerateJsonAsync<TestDto>(
            null,
            [new LlmChatMessage { Role = "user", Content = "test" }],
            new ChatOptions());

        Assert.NotNull(result);
        Assert.Equal("hetu", result!.Name);
        Assert.Equal(4, result.Count);
    }

    public sealed class TestDto
    {
        public string Name { get; set; } = string.Empty;
        public int Count { get; set; }
    }

    private sealed class JsonModel(string json) : IScriptedModel
    {
        public string ProviderType => "test";

        public async IAsyncEnumerable<string> ChatStreamAsync(
            IReadOnlyList<LlmChatMessage> messages,
            ChatOptions options,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.Yield();
            yield return json;
        }
    }
}