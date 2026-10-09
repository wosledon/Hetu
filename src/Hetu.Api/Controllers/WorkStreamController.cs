using System.Text;
using System.Text.Json;
using Hetu.Api.Services;
using Hetu.Api.Streaming;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Profiles;
using Hetu.Core.Services;
using Hetu.Core.Services.Tools;
using Hetu.Core.Services.Work;
using Hetu.Core.Utilities;
using Hetu.Shared.Common;
using Hetu.Shared.Work;
using Microsoft.AspNetCore.Mvc;
using Serilog;

namespace Hetu.Api.Controllers;

/// <summary>
/// 工作会话消息流式生成：绑定 Work Profile + 项目内文件工具，
/// 通过 SSE 推送内容 / thinking / tool_call / tool_result / 文件变更事件。
/// </summary>
[ApiController]
[Route("api/work-sessions")]
public class WorkStreamController : ControllerBase
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IWorkSessionService _sessionService;
    private readonly IWorkCheckpointService _checkpointService;
    private readonly ILLMProviderFactory _llmProviderFactory;
    private readonly ToolExecutionService _toolExecution;
    private readonly ToolRegistry _toolRegistry;
    private readonly AgentLoopService _agentLoop;
    private readonly ILocalSkillService _localSkillService;
    private readonly IWorkCodeIndexRefreshQueue _codeIndexRefreshQueue;
    private readonly IWorkCommandRunnerFactory _commandRunnerFactory;
    private readonly ILlmUsageRecorder _llmUsageRecorder;
    private readonly MentionContextBuilder _mentionContext;
    private readonly ChatContextInjector _contextInjector;
    private readonly ContextCompactionService _contextCompaction;
    private readonly ILogger<WorkStreamController> _logger;

    public WorkStreamController(
        IUnitOfWork unitOfWork,
        IWorkSessionService sessionService,
        IWorkCheckpointService checkpointService,
        ILLMProviderFactory llmProviderFactory,
        ToolExecutionService toolExecution,
        ToolRegistry toolRegistry,
        AgentLoopService agentLoop,
        ILocalSkillService localSkillService,
        IWorkCodeIndexRefreshQueue codeIndexRefreshQueue,
        IWorkCommandRunnerFactory commandRunnerFactory,
        ILlmUsageRecorder llmUsageRecorder,
        MentionContextBuilder mentionContext,
        ChatContextInjector contextInjector,
        ContextCompactionService contextCompaction,
        ILogger<WorkStreamController> logger)
    {
        _unitOfWork = unitOfWork;
        _sessionService = sessionService;
        _checkpointService = checkpointService;
        _llmProviderFactory = llmProviderFactory;
        _toolExecution = toolExecution;
        _toolRegistry = toolRegistry;
        _agentLoop = agentLoop;
        _localSkillService = localSkillService;
        _codeIndexRefreshQueue = codeIndexRefreshQueue;
        _commandRunnerFactory = commandRunnerFactory;
        _llmUsageRecorder = llmUsageRecorder;
        _mentionContext = mentionContext;
        _contextInjector = contextInjector;
        _contextCompaction = contextCompaction;
        _logger = logger;
    }

    /// <summary>会话历史注入 LLM 的最大文本消息数，超出部分做摘要压缩</summary>
    private const int MaxHistoryMessages = 40;

    /// <summary>每个会话保留的检查点数量</summary>
    private const int MaxCheckpointsPerSession = 30;

    [HttpPost("{sessionId:guid}/stream")]
    public async Task Stream(Guid sessionId, [FromBody] SendWorkMessageRequest request, CancellationToken ct = default)
    {
        Response.StartSseStream();

        var writer = new SseStreamWriter(Response, ct);

        var sessionResult = await _sessionService.GetByIdAsync(sessionId, ct);
        if (!sessionResult.Success || sessionResult.Data == null)
        {
            await writer.WriteErrorAsync("工作会话不存在");
            return;
        }
        var session = sessionResult.Data;

        // 设置项目上下文，供项目内工具使用
        var project = await _unitOfWork.WorkProjects.GetByIdAsync(session.ProjectId, ct);
        if (project == null)
        {
            await writer.WriteErrorAsync("项目不存在");
            return;
        }

        // 项目命令执行器：SSH 项目的文件/命令工具全部走远端 shell 执行
        var runner = _commandRunnerFactory.Create(project);

        // 权限模式：请求 > 会话持久值；请求里带了就顺带持久化
        // Agent 模式：autopilot 下询问档位提升为自动执行（计划/只读为用户显式约束，保持）
        var permissionMode = AgentModePolicy.Apply(
            request.AgentMode ?? session.AgentMode,
            ResolvePermissionMode(request, session));
        if (WorkToolPolicy.IsValidValue(request.PermissionMode) &&
            !string.Equals(WorkToolPolicy.ToValue(permissionMode), session.PermissionMode, StringComparison.OrdinalIgnoreCase))
        {
            var entity = await _unitOfWork.WorkSessions.GetByIdAsync(sessionId, ct);
            if (entity != null)
            {
                entity.PermissionMode = WorkToolPolicy.ToValue(permissionMode);
                entity.UpdatedAt = DateTimeOffset.UtcNow;
                await _unitOfWork.WorkSessions.UpdateAsync(entity, ct);
                await _unitOfWork.SaveChangesAsync(ct);
                session.PermissionMode = entity.PermissionMode;
            }
        }
        if (AgentModePolicy.IsValid(request.AgentMode) &&
            !string.Equals(AgentModePolicy.Normalize(request.AgentMode), session.AgentMode, StringComparison.OrdinalIgnoreCase))
        {
            var entity = await _unitOfWork.WorkSessions.GetByIdAsync(sessionId, ct);
            if (entity != null)
            {
                entity.AgentMode = AgentModePolicy.Normalize(request.AgentMode);
                entity.UpdatedAt = DateTimeOffset.UtcNow;
                await _unitOfWork.WorkSessions.UpdateAsync(entity, ct);
                await _unitOfWork.SaveChangesAsync(ct);
                session.AgentMode = entity.AgentMode;
            }
        }

        var approvalRules = await _unitOfWork.WorkApprovalRules.FindAsync(r => r.ProjectId == project.Id, ct);

        // 项目挂载的 MCP 服务器 → 注册为本会话运行时工具（ToolExecutionService 会重建子作用域，需显式传递）
        var runtimeTools = new List<IToolExecutor>();
        var mcpToolNames = new List<string>();
        if (request.EnableTools && !string.IsNullOrWhiteSpace(project.McpServerIds))
        {
            try
            {
                mcpToolNames = await _agentLoop.LoadMcpToolsAsync(ParseGuidList(project.McpServerIds), ct);
                runtimeTools = _toolRegistry.GetByNames(mcpToolNames).ToList();
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "[WorkStream] 加载 MCP 工具失败 projectId={ProjectId}", project.Id);
            }
        }

        // 保存用户消息（重新生成时跳过，避免历史重复）
        if (request.PersistUserMessage)
        {
            var userMsg = await _sessionService.AddMessageAsync(sessionId, "user", request.Content ?? "", cancellationToken: ct);
            if (!userMsg.Success)
            {
                await writer.WriteErrorAsync(userMsg.Error ?? "保存消息失败");
                return;
            }
        }

        // 解析模型
        var (provider, modelId) = await _llmProviderFactory.ResolveAsync(request.ModelId, session.ModelId, ct);

        if (provider == null)
        {
            await writer.WriteErrorAsync("未找到可用的对话模型");
            return;
        }

        // 构建历史 + 工具
        var messagesResult = await _sessionService.GetMessagesAsync(sessionId, ct);
        var history = messagesResult.Data ?? [];

        // 上下文超限自动压缩：占用达到窗口 80% 时先用当前模型压出摘要，再继续本轮
        var autoSummary = await _contextCompaction.TryAutoCompactWorkAsync(sessionId, request.ContextWindow, ct);
        if (autoSummary != null)
        {
            await writer.WriteJsonAsync(new { type = "notice", kind = "compacted", text = "上下文接近上限，已自动压缩为摘要" });
            _logger.LogInformation("[Context] 自动压缩生效 sessionId={SessionId}", sessionId);
        }

        var sessionEntity = await _unitOfWork.WorkSessions.GetByIdAsync(sessionId, ct);
        var chatMessages = BuildChatHistory(
            history,
            request.ContextWindow,
            autoSummary ?? sessionEntity?.ContextSummary,
            sessionEntity?.ContextSummaryThroughMessageId);

        // 输入框 @ 引用（笔记 / 笔记本 / 标签 / 知识库）：与对话会话共用同一份注入规则
        var mentionCount = await _mentionContext.BuildAsync(request.Mentions, chatMessages, ct);
        if (mentionCount > 0) await writer.WriteJsonAsync(new { type = "mentions", count = mentionCount });

        // 图片附件（视觉模型多模态输入）：与对话会话共用同一挂载规则
        ChatContextInjector.AttachImages(request.Images, provider, chatMessages);

        // 网络搜索 / 知识库 / 记忆：与对话会话共用同一套 RAG 注入与 SSE 事件
        await _contextInjector.InjectRagAsync(
            request.WebSearch, request.KnowledgeBase, request.Memory, request.Content ?? string.Empty, chatMessages, writer, provider, ct);

        var profile = BuiltinProfiles.Work;
        var allowedTools = profile.AllowedTools.Concat(mcpToolNames).ToList();
        var systemPromptParts = new List<string>
        {
            profile.IdentityPrompt,
            profile.PrinciplePrompt,
            profile.FormatPrompt,
            profile.SafetyPrompt,
            $"\n当前项目: {project.Name}\n项目根目录: {project.RootPath}",
            $"权限模式: {WorkToolPolicy.ToValue(permissionMode)}（plan 计划模式只读调研 / readonly 只读 / ask 写操作询问 / auto 自动执行 / bypass 全部放行）",
            BuildToolGuideline(allowedTools),
        };

        // 智能体（提示词预设）附加系统提示
        if (!string.IsNullOrWhiteSpace(request.AgentPrompt))
            systemPromptParts.Add($"【当前智能体】\n{request.AgentPrompt.Trim()}");

        if (permissionMode == WorkPermissionMode.Plan)
        {
            systemPromptParts.Add("""
                \n【计划模式】
                本轮为纯调研，所有写操作与命令执行都被拦截，只有只读工具可用。
                请充分利用只读工具（work_read_file / work_glob / work_grep / work_semantic_search / work_list_dir / work_task）摸清现状，
                然后输出一份可执行的实施计划：目标、涉及文件（含路径）、分步改动要点、验证方式、风险点。
                不要尝试修改任何文件；计划结束后会由用户切换到执行模式再动手。
                """);
        }
        else if (mcpToolNames.Count > 0)
        {
            systemPromptParts.Add($"\n已启用外部 MCP 工具：{string.Join(", ", mcpToolNames)}");
        }

        var skillsContext = await BuildSkillsContextAsync(project.SkillIds, ct);
        if (!string.IsNullOrWhiteSpace(skillsContext))
            systemPromptParts.Add(skillsContext);

        var ruleContext = WorkProjectRules.LoadRuleContext(project.RootPath);
        if (!string.IsNullOrWhiteSpace(ruleContext))
            systemPromptParts.Add($"\n项目规则（来自仓库内的约定文件，必须遵守）：\n{ruleContext}");

        // GitHub Copilot 兼容：自动加载 .github 下的指令 / 智能体 / 提示词 / 技能
        var copilotAssets = WorkCopilotAssets.Load(project.RootPath);
        var copilotContext = WorkCopilotAssets.BuildContext(copilotAssets, project.RootPath);
        if (!string.IsNullOrWhiteSpace(copilotContext))
            systemPromptParts.Add($"\n{copilotContext}");

        // /prompt 模板：读取 .github/prompts 下的文件内容并注入 system prompt
        if (!string.IsNullOrWhiteSpace(request.PromptFile))
        {
            var promptFull = WorkPath.Resolve(project.RootPath, request.PromptFile);
            if (promptFull != null && System.IO.File.Exists(promptFull) && WorkProjectRules.IsProbablyText(promptFull))
            {
                try
                {
                    var promptBody = (await System.IO.File.ReadAllTextAsync(promptFull, ct)).Trim();
                    var (_, promptInstruction) = WorkCopilotAssets.SplitPromptBody(promptBody);
                    if (!string.IsNullOrWhiteSpace(promptInstruction))
                        systemPromptParts.Add($"\n【/{Path.GetFileNameWithoutExtension(Path.GetFileNameWithoutExtension(request.PromptFile))} 提示词模板（来自 {request.PromptFile}，本轮必须严格按此执行）】\n{promptInstruction}");
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    // 模板文件不可读时不注入，让 Agent 按用户原文执行
                }
            }
        }

        // /skill 命令：提示 Agent 先用 work_skill 读取完整技能说明
        if (!string.IsNullOrWhiteSpace(request.SkillName))
            systemPromptParts.Add($"\n用户通过 /{request.SkillName} 选择了技能：请先调用 work_skill 读取「{request.SkillName}」的完整说明，再严格按说明执行。");

        var gitContext = await WorkProjectRules.BuildGitContextAsync(project.RootPath, ct);
        if (!string.IsNullOrWhiteSpace(gitContext))
            systemPromptParts.Add($"\n版本控制状态：\n{gitContext}");

        var options = new ChatOptions
        {
            // ModelId 留空：provider 创建时已注入正确的模型名
            Stream = true,
            SystemPrompt = string.Join("\n\n", systemPromptParts),
        };

        // 推理强度 / 深度思考：native 模型用强度，tag 模型用系统提示（与对话会话同一套规则）
        if (!string.IsNullOrWhiteSpace(request.ReasoningEffort) || request.DeepThinking)
        {
            var effortModelId = Guid.TryParse(request.ModelId, out var requestedEffortModel) ? requestedEffortModel : session.ModelId ?? Guid.Empty;
            var effortModel = effortModelId != Guid.Empty
                ? await _unitOfWork.AiModels.GetByIdAsync(effortModelId, ct)
                : await _unitOfWork.AiModels.GetDefaultByPurposeAsync("chat", ct);
            var reasoningMode = effortModel?.ReasoningMode;
            if (effortModel != null && string.Equals(reasoningMode, "native", StringComparison.OrdinalIgnoreCase)
                && !string.IsNullOrWhiteSpace(request.ReasoningEffort))
            {
                options.ReasoningEffort = request.ReasoningEffort;
                if (effortModel.ReasoningBudgetTokens is > 0) options.ReasoningBudgetTokens = effortModel.ReasoningBudgetTokens;
            }
            ChatContextInjector.ApplyDeepThinking(request.DeepThinking, reasoningMode, options);
        }

        var overrides = new Dictionary<string, ToolApprovalMode>();
        var allowedToolNames = request.EnableTools ? allowedTools : new List<string>();
        if (request.EnableTools)
        {
            options.Tools = _toolRegistry.ToToolDefinitions(allowedTools);
            options.ToolChoice = "auto";
        }

        var fileChanges = new List<object>();
        var usageTotal = new WorkMessageUsage();
        var executedToolNames = new List<string>();
        var sink = new SseAgentSink(writer, this, sessionId);
        var hooks = new WorkStreamHooks(this, sessionId, project, runner, writer, fileChanges, executedToolNames);

        var loopResult = await _agentLoop.RunAsync(new AgentLoopRequest
        {
            ModelId = modelId,
            SystemPrompt = options.SystemPrompt ?? string.Empty,
            Messages = chatMessages,
            ToolNames = allowedToolNames,
            McpServerIds = new List<Guid>(),
            MaxIterations = profile.MaxAgentIterations,
            MaxToolCallsPerTurn = profile.MaxToolCallsPerTurn,
            ToolApprovals = overrides,
            SessionId = sessionId.ToString(),
            Sink = sink,
            Hooks = hooks,
            EnableTools = request.EnableTools,
            DecideToolCall = request.EnableTools
                ? AgentToolPolicy.CreateDecider(
                    _toolRegistry,
                    new AgentPolicyContext { Mode = permissionMode, Rules = approvalRules })
                : null,
            WorkScope = new WorkToolScope
            {
                ProjectRoot = project.RootPath,
                ProjectId = project.Id,
                ModelId = modelId,
                DiagnosticsCommand = project.DiagnosticsCommand,
                // SSH 项目的文件/命令工具全部走远端执行
                Runner = runner,
                RuntimeTools = runtimeTools
            },
        }, ct);

        // 累计用量：以循环结果为准，前端顶栏实时值由 sink 已推送
        if (loopResult.Usage.TotalTokens > 0) usageTotal.TotalTokens = loopResult.Usage.TotalTokens;
        usageTotal.PromptTokens = loopResult.Usage.PromptTokens;
        usageTotal.CompletionTokens = loopResult.Usage.CompletionTokens;
        usageTotal.CachedTokens = loopResult.Usage.CachedTokens;
        if (loopResult.Usage.TotalTokens > 0) usageTotal.LatencyMs = hooks.LastIterationMs;

        var loopError = loopResult.Error;
        var finalContent = loopResult.Content.Trim();
        if (loopError != null && string.IsNullOrEmpty(finalContent))
            finalContent = $"处理请求时出错: {loopError}";
        // 模型只发起工具调用而没有正文时也要落库，否则下一轮会丢失这轮上下文
        if (string.IsNullOrEmpty(finalContent) && executedToolNames.Count > 0)
        {
            var names = string.Join("、", executedToolNames.Distinct());
            finalContent = $"（本轮未输出正文，已调用工具：{names}）";
        }

        if (!string.IsNullOrEmpty(finalContent))
        {
            await _sessionService.AddMessageAsync(
                sessionId, "assistant", finalContent, "text", modelId: modelId,
                usage: usageTotal.TotalTokens > 0 ? usageTotal : null,
                cancellationToken: CancellationToken.None);
        }

        await _llmUsageRecorder.RecordAsync(
            LlmUsageSources.Work,
            loopResult.Usage.TotalTokens > 0 ? loopResult.Usage : null,
            refId: sessionId,
            modelId: modelId,
            latencyMs: usageTotal.LatencyMs > 0 ? usageTotal.LatencyMs : null,
            contentPreview: request.Content,
            ct: CancellationToken.None);

        // 保存文件变更事件消息（供历史回放展示）
        foreach (var change in fileChanges)
        {
            var json = JsonSerializer.Serialize(change);
            await _sessionService.AddMessageAsync(sessionId, "system", "", "file_change", json, cancellationToken: CancellationToken.None);
        }

        // 文件有改动时排队刷新代码索引（去抖 + 仅刷新已建索引的项目）
        if (fileChanges.Count > 0 && session.ProjectId != Guid.Empty)
        {
            try { _codeIndexRefreshQueue.Enqueue(session.ProjectId); }
            catch (Exception ex) { Log.Debug(ex, "[WorkStream] 代码索引刷新入队失败"); }
        }

        try { await _unitOfWork.SaveChangesAsync(ct); } catch { }

        await writer.WriteJsonAsync(new { type = "done" });
    }

    /// <summary>把 Agent Loop 事件写进 SSE 流。</summary>
    private sealed class SseAgentSink : IAgentLoopSink
    {
        private readonly SseStreamWriter _writer;
        private readonly WorkStreamController _owner;
        private readonly Guid _sessionId;

        public SseAgentSink(SseStreamWriter writer, WorkStreamController owner, Guid sessionId)
        {
            _writer = writer;
            _owner = owner;
            _sessionId = sessionId;
        }

        public Task OnContentAsync(string text) => _writer.WriteJsonAsync(new { type = "content", text });

        public Task OnThinkingAsync(string text) => _writer.WriteJsonAsync(new { type = "thinking", text });

        public Task OnDebugAsync(string text) => _writer.WriteDebugAsync(text);

        public Task OnErrorAsync(string message) => _writer.WriteErrorAsync($"处理请求时出错: {message}");

        /// <summary>tool_call / tool_result / approval_request / question / todo / plan / subagent 一律直通写帧</summary>
        public async Task OnEventAsync(object payload)
        {
            await _writer.WriteJsonAsync(payload);
            await _owner.PersistSubagentEventAsync(_sessionId, payload);
        }

        public async Task OnUsageAsync(LlmUsage usage)
        {
            await _writer.WriteJsonAsync(new
            {
                type = "usage",
                promptTokens = usage.PromptTokens,
                completionTokens = usage.CompletionTokens,
                cachedTokens = usage.CachedTokens,
                totalTokens = usage.TotalTokens,
                latencyMs = 0,
            });
        }
    }

    /// <summary>
    /// 编码会话的执行过程钩子：思考落库、改动前打检查点、改动后记录文件变更与工具结果。
    /// </summary>
    private sealed class WorkStreamHooks : IAgentLoopHooks
    {
        private readonly WorkStreamController _owner;
        private readonly Guid _sessionId;
        private readonly WorkProject _project;
        private readonly IWorkCommandRunner _runner;
        private readonly SseStreamWriter _writer;
        private readonly List<object> _fileChanges;
        private readonly List<string> _executedToolNames;
        private List<PlannedChange> _planned = new();
        private readonly Dictionary<string, string?> _oldContents = new(StringComparer.Ordinal);
        private int _iteration;
        private System.Diagnostics.Stopwatch _iterationClock = System.Diagnostics.Stopwatch.StartNew();

        public WorkStreamHooks(
            WorkStreamController owner,
            Guid sessionId,
            WorkProject project,
            IWorkCommandRunner runner,
            SseStreamWriter writer,
            List<object> fileChanges,
            List<string> executedToolNames)
        {
            _owner = owner;
            _sessionId = sessionId;
            _project = project;
            _runner = runner;
            _writer = writer;
            _fileChanges = fileChanges;
            _executedToolNames = executedToolNames;
        }

        /// <summary>最近一次迭代耗时（Provider 未分批上报 latency 时用于会话累计）</summary>
        public int LastIterationMs { get; private set; }

        public async Task OnIterationAsync(int iteration, string content, string thinking, LlmUsage? usage)
        {
            _iteration = iteration;
            LastIterationMs = (int)_iterationClock.ElapsedMilliseconds;
            _iterationClock.Restart();

            // 思考过程落库：结束后历史回放时仍可见（完整保存，不截断）
            if (!string.IsNullOrWhiteSpace(thinking))
            {
                await _owner._sessionService.AddMessageAsync(
                    _sessionId, "assistant", thinking, "thought",
                    cancellationToken: CancellationToken.None);
            }
        }

        public async Task BeforeToolCallsAsync(IReadOnlyList<LlmToolCall> toolCalls)
        {
            // 预解析本轮会改动哪些文件（供检查点 + 变更记录）
            _planned = PlanFileMutations(toolCalls.ToList());
            _oldContents.Clear();
            foreach (var change in _planned)
                _oldContents[ChangeKey(change.ToolCallId, change.Path)] =
                    await TryReadFileAsync(_runner, _project.RootPath, change.Path, CancellationToken.None);

            // 改动执行前打检查点，支持整轮回滚
            await _owner.CreateCheckpointAsync(_project.Id, _sessionId, _iteration, _planned, CancellationToken.None, _writer);
        }

        public async Task AfterToolResultsAsync(IReadOnlyList<AgentToolExecution> results)
        {
            _executedToolNames.AddRange(results.Select(r => r.Call.Name));

            // 文件变更事件 + 落库记录（供 diff 页展示）：以执行后的真实磁盘内容为准，失败的写操作不记变更
            foreach (var change in _planned)
            {
                try
                {
                    var toolCallKey = ChangeKey(change.ToolCallId, change.Path);
                    _oldContents.TryGetValue(toolCallKey, out var oldContent);
                    var newContent = await TryReadFileAsync(_runner, _project.RootPath, change.Path, CancellationToken.None);
                    if (newContent == oldContent) continue;

                    var action = newContent == null ? "delete" : oldContent == null ? "create" : "write";
                    await _owner._unitOfWork.WorkFileChanges.AddAsync(new WorkFileChange
                    {
                        Id = Guid.NewGuid(),
                        ProjectId = _project.Id,
                        SessionId = _sessionId,
                        FilePath = change.Path,
                        OldContent = oldContent,
                        NewContent = newContent ?? "",
                        Action = action,
                        CreatedAt = DateTimeOffset.UtcNow,
                        UpdatedAt = DateTimeOffset.UtcNow
                    }, CancellationToken.None);

                    var evt = new { type = "file_change", path = change.Path, action };
                    _fileChanges.Add(evt);
                    await _writer.WriteJsonAsync(evt);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException)
                {
                    Log.Warning(ex, "[WorkStream] 记录文件变更失败 path={Path}", change.Path);
                }
            }

            // 工具调用落库：参数进 metadata，结果截断进正文，供历史回放
            foreach (var result in results)
            {
                await _owner._sessionService.AddMessageAsync(
                    _sessionId, "assistant", Truncate(result.Result ?? string.Empty), "tool",
                    metadata: JsonSerializer.Serialize(new
                    {
                        name = result.Call.Name,
                        arguments = result.Call.Arguments,
                    }),
                    cancellationToken: CancellationToken.None);
            }
        }
    }

    /// <summary>子 Agent 进度事件落库（仅 subagent 帧），供历史回放</summary>
    private async Task PersistSubagentEventAsync(Guid sessionId, object payload)
    {
        try
        {
            var json = JsonSerializer.SerializeToElement(payload);
            if (json.ValueKind != JsonValueKind.Object ||
                !json.TryGetProperty("type", out var typeEl) ||
                typeEl.GetString() != "subagent")
                return;

            var description = json.TryGetProperty("description", out var d) ? d.GetString() ?? "" : "";
            var metadata = JsonSerializer.Serialize(new
            {
                id = json.TryGetProperty("id", out var idEl) ? idEl.GetString() : null,
                stage = json.TryGetProperty("stage", out var s) ? s.GetString() : null,
                tool = json.TryGetProperty("tool", out var t) ? t.GetString() : null,
                steps = json.TryGetProperty("steps", out var st) && st.TryGetInt32(out var steps) ? steps : (int?)null,
                message = json.TryGetProperty("message", out var m) ? m.GetString() : null,
            });
            await _sessionService.AddMessageAsync(
                sessionId, "assistant", Truncate(description), "subagent", metadata,
                cancellationToken: CancellationToken.None);
        }
        catch (Exception ex)
        {
            Log.Debug(ex, "[WorkStream] 子 Agent 事件落库失败");
        }
    }

    private static string Truncate(string text, int max = 4000)
        => string.IsNullOrEmpty(text) || text.Length <= max ? text : text[..max] + "\n…（内容过长已截断）";

    /// <summary>解析本轮生效的权限模式：请求显式指定优先，其次兼容旧的 ToolApprovalMode，最后回落到会话持久值</summary>
    private static WorkPermissionMode ResolvePermissionMode(SendWorkMessageRequest request, WorkSessionDto session)
    {
        if (WorkToolPolicy.IsValidValue(request.PermissionMode))
            return WorkToolPolicy.Parse(request.PermissionMode);

        if (!string.IsNullOrWhiteSpace(request.ToolApprovalMode) &&
            Enum.TryParse<ToolApprovalMode>(request.ToolApprovalMode, true, out var legacy))
        {
            return legacy switch
            {
                ToolApprovalMode.Bypass => WorkPermissionMode.Bypass,
                ToolApprovalMode.Auto => WorkPermissionMode.Auto,
                _ => WorkPermissionMode.Ask
            };
        }

        return WorkToolPolicy.Parse(session.PermissionMode);
    }

    /// <summary>解析项目上以 JSON 数组保存的 Guid 列表</summary>
    private static List<Guid> ParseGuidList(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            return JsonSerializer.Deserialize<List<Guid>>(json) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    /// <summary>项目启用的技能 → system prompt 中的技能索引</summary>
    private async Task<string> BuildSkillsContextAsync(string? skillIdsJson, CancellationToken ct)
    {
        var skillIds = ParseStrings(skillIdsJson);
        if (skillIds.Count == 0) return string.Empty;

        var scan = await _localSkillService.ScanAllAsync(ct);
        var skills = scan.Data?.Where(s => s.IsEnabled && skillIds.Contains(s.Id, StringComparer.OrdinalIgnoreCase)).ToList();
        if (skills == null || skills.Count == 0) return string.Empty;

        var sb = new StringBuilder("\n项目启用的技能（需要详细步骤时用 work_skill 读取全文）：");
        foreach (var skill in skills)
        {
            sb.AppendLine();
            sb.Append($"- {skill.Name}（id: {skill.Id}）");
            if (!string.IsNullOrWhiteSpace(skill.Description)) sb.Append($": {skill.Description}");
        }
        return sb.ToString();
    }

    private static List<string> ParseStrings(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            return JsonSerializer.Deserialize<List<string>>(json) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    /// <summary>把工具清单与使用指引拼成 system prompt 片段</summary>
    private string BuildToolGuideline(IReadOnlyCollection<string> toolNames)
    {
        var sb = new StringBuilder("工具使用约定：");
        foreach (var executor in _toolRegistry.GetByNames(toolNames.ToList()))
        {
            sb.AppendLine();
            sb.Append($"- {executor.Name}: {executor.Description}");
            if (!string.IsNullOrWhiteSpace(executor.UsageGuideline))
                sb.Append($"（{executor.UsageGuideline}）");
        }
        return sb.ToString();
    }

    /// <summary>
    /// 历史压缩：保留最近 N 条文本消息，更早的内容折叠为一条摘要说明，
    /// 避免长会话把上下文窗口顶满。传入 contextWindow（token）时再按 ~3 字符/token 的预算从最早处裁剪。
    /// </summary>
    private List<LlmChatMessage> BuildChatHistory(
        List<WorkMessageDto> history,
        int? contextWindow = null,
        string? contextSummary = null,
        Guid? summaryThroughMessageId = null)
    {
        var texts = history.Where(m => m.Type == "text").ToList();

        // 已压缩部分：摘要覆盖的消息不再进入上下文，只保留摘要本身
        var summarizedCount = 0;
        if (summaryThroughMessageId is { } throughId && throughId != Guid.Empty)
        {
            var index = texts.FindIndex(m => m.Id == throughId);
            if (index >= 0) summarizedCount = index + 1;
        }
        if (summarizedCount > 0) texts = texts.Skip(summarizedCount).ToList();

        List<LlmChatMessage> messages;
        if (texts.Count <= MaxHistoryMessages)
        {
            messages = texts.Select(m => new LlmChatMessage { Role = m.Role, Content = m.Content }).ToList();
        }
        else
        {
            var omitted = texts.Count - MaxHistoryMessages;
            var kept = texts.Skip(omitted).ToList();
            messages = new List<LlmChatMessage>
            {
                new()
                {
                    Role = "user",
                    Content = $"（本会话更早的 {omitted} 条消息因上下文长度限制已被省略，请基于后续对话继续。已修改的文件可重新读取确认。）"
                }
            };
            messages.AddRange(kept.Select(m => new LlmChatMessage { Role = m.Role, Content = m.Content }));
        }

        // 摘要置于最前，替代被替换掉的历史
        if (!string.IsNullOrWhiteSpace(contextSummary))
        {
            messages.Insert(0, new LlmChatMessage
            {
                Role = "user",
                Content = $"（以下是此前会话的压缩摘要，原文已不再随上下文发送，可据此继续）\n{contextSummary}"
            });
        }

        // 会话级上下文上限：按 ~3 字符/token 折算字符预算，从最早的消息开始裁剪
        if (contextWindow is > 0)
        {
            var charBudget = (long)contextWindow.Value * 3;
            var total = messages.Sum(m => (long)(m.Content?.Length ?? 0));
            var start = 0;
            while (start < messages.Count - 1 && total > charBudget)
            {
                total -= messages[start].Content?.Length ?? 0;
                start++;
            }
            if (start > 0)
            {
                messages = messages.Skip(start).ToList();
                _logger.LogInformation(
                    "[Context] 上下文上限 {Window} tokens：裁剪会话历史，保留 {Kept}/{Total} 条（约 {Chars} 字符）",
                    contextWindow, messages.Count, messages.Count + start, total);
            }
        }

        return messages;
    }

    private sealed record PlannedChange(string ToolCallId, string Path);

    private static string ChangeKey(string toolCallId, string path) => toolCallId + "|" + path;

    /// <summary>解析本轮工具调用中会改动哪些文件；只读工具不入列</summary>
    private static List<PlannedChange> PlanFileMutations(List<LlmToolCall> toolCalls)
    {
        var planned = new List<PlannedChange>();
        foreach (var toolCall in toolCalls)
        {
            switch (toolCall.Name)
            {
                case "work_write_file":
                {
                    var path = TryGetStringArgument(toolCall.Arguments, "path");
                    if (!string.IsNullOrWhiteSpace(path))
                        planned.Add(new PlannedChange(toolCall.Id, path));
                    break;
                }
                case "work_apply_patch":
                case "work_delete_file":
                {
                    var path = TryGetStringArgument(toolCall.Arguments, "path");
                    if (!string.IsNullOrWhiteSpace(path))
                        planned.Add(new PlannedChange(toolCall.Id, path));
                    break;
                }
                case "work_move_file":
                {
                    var from = TryGetStringArgument(toolCall.Arguments, "from");
                    var to = TryGetStringArgument(toolCall.Arguments, "to");
                    if (!string.IsNullOrWhiteSpace(from))
                        planned.Add(new PlannedChange(toolCall.Id, from));
                    if (!string.IsNullOrWhiteSpace(to))
                        planned.Add(new PlannedChange(toolCall.Id, to));
                    break;
                }
            }
        }
        return planned;
    }

    /// <summary>改动执行前为受影响的文件打快照检查点</summary>
    private async Task CreateCheckpointAsync(
        Guid projectId,
        Guid sessionId,
        int iteration,
        List<PlannedChange> planned,
        CancellationToken ct,
        SseStreamWriter writer)
    {
        if (planned.Count == 0) return;

        try
        {
            var checkpoint = await _checkpointService.CaptureAsync(
                projectId,
                sessionId,
                $"第 {iteration + 1} 轮 · {planned.Select(p => p.Path).Distinct().Count()} 个文件",
                planned.Select(p => p.ToolCallId),
                planned.Select(p => p.Path).Distinct().ToList(),
                ct);

            if (checkpoint == null) return;

            await writer.WriteJsonAsync(new
            {
                type = "checkpoint",
                id = checkpoint.Id,
                label = checkpoint.Label,
                fileCount = checkpoint.FileCount
            });

            // 检查点事件落库：历史回放时可见，并支持从对话里直接回滚
            await _sessionService.AddMessageAsync(
                sessionId, "system", checkpoint.Label, "checkpoint",
                JsonSerializer.Serialize(new { id = checkpoint.Id, label = checkpoint.Label, fileCount = checkpoint.FileCount }),
                cancellationToken: CancellationToken.None);

            await _checkpointService.PruneAsync(sessionId, MaxCheckpointsPerSession, ct);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            Log.Warning(ex, "[WorkStream] 创建检查点失败 sessionId={SessionId}", sessionId);
        }
    }

    /// <summary>读取工具调用参数中的字符串字段，参数不是合法 JSON 或字段缺失时返回 null</summary>
    private static string? TryGetStringArgument(string arguments, string name)
    {
        try
        {
            using var doc = JsonDocument.Parse(arguments);
            return doc.RootElement.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>读取文件旧内容用于 diff，路径非法、文件不存在或不可读时返回 null（支持 SSH 远端）</summary>
    private static async Task<string?> TryReadFileAsync(IWorkCommandRunner runner, string rootPath, string relativePath, CancellationToken ct)
    {
        try
        {
            if (runner.IsRemote)
            {
                var result = await runner.RunAsync($"cat {WorkRemoteFs.Quote(rootPath, relativePath)}", ct);
                return result.ExitCode == 0 ? result.StdOut : null;
            }

            var path = WorkPath.Resolve(rootPath, relativePath);
            return path != null && System.IO.File.Exists(path)
                ? await System.IO.File.ReadAllTextAsync(path, ct)
                : null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            return null;
        }
    }
}
