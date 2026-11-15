using System.Collections.Concurrent;
using Hetu.Api.Streaming;

namespace Hetu.Core.Tests;

public class WorkStreamingTests
{
    [Fact]
    public async Task AttachAsync_多个挂载方_都收到完整事件序列()
    {
        var buffer = new SseEventBuffer();
        await buffer.PublishAsync("one");
        var first = new List<string>();
        var second = new List<string>();

        var firstAttach = buffer.AttachAsync(data => { first.Add(data); return Task.CompletedTask; }, CancellationToken.None);
        var secondAttach = buffer.AttachAsync(data => { second.Add(data); return Task.CompletedTask; }, CancellationToken.None);
        await buffer.PublishAsync("two");
        buffer.Complete();
        await Task.WhenAll(firstAttach, secondAttach).WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal(["one", "two"], first);
        Assert.Equal(first, second);
    }

    [Fact]
    public async Task AttachAsync_重放期间发布_不丢事件且顺序正确()
    {
        var buffer = new SseEventBuffer();
        await buffer.PublishAsync("one");
        var received = new List<string>();

        var attach = buffer.AttachAsync(async data =>
        {
            received.Add(data);
            if (data == "one") await buffer.PublishAsync("two");
        }, CancellationToken.None);
        buffer.Complete();
        await attach.WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal(["one", "two"], received);
    }

    [Fact]
    public async Task PublishAsync_超过缓冲上限_保留早期交互事件()
    {
        var buffer = new SseEventBuffer();
        await buffer.PublishAsync("{\"type\":\"plan\",\"toolCallId\":\"call-1\"}");
        for (var i = 0; i < 5000; i++) await buffer.PublishAsync($"{{\"type\":\"content\",\"text\":\"{i}\"}}");

        var snapshot = buffer.Snapshot();

        Assert.Equal(5000, snapshot.Count);
        Assert.Contains(snapshot, data => data.Contains("\"type\":\"plan\""));
    }

    [Fact]
    public void GetOrStart_并发首轮请求_只有一个创建运行()
    {
        var registry = new WorkRunRegistry();
        var sessionId = Guid.NewGuid();
        var results = new ConcurrentBag<(WorkRun Run, bool Created)>();

        Parallel.For(0, 16, _ => results.Add(registry.GetOrStart(sessionId)));

        var created = Assert.Single(results, r => r.Created);
        Assert.All(results, r => Assert.Same(created.Run, r.Run));
        registry.Remove(sessionId, created.Run);
    }
}
