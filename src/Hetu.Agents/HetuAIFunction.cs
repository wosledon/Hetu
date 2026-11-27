using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Core.Services.Tools;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;

namespace Hetu.Agents;

/// <summary>
/// 把 Hetu 的 <see cref="IToolExecutor"/> 暴露为 MAF 可直接调用的 <see cref="AIFunction"/>。
/// 这是业务工具到 MAF 的唯一工具边界；工具 schema 是运行时本地化的 JSON，无法用
/// <c>AIFunctionFactory</c> 的反射 schema 表达，因此保留此原生 <see cref="AIFunction"/> 实现。
/// 工具调用、审批状态、交互事件仍由 <see cref="ToolExecutionService"/> 承担。
/// </summary>
internal sealed class HetuAIFunction : AIFunction
{
    private const int MaxToolResultCharsForModel = 8_000;
    private const int MaxToolErrorCharsForModel = 16_000;

    private readonly IToolExecutor _executor;
    private readonly ToolExecutionService _toolExecution;
    private readonly CompressionPipelineService _compression;
    private readonly ILocalizer _localizer;
    private readonly AgentRunState _state;
    private readonly ILogger _logger;

    public HetuAIFunction(
        IToolExecutor executor,
        ToolExecutionService toolExecution,
        CompressionPipelineService compression,
        ILocalizer localizer,
        AgentRunState state,
        ILogger logger,
        string description,
        JsonElement jsonSchema)
    {
        _executor = executor;
        _toolExecution = toolExecution;
        _compression = compression;
        _localizer = localizer;
        _state = state;
        _logger = logger;
        Description = description;
        JsonSchema = jsonSchema;
    }

    public override string Name => _executor.Name;
    public override string Description { get; }
    public override JsonElement JsonSchema { get; }

    protected override async ValueTask<object?> InvokeCoreAsync(
        AIFunctionArguments? arguments = null,
        CancellationToken cancellationToken = default)
    {
        var dict = arguments?.ToDictionary(pair => pair.Key, pair => pair.Value)
                   ?? new Dictionary<string, object?>();
        var argumentsJson = JsonSerializer.Serialize(dict);
        var callId = FunctionInvokingChatClient.CurrentContext?.CallContent.CallId
                     ?? Guid.NewGuid().ToString("N");
        var call = new LlmToolCall { Id = callId, Name = Name, Arguments = argumentsJson };

        try
        {
            _state.CurrentIterationToolCalls++;
            if (++_state.ToolCallsThisIteration > _state.MaxToolCallsPerTurn)
            {
                var dropped = _localizer.T("toolExec.tooManyCallsDropped", _state.MaxToolCallsPerTurn);
                return await ReturnHiddenAsync(callId, dropped, isError: true);
            }

            var cacheKey = Name + "\0" + argumentsJson;
            if (_state.ReadResultCache.TryGetValue(cacheKey, out var cached))
            {
                var reused = _localizer.T("toolExec.reusedResult", Name, cached);
                return await ReturnHiddenAsync(callId, reused, isError: false);
            }
            if (_state.FailureCounts.TryGetValue(cacheKey, out var failures) && failures >= 2)
                return await ReturnHiddenAsync(callId, _localizer.T("toolExec.repeatedFailure", Name), isError: true);

            _state.CurrentIterationExecutableCalls++;
            if (_state.Hooks != null) await _state.Hooks.BeforeToolCallsAsync([call]);

            // MAF 的 ToolApprovalAgent/ApprovalRequiredAIFunction 已经完成审批，
            // 这里标记 Bypass，避免 ToolExecutionService 再次等待前端确认。
            var approvalOverrides = new Dictionary<string, ToolApprovalMode>(
                _state.Request.ToolApprovals, StringComparer.OrdinalIgnoreCase)
            {
                [Name] = ToolApprovalMode.Bypass,
            };

            var results = await _toolExecution.ExecuteToolCallsAsync(
                _state.Request.SessionId,
                [call],
                approvalOverrides,
                _state.SessionTodos,
                writeJsonAsync: payload => _state.Sink.OnEventAsync(payload),
                cancellationToken,
                decideToolCall: null,
                workScope: _state.Request.WorkScope,
                questionHandler: _state.Request.QuestionHandler,
                planHandler: _state.Request.PlanHandler,
                defaultToolTimeout: _state.Request.ToolTimeout,
                interactiveInputSupported: _state.Request.InteractiveToolsSupported);

            var (_, content, isError) = results[0];
            isError |= content.StartsWith("Error:", StringComparison.OrdinalIgnoreCase);

            _state.AppendToolCall(new AgentToolCallRecord
            {
                Id = callId,
                Name = Name,
                Arguments = argumentsJson,
                Result = content,
                IsError = isError,
            });
            if (_state.Hooks != null)
            {
                var execution = new AgentToolExecution { Call = call, Result = content, IsError = isError };
                await _state.Hooks.AfterToolResultAsync(execution);
                await _state.Hooks.AfterToolResultsAsync([execution]);
            }
            await _state.Sink.OnToolCallAsync(call);
            await _state.Sink.OnToolResultAsync(callId, content, isError);

            if (string.Equals(Name, "load_tools", StringComparison.OrdinalIgnoreCase))
                _state.ParseLoadedToolNames(argumentsJson);

            var compacted = Compact(
                await _compression.PrepareForContextAsync(content, cancellationToken),
                isError ? MaxToolErrorCharsForModel : MaxToolResultCharsForModel);

            if (isError)
            {
                _state.FailureCounts[cacheKey] = _state.FailureCounts.GetValueOrDefault(cacheKey) + 1;
            }
            else
            {
                _state.FailureCounts.Remove(cacheKey);
                _state.SegmentProgress = true;
                if (_executor.Risk == ToolRisk.Read)
                    _state.ReadResultCache[cacheKey] = compacted;
            }

            return compacted;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Agent] 工具 {Tool} 执行异常", Name);
            throw;
        }
    }

    /// <summary>缓存命中/重复失败/超量调用不执行工具，只补一条折叠的工具结果。</summary>
    private async Task<string> ReturnHiddenAsync(string callId, string content, bool isError)
    {
        _state.RecordedToolCallIds.Add(callId);
        await _state.Sink.OnEventAsync(new
        {
            type = "tool_result",
            id = callId,
            name = Name,
            content,
            isError,
            hidden = true,
        });
        return content;
    }

    private static string Compact(string content, int targetChars)
    {
        if (content.Length <= targetChars) return content;
        var headLength = Math.Max(1, targetChars * 2 / 3);
        var tailLength = Math.Max(1, targetChars - headLength);
        return $"[tool-output-compacted original_chars={content.Length}]\n{content[..headLength]}\n...\n{content[^tailLength..]}";
    }
}