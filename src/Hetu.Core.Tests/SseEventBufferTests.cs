using Hetu.Api.Streaming;

namespace Hetu.Core.Tests;

public sealed class SseEventBufferTests
{
    [Fact]
    public async Task PublishAsync_超出字符上限时丢弃最旧普通增量()
    {
        var buffer = new SseEventBuffer();
        var last = string.Empty;
        for (var i = 0; i < 4200; i++)
        {
            last = $"{{\"type\":\"content\",\"text\":\"{new string('x', 1024)}\",\"seq\":{i}}}";
            await buffer.PublishAsync(last);
        }

        var snapshot = buffer.Snapshot();
        Assert.InRange(snapshot.Sum(item => item.Length), 1, 4_000_000);
        Assert.True(snapshot.Count < 4200);
        Assert.Equal(last, snapshot[^1]);
    }

    [Fact]
    public async Task PublishAsync_慢客户端积压时所有事件按序送达()
    {
        var buffer = new SseEventBuffer();
        var firstReceived = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseFirst = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var received = new List<string>();
        var attach = buffer.AttachAsync(async data =>
        {
            received.Add(data);
            if (received.Count == 1)
            {
                firstReceived.SetResult();
                await releaseFirst.Task;
            }
        }, CancellationToken.None);

        await buffer.PublishAsync("event-0");
        await firstReceived.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var producer = Task.Run(async () =>
        {
            for (var i = 1; i <= 2500; i++)
                await buffer.PublishAsync(i == 2500 ? "done" : $"event-{i}");
        });

        await Task.Delay(100);
        var appliedBackpressure = !producer.IsCompleted;
        try
        {
            releaseFirst.SetResult();
            await producer.WaitAsync(TimeSpan.FromSeconds(5));
        }
        finally
        {
            releaseFirst.TrySetResult();
            buffer.Complete();
        }
        await attach.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.True(appliedBackpressure);
        Assert.Equal(Enumerable.Range(0, 2500).Select(i => $"event-{i}").Append("done"), received);
    }
}
