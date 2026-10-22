using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;
using Hetu.Shared.Common;
using Hetu.Shared.Tasks;
using Microsoft.AspNetCore.Http;
using NSubstitute;
using Xunit;

namespace Hetu.Core.Tests;

public class CreateScheduledTaskToolTests
{
    private static (CreateScheduledTaskTool Tool, IScheduledTaskService Service) CreateTool()
    {
        var service = Substitute.For<IScheduledTaskService>();
        service.CreateAsync(Arg.Any<CreateScheduledTaskRequest>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult(ApiResponse<ScheduledTaskDto>.Ok(new ScheduledTaskDto
            {
                Id = Guid.NewGuid(),
                Name = "t",
                TaskKind = ScheduledTaskKinds.AiTask,
                ScheduleType = ScheduleTypes.Interval,
            })));
        var http = Substitute.For<IHttpContextAccessor>();
        return (new CreateScheduledTaskTool(service, Substitute.For<ILocalSkillService>(), http), service);
    }

    [Fact]
    public async Task ExecuteAsync_整数参数传成字符串_按整数解析不再抛异常()
    {
        // 模型把 intervalMinutes 写成 "60"（字符串）时旧实现 GetInt32 直接抛
        // InvalidOperationException，创建必失败——定时任务工具曾因此不可用
        var (tool, service) = CreateTool();

        var result = await tool.ExecuteAsync("""
        {
            "name": "AI技术前沿新闻推送",
            "taskKind": "AiTask",
            "scheduleType": "Interval",
            "intervalMinutes": "60",
            "parameters": "{\"systemPrompt\":\"x\"}"
        }
        """);

        Assert.True(!result.IsError, result.Content);
        var request = (CreateScheduledTaskRequest)service.ReceivedCalls()
            .Single(c => c.GetMethodInfo().Name == nameof(IScheduledTaskService.CreateAsync))
            .GetArguments()[0]!;
        Assert.Equal(60, request.IntervalMinutes);
    }

    [Fact]
    public async Task ExecuteAsync_字符串参数传成对象_序列化为JSON文本()
    {
        var (tool, service) = CreateTool();

        var result = await tool.ExecuteAsync("""
        {
            "name": "任务",
            "taskKind": "AiTask",
            "scheduleType": "Interval",
            "parameters": { "systemPrompt": "s", "prompt": "p" }
        }
        """);

        Assert.True(!result.IsError, result.Content);
        var request = (CreateScheduledTaskRequest)service.ReceivedCalls()
            .Single(c => c.GetMethodInfo().Name == nameof(IScheduledTaskService.CreateAsync))
            .GetArguments()[0]!;
        Assert.Equal("{ \"systemPrompt\": \"s\", \"prompt\": \"p\" }", request.Parameters);
    }

    [Fact]
    public async Task ExecuteAsync_布尔参数传成字符串_按布尔解析()
    {
        var (tool, service) = CreateTool();

        var result = await tool.ExecuteAsync("""
        {
            "name": "任务",
            "taskKind": "AiTask",
            "scheduleType": "Interval",
            "bindToConversation": "false"
        }
        """);

        Assert.True(!result.IsError, result.Content);
        var request = (CreateScheduledTaskRequest)service.ReceivedCalls()
            .Single(c => c.GetMethodInfo().Name == nameof(IScheduledTaskService.CreateAsync))
            .GetArguments()[0]!;
        Assert.Null(request.TopicId);
    }

    [Fact]
    public async Task ExecuteAsync_缺少名称_返回明确错误()
    {
        var (tool, _) = CreateTool();

        var result = await tool.ExecuteAsync("""{"taskKind":"AiTask","scheduleType":"Interval"}""");

        Assert.False(!result.IsError);
        Assert.Contains("名称", result.Content);
    }
}
