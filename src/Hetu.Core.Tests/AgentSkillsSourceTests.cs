using System.Linq.Expressions;
using Hetu.Agents;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Shared.AI;
using Hetu.Shared.Common;
using NSubstitute;

namespace Hetu.Core.Tests;

public class AgentSkillsSourceTests
{
    [Fact]
    public async Task LoadSkillsAsync_本地技能_适配为MAF技能()
    {
        var local = Substitute.For<ILocalSkillService>();
        local.ScanAllAsync(Arg.Any<CancellationToken>())
            .Returns(Task.FromResult(ApiResponse<List<LocalSkillDto>>.Ok(
            [
                new LocalSkillDto
                {
                    Id = "local:demo",
                    Name = "Demo Skill",
                    Description = "demo description",
                    IsEnabled = true,
                    Config = """{"systemPrompt":"system","promptTemplate":"do {{input}}"}""",
                },
            ])));

        var skills = Substitute.For<IRepository<Skill>>();
        skills.FindAsync(Arg.Any<Expression<Func<Skill, bool>>>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<IReadOnlyList<Skill>>([]));
        var unitOfWork = Substitute.For<IUnitOfWork>();
        unitOfWork.Skills.Returns(skills);

        var source = new HetuAgentSkillsSource(unitOfWork, local, ["local:demo"]);
        var result = await source.LoadSkillsAsync();

        var skill = Assert.Single(result);
        Assert.Equal("demo-skill", skill.Frontmatter.Name);
        Assert.Contains("system", await skill.GetContentAsync());
        Assert.Contains("do {{input}}", await skill.GetContentAsync());
    }
}