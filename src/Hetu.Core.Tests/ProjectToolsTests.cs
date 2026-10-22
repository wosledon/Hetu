using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;
using Hetu.Shared.Common;
using Hetu.Shared.Projects;
using NSubstitute;

namespace Hetu.Core.Tests;

/// <summary>
/// 内置项目工具的纯逻辑：SSH 项目创建、分组归类，以及部分更新不得清空未传字段（分组 / SSH 连接信息）。
/// </summary>
public class ProjectToolsTests
{
    private static readonly ManagedProjectDto SshProject = new()
    {
        Id = Guid.Parse("11111111-1111-1111-1111-111111111111"),
        Name = "远程服务器",
        ProjectType = "Ssh",
        DirectoryPath = "/root/app",
        SshHost = "10.0.0.8",
        SshPort = 2222,
        SshUser = "root",
        SshAuthType = "Key",
        SshKeyPath = "/home/u/.ssh/id_rsa",
        GroupId = Guid.Parse("22222222-2222-2222-2222-222222222222"),
        Category = "运维",
        Tags = ["prod"],
        SortOrder = 3,
    };

    private static (IManagedProjectService Service, List<CreateManagedProjectRequest> Created, List<UpdateManagedProjectRequest> Updated) CreateProjectService()
    {
        var service = Substitute.For<IManagedProjectService>();
        var created = new List<CreateManagedProjectRequest>();
        var updated = new List<UpdateManagedProjectRequest>();
        service.GetByIdAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(ApiResponse<ManagedProjectDto>.Ok(SshProject));
        service.CreateAsync(Arg.Do<CreateManagedProjectRequest>(r => created.Add(r)), Arg.Any<CancellationToken>())
            .Returns(callInfo => ApiResponse<ManagedProjectDto>.Ok(new ManagedProjectDto
            {
                Id = Guid.NewGuid(),
                Name = callInfo.Arg<CreateManagedProjectRequest>().Name,
                ProjectType = callInfo.Arg<CreateManagedProjectRequest>().ProjectType,
                GroupName = "运维",
            }));
        service.UpdateAsync(Arg.Any<Guid>(), Arg.Do<UpdateManagedProjectRequest>(r => updated.Add(r)), Arg.Any<CancellationToken>())
            .Returns(callInfo => ApiResponse<ManagedProjectDto>.Ok(new ManagedProjectDto
            {
                Id = callInfo.Arg<Guid>(),
                Name = callInfo.Arg<UpdateManagedProjectRequest>().Name,
            }));
        return (service, created, updated);
    }

    [Fact]
    public async Task CreateProjectTool_传入SSH与分组参数_生成Ssh项目请求()
    {
        var (service, created, _) = CreateProjectService();
        var tool = new CreateProjectTool(service);

        var result = await tool.ExecuteAsync("""
        {
            "name": "远程服务器",
            "directoryPath": "/root/app",
            "projectType": "ssh",
            "sshHost": "10.0.0.8",
            "sshPort": 2222,
            "sshUser": "root",
            "sshAuthType": "password",
            "sshPassword": "secret",
            "groupId": "22222222-2222-2222-2222-222222222222"
        }
        """);

        Assert.False(result.IsError);
        var request = Assert.Single(created);
        Assert.Equal("Ssh", request.ProjectType);
        Assert.Equal("10.0.0.8", request.SshHost);
        Assert.Equal(2222, request.SshPort);
        Assert.Equal("root", request.SshUser);
        Assert.Equal("Password", request.SshAuthType);
        Assert.Equal("secret", request.SshPassword);
        Assert.Equal(Guid.Parse("22222222-2222-2222-2222-222222222222"), request.GroupId);
    }

    [Fact]
    public async Task CreateProjectTool_缺少目录_返回错误且不创建()
    {
        var (service, created, _) = CreateProjectService();
        var tool = new CreateProjectTool(service);

        var result = await tool.ExecuteAsync("""{"name":"仅名称"}""");

        Assert.True(result.IsError);
        Assert.Empty(created);
    }

    [Fact]
    public async Task UpdateProjectTool_只改分类_保留分组与SSH连接信息()
    {
        var (service, _, updated) = CreateProjectService();
        var tool = new UpdateProjectTool(service);

        var result = await tool.ExecuteAsync("""
        {
            "id": "11111111-1111-1111-1111-111111111111",
            "category": "Web"
        }
        """);

        Assert.False(result.IsError);
        var request = Assert.Single(updated);
        Assert.Equal("Web", request.Category);
        // 未传字段必须沿用现值：漏传会把项目移出分组、抹掉 SSH 连接信息
        Assert.Equal(SshProject.GroupId, request.GroupId);
        Assert.Equal("Ssh", request.ProjectType);
        Assert.Equal(SshProject.SshHost, request.SshHost);
        Assert.Equal(SshProject.SshPort, request.SshPort);
        Assert.Equal(SshProject.SshUser, request.SshUser);
        Assert.Equal(SshProject.SshAuthType, request.SshAuthType);
        Assert.Equal(SshProject.SshKeyPath, request.SshKeyPath);
    }

    [Fact]
    public async Task UpdateProjectTool_传空分组ID_移出分组()
    {
        var (service, _, updated) = CreateProjectService();
        var tool = new UpdateProjectTool(service);

        await tool.ExecuteAsync("""
        {
            "id": "11111111-1111-1111-1111-111111111111",
            "groupId": ""
        }
        """);

        var request = Assert.Single(updated);
        Assert.Null(request.GroupId);
    }

    [Fact]
    public async Task UpdateProjectTool_切换为本地类型_按本地项目更新()
    {
        var (service, _, updated) = CreateProjectService();
        var tool = new UpdateProjectTool(service);

        await tool.ExecuteAsync("""
        {
            "id": "11111111-1111-1111-1111-111111111111",
            "projectType": "Local"
        }
        """);

        var request = Assert.Single(updated);
        Assert.Equal("Local", request.ProjectType);
    }

    [Fact]
    public async Task UpdateProjectTool_无效ID_返回错误()
    {
        var (service, _, updated) = CreateProjectService();
        var tool = new UpdateProjectTool(service);

        var result = await tool.ExecuteAsync("""{"id":"not-a-guid"}""");

        Assert.True(result.IsError);
        Assert.Empty(updated);
    }

    [Fact]
    public async Task UpdateProjectTool_分组传名称而非ID_返回错误且不更新()
    {
        var (service, _, updated) = CreateProjectService();
        var tool = new UpdateProjectTool(service);

        var result = await tool.ExecuteAsync("""
        {
            "id": "11111111-1111-1111-1111-111111111111",
            "groupId": "运维"
        }
        """);

        Assert.True(result.IsError);
        // 分组名当 ID 传时不能悄悄把项目移出分组
        Assert.Empty(updated);
    }

    private static IProjectGroupService CreateGroupService(List<ProjectGroupDto>? groups = null)
    {
        var service = Substitute.For<IProjectGroupService>();
        service.GetAllAsync(Arg.Any<CancellationToken>())
            .Returns(ApiResponse<List<ProjectGroupDto>>.Ok(groups ?? []));
        service.CreateAsync(Arg.Any<CreateProjectGroupRequest>(), Arg.Any<CancellationToken>())
            .Returns(callInfo => ApiResponse<ProjectGroupDto>.Ok(new ProjectGroupDto
            {
                Id = Guid.NewGuid(),
                Name = callInfo.Arg<CreateProjectGroupRequest>().Name,
            }));
        service.UpdateAsync(Arg.Any<Guid>(), Arg.Any<UpdateProjectGroupRequest>(), Arg.Any<CancellationToken>())
            .Returns(callInfo => ApiResponse<ProjectGroupDto>.Ok(new ProjectGroupDto
            {
                Id = callInfo.Arg<Guid>(),
                Name = callInfo.Arg<UpdateProjectGroupRequest>().Name,
            }));
        service.DeleteAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(ApiResponse.Ok());
        return service;
    }

    [Fact]
    public async Task CreateProjectGroupTool_传名称与说明_创建分组()
    {
        var service = CreateGroupService();
        var tool = new CreateProjectGroupTool(service);

        var result = await tool.ExecuteAsync("""{"name":"  Hetu 相关  ","description":" Hetu 家族仓库 "}""");

        Assert.False(result.IsError);
        // 名称在工具内 trim，说明原样透传由服务端归一化（与 create_project 一致）
        await service.Received().CreateAsync(
            Arg.Is<CreateProjectGroupRequest>(r => r.Name == "Hetu 相关" && r.Description == " Hetu 家族仓库 "),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task UpdateProjectGroupTool_只传新名称_保持说明与排序()
    {
        var groupId = Guid.Parse("33333333-3333-3333-3333-333333333333");
        var service = CreateGroupService([new ProjectGroupDto
        {
            Id = groupId,
            Name = "旧名称",
            Description = "原说明",
            SortOrder = 7,
        }]);
        var tool = new UpdateProjectGroupTool(service);

        var result = await tool.ExecuteAsync("""
        {
            "id": "33333333-3333-3333-3333-333333333333",
            "name": "新名称"
        }
        """);

        Assert.False(result.IsError);
        await service.Received().UpdateAsync(
            groupId,
            Arg.Is<UpdateProjectGroupRequest>(r =>
                r.Name == "新名称" && r.Description == "原说明" && r.SortOrder == 7),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task UpdateProjectGroupTool_分组不存在_返回错误()
    {
        var service = CreateGroupService();
        var tool = new UpdateProjectGroupTool(service);

        var result = await tool.ExecuteAsync("""{"id":"33333333-3333-3333-3333-333333333333","name":"新名称"}""");

        Assert.True(result.IsError);
        await service.DidNotReceive().UpdateAsync(Arg.Any<Guid>(), Arg.Any<UpdateProjectGroupRequest>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task DeleteProjectGroupTool_传ID_删除分组()
    {
        var service = CreateGroupService();
        var tool = new DeleteProjectGroupTool(service);

        var result = await tool.ExecuteAsync("""{"id":"33333333-3333-3333-3333-333333333333"}""");

        Assert.False(result.IsError);
        await service.Received().DeleteAsync(Guid.Parse("33333333-3333-3333-3333-333333333333"), Arg.Any<CancellationToken>());
    }
}
