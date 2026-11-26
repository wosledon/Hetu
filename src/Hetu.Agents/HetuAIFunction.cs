using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Core.Services;
using Hetu.Core.Services.Tools;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;

namespace Hetu.Agents;

/// <summary>
/// 把 Hetu 的 <see cref="IToolExecutor"/> 暴露为 MAF 可直接调用的 <see cref="AIFunction"/>。
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
            if (++_state.ToolCallsThisIteration > _state.MaxToolCallsPerTurn)
            {
                var dropped = _localizer.T("toolExec.tooManyCallsDropped", _state.MaxToolCallsPerTurn);
                await _state.Sink.OnEventAsync(new
                {
                    type = "tool_result",
                    id = callId,
                    name = Name,
                    content = dropped,
                    isError = true,
                    hidden = true,
                });
                return dropped;
            }

            if (_state.Hooks != null) await _state.Hooks.BeforeToolCallsAsync([call]);
            var results = await _toolExecution.ExecuteToolCallsAsync(
                _state.Request.SessionId,
                [call],
                _state.Request.ToolApprovals,
                _state.SessionTodos,
                writeEventAsync: payload => _state.Sink.OnEventAsync(payload),
                writeJsonAsync: payload => _state.Sink.OnEventAsync(payload),
                cancellationToken,
                decideToolCall: _state.Request.DecideToolCall,
                workScope: _state.Request.WorkScope,
                questionHandler: _state.Request.QuestionHandler,
                planHandler: _state.Request.PlanHandler,
                defaultToolTimeout: _state.Request.ToolTimeout,
                approvalAlreadyHandled: true);

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

            var compacted = await _compression.PrepareForContextAsync(content, cancellationToken);
            return Compact(compacted, isError ? MaxToolErrorCharsForModel : MaxToolResultCharsForModel);
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

    private static string Compact(string content, int targetChars)
    {
        if (content.Length <= targetChars) return content;
        var headLength = Math.Max(1, targetChars * 2 / 3);
        var tailLength = Math.Max(1, targetChars - headLength);
        return $"[tool-output-compacted original_chars={content.Length}]\n{content[..headLength]}\n...\n{content[^tailLength..]}";
    }
}