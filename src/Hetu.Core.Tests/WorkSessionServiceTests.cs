using System.Linq.Expressions;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Core.Services.Work;
using Hetu.Shared.Common;
using Hetu.Shared.Work;
using NSubstitute;

namespace Hetu.Core.Tests;

public class WorkSessionServiceTests
{
    [Fact]
    public async Task GetMessagesPageAsync_返回最新页并按时间正序排列()
    {
        var sessionId = Guid.NewGuid();
        var newest = new WorkMessage
        {
            Id = Guid.NewGuid(),
            SessionId = sessionId,
            Content = "new",
            CreatedAt = DateTimeOffset.UtcNow
        };
        var older = new WorkMessage
        {
            Id = Guid.NewGuid(),
            SessionId = sessionId,
            Content = "old",
            CreatedAt = DateTimeOffset.UtcNow.AddMinutes(-1)
        };

        var (service, repo) = CreateService();
        repo.CountAsync(Arg.Any<Expression<Func<WorkMessage, bool>>>(), Arg.Any<CancellationToken>())
            .Returns(5);
        repo.GetPagedByDateAsync(
                Arg.Any<Expression<Func<WorkMessage, bool>>>(),
                Arg.Any<Expression<Func<WorkMessage, DateTimeOffset>>>(),
                true, 0, 2, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult(new List<WorkMessage> { newest, older }));

        var result = await service.GetMessagesPageAsync(sessionId, 1, 2);

        Assert.True(result.Success);
        var page = Assert.IsType<PagedResult<WorkMessageDto>>(result.Data);
        Assert.Equal(5, page.TotalCount);
        Assert.Equal([older.Id, newest.Id], page.Items.Select(item => item.Id).ToArray());
    }

    [Theory]
    [InlineData(0, 0, 1, 1)]
    [InlineData(-3, 9999, 1, 500)]
    public async Task GetMessagesPageAsync_页码与页大小越界时收敛(int page, int pageSize, int expectedPage, int expectedPageSize)
    {
        var (service, repo) = CreateService();
        repo.CountAsync(Arg.Any<Expression<Func<WorkMessage, bool>>>(), Arg.Any<CancellationToken>())
            .Returns(0);
        repo.GetPagedByDateAsync(
                Arg.Any<Expression<Func<WorkMessage, bool>>>(),
                Arg.Any<Expression<Func<WorkMessage, DateTimeOffset>>>(),
                true,
                (expectedPage - 1) * expectedPageSize,
                expectedPageSize,
                Arg.Any<CancellationToken>())
            .Returns(Task.FromResult(new List<WorkMessage>()));

        var result = await service.GetMessagesPageAsync(Guid.NewGuid(), page, pageSize);

        Assert.Equal(expectedPage, result.Data!.Page);
        Assert.Equal(expectedPageSize, result.Data.PageSize);
    }

    private static (WorkSessionService Service, IRepository<WorkMessage> Repository) CreateService()
    {
        var repository = Substitute.For<IRepository<WorkMessage>>();
        var unitOfWork = Substitute.For<IUnitOfWork>();
        unitOfWork.WorkMessages.Returns(repository);
        // 分页读取不触碰工作树 / 命名器 / 模型工厂 / 执行器工厂
        return (new WorkSessionService(
            unitOfWork,
            Substitute.For<ILocalizer>(),
            null!,
            null!,
            null!,
            Substitute.For<IWorkCommandRunnerFactory>()), repository);
    }
}
