using System.Text;
using Hetu.Api.Streaming;
using Hetu.Core.Entities;
using Hetu.Core.Interfaces;
using Hetu.Core.Profiles;
using Hetu.Core.Services;
using Hetu.Core.Services.Tools;
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
    private readonly ILLMProviderFactory _llmProviderFactory;
    private readonly ToolExecutionService _toolExecution;
    private readonly WorkToolContext _workToolContext;

    public WorkStreamController(
        IUnitOfWork unitOfWork,
        IWorkSessionService sessionService,
        ILLMProviderFactory llmProviderFactory,
        ToolExecutionService toolExecution,
        WorkToolContext workToolContext)
    {
        _unitOfWork = unitOfWork;
        _sessionService = sessionService;
        _llmProviderFactory = llmProviderFactory;
        _toolExecution = toolExecution;
        _workToolContext = workToolContext;
    }

    [HttpPost("{sessionId:guid}/stream")]
    public async Task Stream(Guid sessionId, [FromBody] SendWorkMessageRequest request, CancellationToken ct = default)
    {
        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Connection = "keep-alive";

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
        _workToolContext.ProjectRoot = project.RootPath;

        // 保存用户消息
        var userMsg = await _sessionService.AddMessageAsync(sessionId, "user", request.Content ?? "", cancellationToken: ct);
        if (!userMsg.Success)
        {
            await writer.WriteErrorAsync(userMsg.Error ?? "保存消息失败");
            return;
        }

        // 解析模型
        ILLMProvider? provider;
        Guid? modelId;
        if (!string.IsNullOrWhiteSpace(request.ModelId) && Guid.TryParse(request.ModelId, out var reqId))
        {
            modelId = reqId;
            provider = await _llmProviderFactory.CreateProviderAsync(reqId, ct);
        }
        else if (session.ModelId.HasValue)
        {
            modelId = session.ModelId.Value;
            provider = await _llmProviderFactory.CreateProviderAsync(modelId.Value, ct);
        }
        else
        {
            modelId = null;
            provider = await _llmProviderFactory.CreateChatProviderAsync(ct);
        }

        if (provider == null)
        {
            await writer.WriteErrorAsync("未找到可用的对话模型");
            return;
        }

        // 构建历史 + 工具
        var messagesResult = await _sessionService.GetMessagesAsync(sessionId, ct);
        var history = messagesResult.Data ?? [];
        var chatMessages = history
            .Where(m => m.Type == "text")
            .Select(m => new LlmChatMessage { Role = m.Role, Content = m.Content })
            .ToList();

        var profile = BuiltinProfiles.Work;
        var options = new ChatOptions
        {
            // ModelId 留空：provider 创建时已注入正确的模型名
            Stream = true,
            SystemPrompt = string.Join("\n\n", new[]
            {
                profile.IdentityPrompt,
                profile.PrinciplePrompt,
                profile.FormatPrompt,
                profile.SafetyPrompt,
                $"\n当前项目: {project.Name}\n项目根目录: {project.RootPath}",
                "工具使用约定：\n- work_list_dir / work_read_file：先浏览再读取\n- work_write_file：创建或覆盖文件，覆盖前确认\n- work_run_command：在项目根目录执行构建/测试/git 命令",
            }),
        };

        var overrides = new Dictionary<string, ToolApprovalMode>();
        if (request.EnableTools)
        {
            var definitions = ToolRegistryStatic.ToDefinitions(profile);
            options.Tools = definitions;
            options.ToolChoice = "auto";
            if (!string.IsNullOrWhiteSpace(request.ToolApprovalMode) &&
                Enum.TryParse<ToolApprovalMode>(request.ToolApprovalMode, true, out var mode))
            {
                overrides["*"] = mode;
            }
        }

        // Agent Loop
        var contentSb = new StringBuilder();
        var thinkingSb = new StringBuilder();
        var sessionTodos = new List<SessionTodo>();
        var fileChanges = new List<object>();
        const int maxIterations = 30;
        string? loopError = null;

        try
        {
            for (int iter = 0; iter < maxIterations; iter++)
            {
                var (iterContent, iterThinking, pendingToolCalls, _) = await ChatStreamProcessor.ProcessStreamAsync(
                    provider, chatMessages, options, writer, ct);

                contentSb.Append(iterContent);
                thinkingSb.Append(iterThinking);

                if (pendingToolCalls == null || pendingToolCalls.Count == 0 || !request.EnableTools)
                    break;

                chatMessages.Add(new LlmChatMessage { Role = "assistant", Content = iterContent.ToString(), ToolCalls = pendingToolCalls });

                // 记录 write 工具执行前的旧内容（用于 diff）
                var oldContents = new Dictionary<string, string?>();
                foreach (var tc in pendingToolCalls.Where(t => t.Name == "work_write_file"))
                {
                    try
                    {
                        using var doc = System.Text.Json.JsonDocument.Parse(tc.Arguments);
                        var path = doc.RootElement.TryGetProperty("path", out var p) ? p.GetString() : null;
                        if (!string.IsNullOrWhiteSpace(path))
                        {
                            var safePath = WorkPath.Resolve(project.RootPath, path);
                            oldContents[tc.Id] = safePath != null && System.IO.File.Exists(safePath)
                                ? await System.IO.File.ReadAllTextAsync(safePath, ct)
                                : null;
                        }
                    }
                    catch { }
                }

                var toolResults = await _toolExecution.ExecuteToolCallsAsync(
                    sessionId.ToString(),
                    pendingToolCalls, overrides, sessionTodos,
                    data => writer.WriteEventAsync(data),
                    payload => writer.WriteJsonAsync(payload),
                    ct);

                // 文件变更事件 + 落库记录（供 diff 页展示）
                foreach (var tc in pendingToolCalls.Where(t => t.Name == "work_write_file"))
                {
                    try
                    {
                        using var doc = System.Text.Json.JsonDocument.Parse(tc.Arguments);
                        var path = doc.RootElement.TryGetProperty("path", out var p) ? p.GetString() : null;
                        var newContent = doc.RootElement.TryGetProperty("content", out var c) ? c.GetString() ?? "" : "";
                        if (string.IsNullOrWhiteSpace(path)) continue;

                        var isNew = oldContents.GetValueOrDefault(tc.Id) == null;
                        var action = isNew ? "create" : "write";
                        await _unitOfWork.WorkFileChanges.AddAsync(new WorkFileChange
                        {
                            Id = Guid.NewGuid(),
                            ProjectId = project.Id,
                            SessionId = sessionId,
                            FilePath = path,
                            OldContent = oldContents.GetValueOrDefault(tc.Id),
                            NewContent = newContent,
                            Action = action,
                            CreatedAt = DateTimeOffset.UtcNow,
                            UpdatedAt = DateTimeOffset.UtcNow
                        }, ct);

                        var evt = new { type = "file_change", path, action };
                        fileChanges.Add(evt);
                        await writer.WriteJsonAsync(evt);
                    }
                    catch { }
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
        if (!string.IsNullOrEmpty(finalContent))
        {
            await _sessionService.AddMessageAsync(sessionId, "assistant", finalContent, "text", modelId: modelId, cancellationToken: CancellationToken.None);
        }

        // 保存文件变更事件消息（供历史回放展示）
        foreach (var change in fileChanges)
        {
            var json = System.Text.Json.JsonSerializer.Serialize(change);
            await _sessionService.AddMessageAsync(sessionId, "system", "", "file_change", json, cancellationToken: CancellationToken.None);
        }

        try { await _unitOfWork.SaveChangesAsync(ct); } catch { }

        await writer.WriteJsonAsync(new { type = "done" });
    }
}

/// <summary>静态工具定义辅助（Work 场景直接使用 Profile 允许的工具）</summary>
public static class ToolRegistryStatic
{
    public static List<LlmToolDefinition> ToDefinitions(RuntimeProfile profile)
    {
        var defs = new List<LlmToolDefinition>();
        foreach (var name in profile.AllowedTools)
        {
            var def = name switch
            {
                "work_list_dir" => Def("work_list_dir", "列出项目内目录/文件", Schema("{ \"type\": \"object\", \"properties\": { \"path\": { \"type\": \"string\", \"description\": \"相对项目根的目录路径，空串表示根目录\" } }, \"required\": [\"path\"] }")),
                "work_read_file" => Def("work_read_file", "读取项目内文件内容", Schema("{ \"type\": \"object\", \"properties\": { \"path\": { \"type\": \"string\", \"description\": \"相对项目根的文件路径\" }, \"startLine\": { \"type\": \"integer\" }, \"endLine\": { \"type\": \"integer\" } }, \"required\": [\"path\"] }")),
                "work_write_file" => Def("work_write_file", "创建或覆盖项目内文件，写入前需确认", Schema("{ \"type\": \"object\", \"properties\": { \"path\": { \"type\": \"string\", \"description\": \"相对项目根的文件路径\" }, \"content\": { \"type\": \"string\", \"description\": \"完整文件内容\" } }, \"required\": [\"path\", \"content\"] }")),
                "work_run_command" => Def("work_run_command", "在项目根目录执行构建/测试/git 等开发命令", Schema("{ \"type\": \"object\", \"properties\": { \"command\": { \"type\": \"string\", \"description\": \"要执行的命令\" } }, \"required\": [\"command\"] }")),
                "ask_question" => Def("ask_question", "向用户提问以获取澄清信息", Schema("{ \"type\": \"object\", \"properties\": { \"question\": { \"type\": \"string\" } }, \"required\": [\"question\"] }")),
                "todo" => Def("todo", "维护任务清单", Schema("{ \"type\": \"object\", \"properties\": { \"todos\": { \"type\": \"array\", \"items\": { \"type\": \"object\", \"properties\": { \"title\": { \"type\": \"string\" }, \"done\": { \"type\": \"boolean\" } }, \"required\": [\"title\"] } } }, \"required\": [\"todos\"] }")),
                _ => null,
            };
            if (def != null) defs.Add(def);
        }
        return defs;
    }

    private static LlmToolDefinition Def(string name, string description, System.Text.Json.JsonElement schema) => new()
    {
        Name = name,
        Description = description,
        ParametersSchema = schema
    };

    private static System.Text.Json.JsonElement Schema(string json) => System.Text.Json.JsonDocument.Parse(json).RootElement;
}
