using System.Text;
using System.Text.Json;
using Hetu.Api.Streaming;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Profiles;
using Hetu.Core.Services;
using Hetu.Core.Services.Tools;
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

    public WorkStreamController(
        IUnitOfWork unitOfWork,
        IWorkSessionService sessionService,
        IWorkCheckpointService checkpointService,
        ILLMProviderFactory llmProviderFactory,
        ToolExecutionService toolExecution,
        ToolRegistry toolRegistry,
        AgentLoopService agentLoop,
        ILocalSkillService localSkillService,
        IWorkCodeIndexRefreshQueue codeIndexRefreshQueue)
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

        // 权限模式：请求 > 会话持久值；请求里带了就顺带持久化
        var permissionMode = ResolvePermissionMode(request, session);
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

        // 保存用户消息
        var userMsg = await _sessionService.AddMessageAsync(sessionId, "user", request.Content ?? "", cancellationToken: ct);
        if (!userMsg.Success)
        {
            await writer.WriteErrorAsync(userMsg.Error ?? "保存消息失败");
            return;
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
        var chatMessages = BuildChatHistory(history);

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

        var gitContext = await WorkProjectRules.BuildGitContextAsync(project.RootPath, ct);
        if (!string.IsNullOrWhiteSpace(gitContext))
            systemPromptParts.Add($"\n版本控制状态：\n{gitContext}");

        var options = new ChatOptions
        {
            // ModelId 留空：provider 创建时已注入正确的模型名
            Stream = true,
            SystemPrompt = string.Join("\n\n", systemPromptParts),
        };

        var overrides = new Dictionary<string, ToolApprovalMode>();
        if (request.EnableTools)
        {
            options.Tools = _toolRegistry.ToToolDefinitions(allowedTools);
            options.ToolChoice = "auto";
        }

        // Agent Loop
        var contentSb = new StringBuilder();
        var thinkingSb = new StringBuilder();
        var sessionTodos = new List<SessionTodo>();
        var fileChanges = new List<object>();
        var maxIterations = profile.MaxAgentIterations > 0 ? profile.MaxAgentIterations : 30;
        var usageTotal = new WorkMessageUsage();
        var executedToolNames = new List<string>();
        string? loopError = null;

        try
        {
            for (int iter = 0; iter < maxIterations; iter++)
            {
                var iterStart = DateTimeOffset.UtcNow;
                var (iterContent, iterThinking, pendingToolCalls, usage) = await ChatStreamProcessor.ProcessStreamAsync(
                    provider, chatMessages, options, writer, ct);

                contentSb.Append(iterContent);
                thinkingSb.Append(iterThinking);
                AccumulateUsage(usageTotal, usage, (int)(DateTimeOffset.UtcNow - iterStart).TotalMilliseconds);
                if (usage != null)
                {
                    await writer.WriteJsonAsync(new
                    {
                        type = "usage",
                        promptTokens = usageTotal.PromptTokens,
                        completionTokens = usageTotal.CompletionTokens,
                        cachedTokens = usageTotal.CachedTokens,
                        totalTokens = usageTotal.TotalTokens,
                        latencyMs = usageTotal.LatencyMs
                    });
                }

                if (pendingToolCalls == null || pendingToolCalls.Count == 0 || !request.EnableTools)
                    break;

                chatMessages.Add(new LlmChatMessage { Role = "assistant", Content = iterContent.ToString(), ToolCalls = pendingToolCalls });

                // 预解析本轮会改动哪些文件（供检查点 + 变更记录）
                var planned = PlanFileMutations(pendingToolCalls);

                var oldContents = new Dictionary<string, string?>(StringComparer.Ordinal);
                foreach (var change in planned)
                    oldContents[ChangeKey(change.ToolCallId, change.Path)] =
                        await TryReadFileAsync(project.RootPath, change.Path, ct);

                // 改动执行前打检查点，支持整轮回滚
                await CreateCheckpointAsync(project.Id, sessionId, iter, planned, ct, writer);

                var toolResults = await _toolExecution.ExecuteToolCallsAsync(
                    sessionId.ToString(),
                    pendingToolCalls, overrides, sessionTodos,
                    data => writer.WriteEventAsync(data),
                    payload => writer.WriteJsonAsync(payload),
                    ct,
                    (toolCall, defaultMode) =>
                    {
                        var targetPath = WorkToolPolicy.ExtractTargetPath(toolCall.Name, toolCall.Arguments);
                        return WorkToolPolicy.Decide(
                            _toolRegistry.GetExecutor(toolCall.Name), toolCall.Name, targetPath, permissionMode, approvalRules);
                    },
                    new WorkToolScope
                    {
                        ProjectRoot = project.RootPath,
                        ProjectId = project.Id,
                        ModelId = modelId,
                        DiagnosticsCommand = project.DiagnosticsCommand,
                        RuntimeTools = runtimeTools
                    });

                executedToolNames.AddRange(pendingToolCalls.Select(c => c.Name));

                // 文件变更事件 + 落库记录（供 diff 页展示）：以执行后的真实磁盘内容为准，失败的写操作不记变更
                foreach (var change in planned)
                {
                    try
                    {
                        var toolCallKey = ChangeKey(change.ToolCallId, change.Path);
                        var oldContent = oldContents.GetValueOrDefault(toolCallKey);
                        var newContent = await TryReadFileAsync(project.RootPath, change.Path, ct);
                        if (newContent == oldContent) continue;

                        var action = newContent == null ? "delete" : oldContent == null ? "create" : "write";
                        await _unitOfWork.WorkFileChanges.AddAsync(new WorkFileChange
                        {
                            Id = Guid.NewGuid(),
                            ProjectId = project.Id,
                            SessionId = sessionId,
                            FilePath = change.Path,
                            OldContent = oldContent,
                            NewContent = newContent ?? "",
                            Action = action,
                            CreatedAt = DateTimeOffset.UtcNow,
                            UpdatedAt = DateTimeOffset.UtcNow
                        }, ct);

                        var evt = new { type = "file_change", path = change.Path, action };
                        fileChanges.Add(evt);
                        await writer.WriteJsonAsync(evt);
                    }
                    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException)
                    {
                        Log.Warning(ex, "[WorkStream] 记录文件变更失败 path={Path}", change.Path);
                    }
                }

                foreach (var (toolCallId, content) in toolResults)
                {
                    chatMessages.Add(new LlmChatMessage { Role = "tool", ToolCallId = toolCallId, Content = content });
                }
            }
        }
        catch (OperationCanceledException)
        {
            Log.Information("[WorkStream] 用户中断 sessionId={SessionId}", sessionId);
        }
        catch (Exception ex)
        {
            loopError = ex.Message;
            Log.Error(ex, "[WorkStream] Agent循环异常 sessionId={SessionId}", sessionId);
            try { await writer.WriteErrorAsync($"处理请求时出错: {ex.Message}"); } catch { }
        }

        var finalContent = contentSb.ToString().Trim();
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

    /// <summary>累加一轮 LLM 调用的 Token 消耗</summary>
    private static void AccumulateUsage(WorkMessageUsage total, LlmUsage? usage, int latencyMs)
    {
        if (usage == null) return;
        total.PromptTokens += usage.PromptTokens;
        total.CompletionTokens += usage.CompletionTokens;
        total.CachedTokens += usage.CachedTokens;
        total.TotalTokens += usage.TotalTokens > 0 ? usage.TotalTokens : usage.PromptTokens + usage.CompletionTokens;
        total.LatencyMs += latencyMs;
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
    /// 避免长会话把上下文窗口顶满。
    /// </summary>
    private static List<LlmChatMessage> BuildChatHistory(List<WorkMessageDto> history)
    {
        var texts = history.Where(m => m.Type == "text").ToList();
        if (texts.Count <= MaxHistoryMessages)
            return texts.Select(m => new LlmChatMessage { Role = m.Role, Content = m.Content }).ToList();

        var omitted = texts.Count - MaxHistoryMessages;
        var kept = texts.Skip(omitted).ToList();
        var messages = new List<LlmChatMessage>
        {
            new()
            {
                Role = "user",
                Content = $"（本会话更早的 {omitted} 条消息因上下文长度限制已被省略，请基于后续对话继续。已修改的文件可重新读取确认。）"
            }
        };
        messages.AddRange(kept.Select(m => new LlmChatMessage { Role = m.Role, Content = m.Content }));
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

    /// <summary>读取文件旧内容用于 diff，路径非法、文件不存在或不可读时返回 null</summary>
    private static async Task<string?> TryReadFileAsync(string rootPath, string relativePath, CancellationToken ct)
    {
        try
        {
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
