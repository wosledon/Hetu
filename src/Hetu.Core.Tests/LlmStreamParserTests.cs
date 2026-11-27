using Hetu.Core.Streaming;

namespace Hetu.Core.Tests;

public class LlmStreamParserTests
{
    [Fact]
    public void Parse_文本工具调用跨分片_输出结构化调用且正文不含标签()
    {
        var parser = new LlmStreamParser();
        var chunks = new List<LlmStreamChunk>();
        chunks.AddRange(parser.Parse("before<tool"));
        chunks.AddRange(parser.Parse("_call>{\"id\":\"c1\",\"name\":\"work_read_file\",\"arguments\":{\"path\":\"src/App.tsx\"}}</tool"));
        chunks.AddRange(parser.Parse("_call>after"));

        Assert.Equal("beforeafter", string.Concat(chunks.Where(c => c.Type == LlmStreamEventType.Content).Select(c => c.Text)));
        var call = Assert.Single(chunks.Single(c => c.Type == LlmStreamEventType.ToolCalls).ToolCalls!);
        Assert.Equal("c1", call.Id);
        Assert.Equal("work_read_file", call.Name);
        Assert.Equal("{\"path\":\"src/App.tsx\"}", call.Arguments);
    }

    [Fact]
    public void Parse_多个文本工具调用_分别产生调用事件()
    {
        var parser = new LlmStreamParser();
        const string text = "<tool_call>{\"name\":\"one\",\"arguments\":{}}</tool_call><tool_call>{\"name\":\"two\",\"arguments\":{}}</tool_call>";

        var chunks = parser.Parse(text);

        Assert.Equal(2, chunks.Count(c => c.Type == LlmStreamEventType.ToolCalls));
        Assert.DoesNotContain(chunks, c => c.Type == LlmStreamEventType.Content);
    }

    [Fact]
    public void Flush_未闭合文本工具调用_保留原文且不执行()
    {
        var parser = new LlmStreamParser();
        parser.Parse("<tool_call>{\"name\":\"work_read_file\"");

        var chunk = Assert.Single(parser.Flush());

        Assert.Equal(LlmStreamEventType.Content, chunk.Type);
        Assert.Equal("<tool_call>{\"name\":\"work_read_file\"", chunk.Text);
    }

    [Fact]
    public void Parse_thinking标签跨分片_切分为思考与正文()
    {
        var parser = new LlmStreamParser();
        var chunks = new List<LlmStreamChunk>();
        chunks.AddRange(parser.Parse("前言<think"));
        chunks.AddRange(parser.Parse("ing>推理</think"));
        chunks.AddRange(parser.Parse("ing>结论"));

        Assert.Equal("前言结论", string.Concat(chunks.Where(c => c.Type == LlmStreamEventType.Content).Select(c => c.Text)));
        Assert.Equal("推理", string.Concat(chunks.Where(c => c.Type == LlmStreamEventType.Thinking).Select(c => c.Text)));
    }

    [Fact]
    public void Parse_普通JSON文本_原样作为正文()
    {
        var parser = new LlmStreamParser();
        const string json = "{\"type\":\"content\",\"text\":\"hello\"}";

        var chunk = Assert.Single(parser.Parse(json));

        Assert.Equal(LlmStreamEventType.Content, chunk.Type);
        Assert.Equal(json, chunk.Text);
    }
}