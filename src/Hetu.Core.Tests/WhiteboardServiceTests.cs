using System.Linq.Expressions;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Shared.Common;
using Hetu.Shared.Whiteboard;
using NSubstitute;

namespace Hetu.Core.Tests;

public class WhiteboardServiceTests
{
    private static ILocalizer CreateLocalizer()
    {
        var localizer = Substitute.For<ILocalizer>();
        localizer.T(Arg.Any<string>(), Arg.Any<object[]>())
            .Returns(callInfo => callInfo.ArgAt<string>(0));
        return localizer;
    }

    private static (WhiteboardService Service, IRepository<Whiteboard> Repository) CreateService()
    {
        var repository = Substitute.For<IRepository<Whiteboard>>();
        var unitOfWork = Substitute.For<IUnitOfWork>();
        unitOfWork.Whiteboards.Returns(repository);
        return (new WhiteboardService(unitOfWork, CreateLocalizer()), repository);
    }

    [Fact]
    public async Task GetListAsync_返回未删除画板并按更新时间倒序分页()
    {
        var (service, repository) = CreateService();
        var older = new Whiteboard { Id = Guid.NewGuid(), Name = "旧", UpdatedAt = DateTimeOffset.UtcNow.AddDays(-1) };
        var newer = new Whiteboard { Id = Guid.NewGuid(), Name = "新", UpdatedAt = DateTimeOffset.UtcNow };
        repository.CountAsync(Arg.Any<Expression<Func<Whiteboard, bool>>>(), Arg.Any<CancellationToken>()).Returns(2);
        repository.GetPagedByDateAsync(
                Arg.Any<Expression<Func<Whiteboard, bool>>>(),
                Arg.Any<Expression<Func<Whiteboard, DateTimeOffset>>>(),
                true, 0, 20, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult(new List<Whiteboard> { newer, older }));

        var result = await service.GetListAsync(1, 20);

        Assert.True(result.Success);
        var page = Assert.IsType<PagedResult<WhiteboardListItemDto>>(result.Data);
        Assert.Equal(2, page.TotalCount);
        Assert.Equal(["新", "旧"], page.Items.Select(item => item.Name).ToArray());
    }

    [Theory]
    [InlineData(0, 0, 1, 1)]
    [InlineData(-2, 500, 1, 100)]
    public async Task GetListAsync_页码与页大小越界时收敛(int page, int pageSize, int expectedPage, int expectedPageSize)
    {
        var (service, repository) = CreateService();
        repository.CountAsync(Arg.Any<Expression<Func<Whiteboard, bool>>>(), Arg.Any<CancellationToken>()).Returns(0);
        repository.GetPagedByDateAsync(
                Arg.Any<Expression<Func<Whiteboard, bool>>>(),
                Arg.Any<Expression<Func<Whiteboard, DateTimeOffset>>>(),
                true,
                (expectedPage - 1) * expectedPageSize,
                expectedPageSize,
                Arg.Any<CancellationToken>())
            .Returns(Task.FromResult(new List<Whiteboard>()));

        var result = await service.GetListAsync(page, pageSize);

        Assert.Equal(expectedPage, result.Data!.Page);
        Assert.Equal(expectedPageSize, result.Data.PageSize);
    }

    [Fact]
    public async Task GetByIdAsync_画板不存在或已删除时返回失败()
    {
        var (service, repository) = CreateService();
        repository.GetByIdAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<Whiteboard?>(null));

        var missing = await service.GetByIdAsync(Guid.NewGuid());
        Assert.False(missing.Success);

        repository.GetByIdAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<Whiteboard?>(new Whiteboard { Id = Guid.NewGuid(), Name = "x", IsDeleted = true }));

        var deleted = await service.GetByIdAsync(Guid.NewGuid());
        Assert.False(deleted.Success);
    }

    [Fact]
    public async Task CreateAsync_名称为空时返回失败且不落库()
    {
        var (service, repository) = CreateService();

        var result = await service.CreateAsync(new CreateWhiteboardRequest { Name = "   " });

        Assert.False(result.Success);
        await repository.DidNotReceive().AddAsync(Arg.Any<Whiteboard>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task CreateAsync_名称超长时返回失败()
    {
        var (service, _) = CreateService();

        var result = await service.CreateAsync(new CreateWhiteboardRequest { Name = new string('x', 101) });

        Assert.False(result.Success);
    }

    [Fact]
    public async Task CreateAsync_场景非法JSON时返回失败且不落库()
    {
        var (service, repository) = CreateService();

        var result = await service.CreateAsync(new CreateWhiteboardRequest { Name = "架构图", Scene = "{not json" });

        Assert.False(result.Success);
        await repository.DidNotReceive().AddAsync(Arg.Any<Whiteboard>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task CreateAsync_场景不是JSON对象时返回失败()
    {
        var (service, _) = CreateService();

        var result = await service.CreateAsync(new CreateWhiteboardRequest { Name = "架构图", Scene = "[1,2,3]" });

        Assert.False(result.Success);
    }

    [Fact]
    public async Task CreateAsync_合法请求落库并返回画板()
    {
        var repository = Substitute.For<IRepository<Whiteboard>>();
        var unitOfWork = Substitute.For<IUnitOfWork>();
        unitOfWork.Whiteboards.Returns(repository);
        Whiteboard? saved = null;
        await repository.AddAsync(Arg.Do<Whiteboard>(board => saved = board), Arg.Any<CancellationToken>());
        var service = new WhiteboardService(unitOfWork, CreateLocalizer());

        var result = await service.CreateAsync(new CreateWhiteboardRequest { Name = "  架构图  ", Scene = "{\"elements\":[]}" });

        Assert.True(result.Success);
        Assert.Equal("架构图", result.Data!.Name);
        Assert.Equal("{\"elements\":[]}", result.Data.Scene);
        Assert.NotNull(saved);
        Assert.False(saved!.IsDeleted);
        await unitOfWork.Received(1).SaveChangesAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task CreateAsync_场景为空时使用空白场景()
    {
        var (service, repository) = CreateService();
        Whiteboard? saved = null;
        await repository.AddAsync(Arg.Do<Whiteboard>(board => saved = board), Arg.Any<CancellationToken>());

        var result = await service.CreateAsync(new CreateWhiteboardRequest { Name = "草图" });

        Assert.True(result.Success);
        Assert.Equal("{}", saved!.Scene);
    }

    [Fact]
    public async Task UpdateAsync_画板不存在时返回失败()
    {
        var (service, repository) = CreateService();
        repository.GetByIdAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<Whiteboard?>(null));

        var result = await service.UpdateAsync(Guid.NewGuid(), new UpdateWhiteboardRequest { Name = "新名字" });

        Assert.False(result.Success);
    }

    [Fact]
    public async Task UpdateAsync_仅更新场景时保留原名称()
    {
        var (service, repository) = CreateService();
        var board = new Whiteboard { Id = Guid.NewGuid(), Name = "原名称", Scene = "{}" };
        repository.GetByIdAsync(board.Id, Arg.Any<CancellationToken>()).Returns(Task.FromResult<Whiteboard?>(board));

        var result = await service.UpdateAsync(board.Id, new UpdateWhiteboardRequest { Scene = "{\"elements\":[{}]}" });

        Assert.True(result.Success);
        Assert.Equal("原名称", result.Data!.Name);
        Assert.Equal("{\"elements\":[{}]}", result.Data.Scene);
    }

    [Fact]
    public async Task UpdateAsync_两个字段都为空时保持原样()
    {
        var (service, repository) = CreateService();
        var board = new Whiteboard { Id = Guid.NewGuid(), Name = "原名称", Scene = "{}" };
        repository.GetByIdAsync(board.Id, Arg.Any<CancellationToken>()).Returns(Task.FromResult<Whiteboard?>(board));

        var result = await service.UpdateAsync(board.Id, new UpdateWhiteboardRequest());

        Assert.True(result.Success);
        Assert.Equal("原名称", result.Data!.Name);
        Assert.Equal("{}", result.Data.Scene);
    }

    [Fact]
    public async Task UpdateAsync_场景非法时返回失败()
    {
        var (service, repository) = CreateService();
        var board = new Whiteboard { Id = Guid.NewGuid(), Name = "原名称", Scene = "{}" };
        repository.GetByIdAsync(board.Id, Arg.Any<CancellationToken>()).Returns(Task.FromResult<Whiteboard?>(board));

        var result = await service.UpdateAsync(board.Id, new UpdateWhiteboardRequest { Scene = "oops" });

        Assert.False(result.Success);
        await repository.DidNotReceive().UpdateAsync(Arg.Any<Whiteboard>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task DeleteAsync_软删除画板并刷新更新时间()
    {
        var (service, repository) = CreateService();
        var board = new Whiteboard { Id = Guid.NewGuid(), Name = "待删除", UpdatedAt = DateTimeOffset.UtcNow.AddDays(-1) };
        repository.GetByIdAsync(board.Id, Arg.Any<CancellationToken>()).Returns(Task.FromResult<Whiteboard?>(board));

        var result = await service.DeleteAsync(board.Id);

        Assert.True(result.Success);
        Assert.True(board.IsDeleted);
        Assert.True(board.UpdatedAt > DateTimeOffset.UtcNow.AddMinutes(-1));
        await repository.Received(1).UpdateAsync(board, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task DeleteAsync_画板不存在时返回失败()
    {
        var (service, repository) = CreateService();
        repository.GetByIdAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<Whiteboard?>(null));

        var result = await service.DeleteAsync(Guid.NewGuid());

        Assert.False(result.Success);
        await repository.DidNotReceive().UpdateAsync(Arg.Any<Whiteboard>(), Arg.Any<CancellationToken>());
    }
}
