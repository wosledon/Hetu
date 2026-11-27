using System.Text.Json;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Services.Tools;

namespace Hetu.Core.Tests;

public class WorkToolPolicyTests
{
    [Theory]
    [InlineData(WorkPermissionMode.Plan, false)]
    [InlineData(WorkPermissionMode.ReadOnly, false)]
    [InlineData(WorkPermissionMode.Ask, true)]
    [InlineData(WorkPermissionMode.Auto, true)]
    [InlineData(WorkPermissionMode.Bypass, true)]
    public void Decide_写工具按权限模式折算(WorkPermissionMode mode, bool allowed)
    {
        var decision = WorkToolPolicy.Decide(WriteTool, WriteTool.Name, null, mode, null);

        Assert.Equal(allowed, decision.Allowed);
    }

    [Theory]
    [InlineData(WorkPermissionMode.Plan)]
    [InlineData(WorkPermissionMode.ReadOnly)]
    public void Decide_只读工具在计划与只读模式仍可执行(WorkPermissionMode mode)
    {
        var decision = WorkToolPolicy.Decide(ReadTool, ReadTool.Name, null, mode, null);

        Assert.True(decision.Allowed);
        Assert.Equal(ToolApprovalMode.Auto, decision.Mode);
    }

    [Fact]
    public void Decide_询问模式写工具需要确认()
        => Assert.Equal(ToolApprovalMode.Ask,
            WorkToolPolicy.Decide(WriteTool, WriteTool.Name, null, WorkPermissionMode.Ask, null).Mode);

    [Fact]
    public void Decide_Auto模式写工具自动执行()
        => Assert.Equal(ToolApprovalMode.Auto,
            WorkToolPolicy.Decide(WriteTool, WriteTool.Name, null, WorkPermissionMode.Auto, null).Mode);

    [Fact]
    public void Decide_Bypass模式全部放行()
        => Assert.Equal(ToolApprovalMode.Bypass,
            WorkToolPolicy.Decide(WriteTool, WriteTool.Name, null, WorkPermissionMode.Bypass, null).Mode);

    [Fact]
    public void Decide_项目拒绝规则覆盖Auto模式()
    {
        var rules = new[]
        {
            new WorkApprovalRule { ToolName = WriteTool.Name, Decision = "deny", IsEnabled = true }
        };

        var decision = WorkToolPolicy.Decide(WriteTool, WriteTool.Name, null, WorkPermissionMode.Auto, rules);

        Assert.False(decision.Allowed);
    }

    [Theory]
    [InlineData("plan", WorkPermissionMode.Plan)]
    [InlineData("readonly", WorkPermissionMode.ReadOnly)]
    [InlineData("ask", WorkPermissionMode.Ask)]
    [InlineData("auto", WorkPermissionMode.Auto)]
    [InlineData("bypass", WorkPermissionMode.Bypass)]
    [InlineData("invalid", WorkPermissionMode.Ask)]
    public void Parse_五档权限模式_非法值回落为Ask(string value, WorkPermissionMode expected)
        => Assert.Equal(expected, WorkToolPolicy.Parse(value));

    private static readonly JsonElement Schema = JsonDocument.Parse("""{"type":"object"}""").RootElement;

    private static readonly IToolExecutor WriteTool = new FakeTool("work_write_file", ToolRisk.Write);

    private static readonly IToolExecutor ReadTool = new FakeTool("work_read_file", ToolRisk.Read);

    private sealed class FakeTool(string name, ToolRisk risk) : IToolExecutor
    {
        public string Name => name;
        public string Description => name;
        public JsonElement ParametersSchema => Schema;
        public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
        public ToolRisk Risk => risk;
        public Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
            => Task.FromResult(ToolExecutionResult.Success(string.Empty));
    }
}