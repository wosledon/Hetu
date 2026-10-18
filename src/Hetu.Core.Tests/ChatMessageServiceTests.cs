using System.Linq.Expressions;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Shared.Chat;
using Hetu.Shared.Common;
using NSubstitute;

namespace Hetu.Core.Tests;

public class ChatMessageServiceTests
{
    [Fact]
    public async Task GetByTopicPageAsync_返回最新页并按时间正序排列()
    {
        var topicId = Guid.NewGuid();
        var newest = new ChatMessage
        {
            Id = Guid.NewGuid(),
            TopicId = topicId,
            Content = "new",
            CreatedAt = DateTimeOffset.UtcNow
        };
        var older = new ChatMessage
        {
            Id = Guid.NewGuid(),
            TopicId = topicId,
            Content = "old",
            CreatedAt = DateTimeOffset.UtcNow.AddMinutes(-1)
        };

        var (service, repo) = CreateService();
        repo.CountAsync(Arg.Any<Expression<Func<ChatMessage, bool>>>(), Arg.Any<CancellationToken>())
            .Returns(5);
        repo.GetPagedByDateAsync(
                Arg.Any<Expression<Func<ChatMessage, bool>>>(),
                Arg.Any<Expression<Func<ChatMessage, DateTimeOffset>>>(),
                true, 0, 2, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult(new List<ChatMessage> { newest, older }));

        var result = await service.GetByTopicPageAsync(topicId, 1, 2);

        Assert.True(result.Success);
        var page = Assert.IsType<PagedResult<ChatMessageDto>>(result.Data);
        Assert.Equal(5, page.TotalCount);
        Assert.Equal(1, page.Page);
        Assert.Equal(2, page.PageSize);
        Assert.Equal([older.Id, newest.Id], page.Items.Select(item => item.Id).ToArray());
    }

    [Theory]
    [InlineData(0, 0, 1, 1)]
    [InlineData(-3, 9999, 1, 500)]
    public async Task GetByTopicPageAsync_页码与页大小越界时收敛(int page, int pageSize, int expectedPage, int expectedPageSize)
    {
        var (service, repo) = CreateService();
        repo.CountAsync(Arg.Any<Expression<Func<ChatMessage, bool>>>(), Arg.Any<CancellationToken>())
            .Returns(0);
        repo.GetPagedByDateAsync(
                Arg.Any<Expression<Func<ChatMessage, bool>>>(),
                Arg.Any<Expression<Func<ChatMessage, DateTimeOffset>>>(),
                true,
                (expectedPage - 1) * expectedPageSize,
                expectedPageSize,
                Arg.Any<CancellationToken>())
            .Returns(Task.FromResult(new List<ChatMessage>()));

        var result = await service.GetByTopicPageAsync(Guid.NewGuid(), page, pageSize);

        Assert.Equal(expectedPage, result.Data!.Page);
        Assert.Equal(expectedPageSize, result.Data.PageSize);
    }

    private static (ChatMessageService Service, IRepository<ChatMessage> Repository) CreateService()
    {
        var repository = Substitute.For<IRepository<ChatMessage>>();
        var unitOfWork = Substitute.For<IUnitOfWork>();
        unitOfWork.ChatMessages.Returns(repository);
        return (new ChatMessageService(unitOfWork, Substitute.For<ILocalizer>()), repository);
    }
}
