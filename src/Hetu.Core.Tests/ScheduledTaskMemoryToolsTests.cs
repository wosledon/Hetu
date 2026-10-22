using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;
using Hetu.Shared.AI;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;
using Hetu.Shared.Tasks;
using NSubstitute;

namespace Hetu.Core.Tests;

/// <summary>
/// 内置定时任务 / 记忆工具的纯逻辑：部分更新不丢字段（启用状态、会话绑定、作用域等）。
/// </summary>
public class ScheduledTaskMemoryToolsTests
{
    private static readonly Guid TaskId = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid TopicId = Guid.Parse("55555555-5555-5555-5555-555555555555");
    private static readonly Guid MemoryId = Guid.Parse("66666666-6666-6666-6666-666666666666");

    private static IScheduledTaskService CreateScheduledTaskService(ScheduledTaskDto current)
    {
        var service = Substitute.For<IScheduledTaskService>();
        service.GetByIdAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(ApiResponse<ScheduledTaskDto>.Ok(current));
        service.UpdateAsync(Arg.Any<Guid>(), Arg.Any<UpdateScheduledTaskRequest>(), Arg.Any<CancellationToken>())
            .Returns(callInfo => ApiResponse<ScheduledTaskDto>.Ok(new ScheduledTaskDto
            {
                Id = callInfo.Arg<Guid>(),
                Name = callInfo.Arg<UpdateScheduledTaskRequest>().Name,
                ScheduleType = callInfo.Arg<UpdateScheduledTaskRequest>().ScheduleType,
                IntervalMinutes = callInfo.Arg<UpdateScheduledTaskRequest>().IntervalMinutes,
                CronExpression = callInfo.Arg<UpdateScheduledTaskRequest>().CronExpression,
                IsEnabled = callInfo.Arg<UpdateScheduledTaskRequest>().IsEnabled,
                NextRunAt = DateTimeOffset.UtcNow.AddHours(1),
            }));
        service.ToggleAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(callInfo => ApiResponse<ScheduledTaskDto>.Ok(new ScheduledTaskDto
            {
                Id = callInfo.Arg<Guid>(),
                Name = "每日笔记整理",
                IsEnabled = true,
                NextRunAt = DateTimeOffset.UtcNow.AddDays(1),
            }));
        service.RunNowAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(ApiResponse<ScheduledTaskExecutionDto>.Ok(new ScheduledTaskExecutionDto
            {
                Id = TaskId,
                ScheduledTaskId = TaskId,
                StartedAt = DateTimeOffset.UtcNow,
                Status = "Queued",
                IsManual = true,
            }));
        return service;
    }

    private static IScheduledTaskService CreateScheduledTaskServiceForToggle(ScheduledTaskDto current)
    {
        var service = CreateScheduledTaskService(current);
        service.GetByIdAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(ApiResponse<ScheduledTaskDto>.Ok(current));
        return service;
    }

    private static ScheduledTaskDto DisabledTask() => new()
    {
        Id = TaskId,
        Name = "每日笔记整理",
        TaskKind = ScheduledTaskKinds.AiTask,
        Parameters = "{\"prompt\":\"整理今日笔记\"}",
        ScheduleType = ScheduleTypes.Cron,
        CronExpression = "0 8 * * *",
        IsEnabled = false,
        MaxRetries = 2,
        TopicId = TopicId,
    };

    [Fact]
    public async Task UpdateScheduledTaskTool_只改Cron_保留启用状态与会话绑定()
    {
        var service = CreateScheduledTaskService(DisabledTask());
        var tool = new UpdateScheduledTaskTool(service, Substitute.For<ILocalSkillService>());

        var result = await tool.ExecuteAsync("""
        {
            "taskId": "44444444-4444-4444-4444-444444444444",
            "cronExpression": "30 9 * * *"
        }
        """);

        Assert.False(result.IsError);
        // 服务端按整条记录覆盖：漏传会把停用的任务启用、丢掉会话绑定
        await service.Received().UpdateAsync(
            TaskId,
            Arg.Is<UpdateScheduledTaskRequest>(r =>
                r.CronExpression == "30 9 * * *"
                && r.Name == "每日笔记整理"
                && r.IsEnabled == false
                && r.TopicId == TopicId
                && r.TaskKind == ScheduledTaskKinds.AiTask
                && r.MaxRetries == 2),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task UpdateScheduledTaskTool_任务不存在_返回错误()
    {
        var service = Substitute.For<IScheduledTaskService>();
        service.GetByIdAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(ApiResponse<ScheduledTaskDto>.Fail("定时任务不存在"));
        var tool = new UpdateScheduledTaskTool(service, Substitute.For<ILocalSkillService>());

        var result = await tool.ExecuteAsync("""{"taskId":"44444444-4444-4444-4444-444444444444","name":"新名字"}""");

        Assert.True(result.IsError);
        await service.DidNotReceive().UpdateAsync(Arg.Any<Guid>(), Arg.Any<UpdateScheduledTaskRequest>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task ToggleScheduledTaskTool_显式启用停用任务_执行切换()
    {
        var service = CreateScheduledTaskServiceForToggle(DisabledTask());
        var tool = new ToggleScheduledTaskTool(service);

        var result = await tool.ExecuteAsync("""
        {
            "taskId": "44444444-4444-4444-4444-444444444444",
            "enabled": true
        }
        """);

        Assert.False(result.IsError);
        await service.Received().ToggleAsync(TaskId, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task ToggleScheduledTaskTool_已是目标状态_不重复切换()
    {
        var service = CreateScheduledTaskServiceForToggle(DisabledTask());
        var tool = new ToggleScheduledTaskTool(service);

        var result = await tool.ExecuteAsync("""
        {
            "taskId": "44444444-4444-4444-4444-444444444444",
            "enabled": false
        }
        """);

        Assert.False(result.IsError);
        await service.DidNotReceive().ToggleAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task RunScheduledTaskTool_传任务ID_触发立即执行()
    {
        var service = CreateScheduledTaskService(DisabledTask());
        var tool = new RunScheduledTaskTool(service);

        var result = await tool.ExecuteAsync("""{"taskId":"44444444-4444-4444-4444-444444444444"}""");

        Assert.False(result.IsError);
        await service.Received().RunNowAsync(TaskId, Arg.Any<CancellationToken>());
    }

    private static IMemoryService CreateMemoryService(MemoryDto current)
    {
        var service = Substitute.For<IMemoryService>();
        service.GetByIdAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(ApiResponse<MemoryDto>.Ok(current));
        service.UpdateAsync(Arg.Any<Guid>(), Arg.Any<UpdateMemoryRequest>(), Arg.Any<CancellationToken>())
            .Returns(callInfo => ApiResponse<MemoryDto>.Ok(new MemoryDto
            {
                Id = callInfo.Arg<Guid>(),
                Content = callInfo.Arg<UpdateMemoryRequest>().Content,
                Category = callInfo.Arg<UpdateMemoryRequest>().Category,
                Scope = callInfo.Arg<UpdateMemoryRequest>().Scope,
                Importance = callInfo.Arg<UpdateMemoryRequest>().Importance,
                ProjectName = "Hetu",
            }));
        service.DreamConsolidateAsync(Arg.Any<CancellationToken>())
            .Returns(ApiResponse<DreamResultDto>.Ok(new DreamResultDto
            {
                RanAt = DateTimeOffset.UtcNow,
                Merged = 3,
                Decayed = 5,
                Forgotten = 1,
                Remaining = 42,
                DurationMs = 1200,
            }));
        return service;
    }

    private static MemoryDto ExistingMemory() => new()
    {
        Id = MemoryId,
        Content = "用户使用 PostgreSQL",
        Category = "偏好",
        Scope = MemoryScopes.Project,
        ProjectId = Guid.Parse("77777777-7777-7777-7777-777777777777"),
        ProjectName = "Hetu",
        Importance = 0.8f,
    };

    [Fact]
    public async Task UpdateMemoryTool_只改内容_保留分类作用域与重要度()
    {
        var service = CreateMemoryService(ExistingMemory());
        var tool = new UpdateMemoryTool(service);

        var result = await tool.ExecuteAsync("""
        {
            "memoryId": "66666666-6666-6666-6666-666666666666",
            "content": "用户使用 PostgreSQL 16"
        }
        """);

        Assert.False(result.IsError);
        // 服务端按整条记录覆盖：漏传会把分类 / 作用域 / 重要度抹掉
        await service.Received().UpdateAsync(
            MemoryId,
            Arg.Is<UpdateMemoryRequest>(r =>
                r.Content == "用户使用 PostgreSQL 16"
                && r.Category == "偏好"
                && r.Scope == MemoryScopes.Project
                && r.Importance == 0.8f
                && r.ProjectId == Guid.Parse("77777777-7777-7777-7777-777777777777")),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task UpdateMemoryTool_传空分类_清除分类()
    {
        var service = CreateMemoryService(ExistingMemory());
        var tool = new UpdateMemoryTool(service);

        await tool.ExecuteAsync("""
        {
            "memoryId": "66666666-6666-6666-6666-666666666666",
            "category": ""
        }
        """);

        await service.Received().UpdateAsync(
            MemoryId,
            Arg.Is<UpdateMemoryRequest>(r => r.Category == null),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task UpdateMemoryTool_记忆不存在_返回错误()
    {
        var service = Substitute.For<IMemoryService>();
        service.GetByIdAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(ApiResponse<MemoryDto>.Fail("记忆不存在"));
        var tool = new UpdateMemoryTool(service);

        var result = await tool.ExecuteAsync("""{"memoryId":"66666666-6666-6666-6666-666666666666","content":"x"}""");

        Assert.True(result.IsError);
        await service.DidNotReceive().UpdateAsync(Arg.Any<Guid>(), Arg.Any<UpdateMemoryRequest>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task DreamMemoryTool_执行整理_返回合并与遗忘统计()
    {
        var service = CreateMemoryService(ExistingMemory());
        var tool = new DreamMemoryTool(service);

        var result = await tool.ExecuteAsync("{}");

        Assert.False(result.IsError);
        Assert.Contains("merged", result.Content);
        Assert.Contains("forgotten", result.Content);
        await service.Received().DreamConsolidateAsync(Arg.Any<CancellationToken>());
    }
}
