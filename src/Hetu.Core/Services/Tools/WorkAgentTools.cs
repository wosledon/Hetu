using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Hetu.Core.Interfaces;
using Hetu.Core.Utilities;
using Microsoft.Extensions.DependencyInjection;

namespace Hetu.Core.Services.Tools;

/// <summary>
/// 子 Agent 工具：把一个只读调研任务交给独立的嵌套 Agent 循环执行，
/// 只允许读取/搜索类工具，返回结论摘要，避免主循环上下文被大量文件内容污染。
/// </summary>
public class WorkTaskTool : IToolExecutor
{
    /// <summary>子 Agent 允许使用的只读工具</summary>
    public static readonly string[] AllowedSubTools =
    [
        "work_list_dir", "work_read_file", "work_glob", "work_grep", "work_semantic_search"
    ];

    private const int MaxIterations = 12;
    private const int MaxResultChars = 8000;

    private readonly WorkToolContext _context;
    private readonly ILLMProviderFactory _llmProviderFactory;
    private readonly IServiceProvider _services;
    private ToolRegistry? _toolRegistry;

    public WorkTaskTool(WorkToolContext context, ILLMProviderFactory llmProviderFactory, IServiceProvider services)
    {
        _context = context;
        _llmProviderFactory = llmProviderFactory;
        _services = services;
    }

    // 延迟解析，避免 ToolRegistry -> IToolExecutor -> 本工具 -> ToolRegistry 的循环依赖
    private ToolRegistry Registry => _toolRegistry ??= _services.GetRequiredService<ToolRegistry>();

    public string Name => "work_task";
    public string Description => "派出一个只读的子 Agent 在项目内独立调研（可读文件、搜索代码），返回结论摘要。适合需要翻阅大量文件但主流程只需结论的场景";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Auto;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "一个子 Agent 只做一件事；prompt 里写清目标、关注的文件范围与期望输出格式。子 Agent 无法修改文件，需要改动请由你自己执行。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "description": { "type": "string", "description": "子任务的一句话描述，用于界面展示" },
            "prompt": { "type": "string", "description": "交给子 Agent 的完整指令，包含目标、范围与期望输出" },
            "tools": {
                "type": "array",
                "items": { "type": "string" },
                "description": "可选，进一步收窄子 Agent 可用工具（默认使用全部只读工具）"
            }
        },
        "required": ["description", "prompt"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        string description;
        string prompt;
        List<string> requested;
        try
        {
            var args = JsonSerializer.Deserialize<JsonElement>(argumentsJson);
            description = args.TryGetProperty("description", out var d) ? d.GetString() ?? "" : "";
            prompt = args.TryGetProperty("prompt", out var p) ? p.GetString() ?? "" : "";
            requested = args.TryGetProperty("tools", out var t) && t.ValueKind == JsonValueKind.Array
                ? t.EnumerateArray().Select(x => x.GetString() ?? "").Where(x => x.Length > 0).ToList()
                : [];
        }
        catch (JsonException ex)
        {
            return ToolExecutionResult.Error($"参数解析失败：{ex.Message}");
        }

        var root = _context.ProjectRoot;
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
            return ToolExecutionResult.Error("项目根目录不存在");

        if (string.IsNullOrWhiteSpace(prompt))
            return ToolExecutionResult.Error("prompt 不能为空");

        var toolNames = (requested.Count > 0 ? requested : AllowedSubTools.ToList())
            .Where(n => AllowedSubTools.Contains(n, StringComparer.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var subAgentId = Guid.NewGuid().ToString("N");
        if (string.IsNullOrWhiteSpace(description)) description = "子任务";
        await EmitAsync(new { type = "subagent", stage = "start", id = subAgentId, description });

        try
        {
            var provider = _context.ModelId.HasValue
                ? await _llmProviderFactory.CreateProviderAsync(_context.ModelId.Value, cancellationToken)
                : await _llmProviderFactory.CreateChatProviderAsync(cancellationToken);
            if (provider == null)
                return ToolExecutionResult.Error("子 Agent 启动失败：未配置可用的对话模型");

            var options = new ChatOptions
            {
                ModelId = "",
                Stream = true,
                SystemPrompt = $"""
                你是 Hetu 工作区内的子 Agent，负责只读调研，禁止做任何修改。
                项目根目录：{root}
                你可以读取文件、按通配符查找文件、按正则搜索内容。请在有限步数内完成调研，
                然后用简洁的 Markdown 汇报：结论、关键证据（文件:行）、以及尚未确认的疑点。
                不要复述大段源码，只引用必要的片段。
                """,
                Tools = Registry.ToToolDefinitions(toolNames),
                ToolChoice = toolNames.Count > 0 ? "auto" : "none"
            };

            var messages = new List<LlmChatMessage> { new() { Role = "user", Content = prompt } };
            var answer = new StringBuilder();
            var steps = 0;

            for (var iter = 0; iter < MaxIterations; iter++)
            {
                var (content, toolCalls) = await ConsumeStreamAsync(provider, messages, options, cancellationToken);
                answer.Append(content);

                if (toolCalls == null || toolCalls.Count == 0)
                    break;

                messages.Add(new LlmChatMessage { Role = "assistant", Content = content, ToolCalls = toolCalls });

                foreach (var call in toolCalls)
                {
                    steps++;
                    await EmitAsync(new { type = "subagent", stage = "tool", id = subAgentId, description, tool = call.Name });

                    var executor = Registry.GetExecutor(call.Name);
                    ToolExecutionResult result;
                    if (executor == null || !toolNames.Contains(executor.Name, StringComparer.OrdinalIgnoreCase))
                    {
                        result = ToolExecutionResult.Error($"子 Agent 不允许调用工具 {call.Name}");
                    }
                    else
                    {
                        try
                        {
                            result = await executor.ExecuteAsync(call.Arguments, cancellationToken);
                        }
                        catch (OperationCanceledException) { throw; }
                        catch (Exception ex)
                        {
                            result = ToolExecutionResult.Error($"工具执行失败：{ex.Message}");
                        }
                    }

                    var payload = result.IsError ? $"Error: {result.Content}" : Truncate(result.Content, 6000);
                    messages.Add(new LlmChatMessage { Role = "tool", ToolCallId = call.Id, Content = payload });
                }
            }

            await EmitAsync(new { type = "subagent", stage = "done", id = subAgentId, description, steps });

            var summary = answer.ToString().Trim();
            if (string.IsNullOrWhiteSpace(summary))
                summary = "（子 Agent 未产出结论）";

            return ToolExecutionResult.Success(
                $"【子 Agent：{description}】调研 {steps} 步\n\n{Truncate(summary, MaxResultChars)}");
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            await EmitAsync(new { type = "subagent", stage = "error", id = subAgentId, description, message = ex.Message });
            return ToolExecutionResult.Error($"子 Agent 执行失败：{ex.Message}");
        }
    }

    private Task EmitAsync(object payload)
        => _context.WriteEventAsync?.Invoke(payload) ?? Task.CompletedTask;

    private static string Truncate(string text, int max)
        => text.Length <= max ? text : text[..max] + $"\n…（已截断，共 {text.Length} 字符）";

    /// <summary>消费 LLM 流：非 JSON 增量按正文累积，结构化 tool_calls 单独取出</summary>
    private static async Task<(string content, List<LlmToolCall>? toolCalls)> ConsumeStreamAsync(
        ILLMProvider provider,
        List<LlmChatMessage> messages,
        ChatOptions options,
        CancellationToken ct)
    {
        var sb = new StringBuilder();
        List<LlmToolCall>? toolCalls = null;

        await foreach (var delta in provider.ChatStreamAsync(messages, options, ct))
        {
            try
            {
                using var doc = JsonDocument.Parse(delta);
                var root = doc.RootElement;
                if (root.ValueKind == JsonValueKind.Object
                    && root.TryGetProperty("type", out var typeEl)
                    && typeEl.ValueKind == JsonValueKind.String)
                {
                    if (typeEl.GetString() == "tool_calls")
                    {
                        if (root.TryGetProperty("toolCalls", out var arr))
                            toolCalls = JsonSerializer.Deserialize<List<LlmToolCall>>(arr.GetRawText(), JsonDefaults.CamelCase);
                    }
                    continue;
                }
            }
            catch (JsonException) { /* 非 JSON 增量，按正文处理 */ }

            sb.Append(delta);
        }

        return (sb.ToString(), toolCalls);
    }
}

/// <summary>诊断工具：运行项目自带的构建/静态检查命令，把编译错误直接反馈给模型</summary>
public class WorkDiagnosticsTool : IToolExecutor
{
    private const int TimeoutSeconds = 300;
    private const int MaxOutputChars = 12000;

    private readonly WorkToolContext _context;
    private readonly IServiceProvider _services;
    private ToolRegistry? _toolRegistry;

    public WorkDiagnosticsTool(WorkToolContext context, IServiceProvider services)
    {
        _context = context;
        _services = services;
    }

    // 延迟解析，避免 ToolRegistry -> IToolExecutor -> 本工具 -> ToolRegistry 的循环依赖
    private ToolRegistry Registry => _toolRegistry ??= _services.GetRequiredService<ToolRegistry>();

    public string Name => "work_diagnostics";
    public string Description => "在项目内运行构建/静态检查命令（如 dotnet build、tsc、npm run build），返回编译错误与警告，用于改完代码后自检";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Ask;
    public ToolRisk Risk => ToolRisk.Execute;
    public string? UsageGuideline => "改动代码后优先调用本工具验证，而不是靠猜测。命令留空时按项目类型自动探测；首次探测结果会在返回内容中提示可固化到项目设置。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "command": { "type": "string", "description": "可选，自定义诊断命令；留空则按项目类型自动探测" }
        }
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        var root = _context.ProjectRoot;
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
            return ToolExecutionResult.Error("项目根目录不存在");

        string? customCommand = null;
        try
        {
            var args = JsonSerializer.Deserialize<JsonElement>(argumentsJson);
            if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("command", out var c) && c.ValueKind == JsonValueKind.String)
                customCommand = c.GetString();
        }
        catch (JsonException) { /* 参数是空串或非对象时忽略 */ }

        var command = !string.IsNullOrWhiteSpace(customCommand)
            ? customCommand!
            : !string.IsNullOrWhiteSpace(_context.DiagnosticsCommand)
                ? _context.DiagnosticsCommand!
                : DetectCommand(root);

        if (string.IsNullOrWhiteSpace(command))
        {
            return ToolExecutionResult.Success(
                "未识别项目类型，已跳过诊断。可在项目设置中填写「诊断命令」，或直接调用 work_run_command 指定命令。");
        }

        var commandName = Registry.GetExecutor("work_run_command");
        if (commandName is WorkRunCommandTool runner)
        {
            var payload = JsonSerializer.Serialize(new { command, timeoutSeconds = TimeoutSeconds });
            var result = await runner.ExecuteAsync(payload, cancellationToken);
            var content = result.Content.Length > MaxOutputChars
                ? result.Content[..MaxOutputChars] + $"\n…（输出已截断，共 {result.Content.Length} 字符）"
                : result.Content;
            return result.IsError
                ? ToolExecutionResult.Error($"诊断命令执行失败：{content}")
                : ToolExecutionResult.Success($"诊断命令：`{command}`\n\n{content}");
        }

        // 回退：直接同步执行
        try
        {
            var (exitCode, output) = await RunAsync(command, root, cancellationToken);
            var text = output.Length > MaxOutputChars ? output[..MaxOutputChars] + "\n…（输出已截断）" : output;
            return exitCode == 0
                ? ToolExecutionResult.Success($"诊断命令：`{command}`\n退出码 0，未发现问题。\n{text}")
                : ToolExecutionResult.Error($"诊断命令：`{command}`\n退出码 {exitCode}\n{text}");
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"诊断执行失败：{ex.Message}");
        }
    }

    /// <summary>按项目特征文件猜测诊断命令，返回 null 表示无法识别</summary>
    public static string? DetectCommand(string root)
    {
        if (Directory.EnumerateFiles(root, "*.slnx").Any() || Directory.EnumerateFiles(root, "*.sln").Any())
            return "dotnet build -v q --nologo";
        if (File.Exists(Path.Combine(root, "Cargo.toml")))
            return "cargo check --message-format short";
        if (File.Exists(Path.Combine(root, "go.mod")))
            return "go build ./...";
        if (File.Exists(Path.Combine(root, "tsconfig.json")))
            return "npx tsc --noEmit";
        if (File.Exists(Path.Combine(root, "package.json")))
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "package.json")));
                if (doc.RootElement.TryGetProperty("scripts", out var scripts)
                    && scripts.TryGetProperty("build", out _))
                {
                    return "npm run build";
                }
            }
            catch (JsonException) { /* package.json 非法时退回 lint 探测 */ }
            if (Directory.EnumerateFiles(root, "*.csproj").Any())
                return "dotnet build -v q --nologo";
            return "npm run lint --if-present";
        }
        if (File.Exists(Path.Combine(root, "pyproject.toml")))
            return "python -m compileall -q .";
        if (Directory.EnumerateFiles(root, "*.csproj").Any())
            return "dotnet build -v q --nologo";
        return null;
    }

    private static async Task<(int ExitCode, string Output)> RunAsync(string command, string root, CancellationToken ct)
    {
        var psi = new ProcessStartInfo
        {
            FileName = OperatingSystem.IsWindows() ? "cmd.exe" : "/bin/sh",
            Arguments = OperatingSystem.IsWindows() ? $"/c {command}" : $"-c \"{command}\"",
            WorkingDirectory = root,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };

        using var process = Process.Start(psi) ?? throw new InvalidOperationException("无法启动进程");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(TimeoutSeconds));

        var stdout = process.StandardOutput.ReadToEndAsync(timeout.Token);
        var stderr = process.StandardError.ReadToEndAsync(timeout.Token);

        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            try { process.Kill(entireProcessTree: true); } catch { /* 进程已退出 */ }
            return (-1, $"诊断命令超过 {TimeoutSeconds} 秒未完成，已终止。");
        }

        var output = string.Join('\n', new[] { await stdout, await stderr }.Where(s => !string.IsNullOrWhiteSpace(s)));
        return (process.ExitCode, output.Trim());
    }
}

/// <summary>项目代码语义检索：基于本地向量索引按语义查找相关代码片段</summary>
public class WorkSemanticSearchTool : IToolExecutor
{
    private readonly WorkToolContext _context;
    private readonly IWorkCodeIndexService _codeIndex;

    public WorkSemanticSearchTool(WorkToolContext context, IWorkCodeIndexService codeIndex)
    {
        _context = context;
        _codeIndex = codeIndex;
    }

    public string Name => "work_semantic_search";
    public string Description => "用自然语言描述要查找的逻辑，按语义检索项目代码片段（需要项目已建立代码索引）";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "只知道「想找什么逻辑」但不知道关键字时用它；知道确切符号名时优先用 work_grep，更快更准。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "query": { "type": "string", "description": "自然语言描述，如「会话权限模式如何决定工具是否可以执行」" },
            "limit": { "type": "integer", "description": "返回条数，默认 8，最大 30" }
        },
        "required": ["query"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        string query;
        var limit = 8;
        try
        {
            var args = JsonSerializer.Deserialize<JsonElement>(argumentsJson);
            query = args.TryGetProperty("query", out var q) ? q.GetString() ?? "" : "";
            if (args.TryGetProperty("limit", out var l) && l.ValueKind == JsonValueKind.Number)
                limit = l.GetInt32();
        }
        catch (JsonException ex)
        {
            return ToolExecutionResult.Error($"参数解析失败：{ex.Message}");
        }

        if (!_context.ProjectId.HasValue)
            return ToolExecutionResult.Error("未绑定工作项目，无法进行语义检索");

        var result = await _codeIndex.SearchAsync(_context.ProjectId.Value, query, limit, cancellationToken);
        if (!result.Success || result.Data == null)
            return ToolExecutionResult.Error(result.Error ?? "语义检索失败");

        if (result.Data.Count == 0)
            return ToolExecutionResult.Success("未命中任何代码片段。可能项目尚未建立代码索引，或索引为空。");

        var sb = new StringBuilder();
        foreach (var hit in result.Data)
        {
            sb.AppendLine($"--- {hit.Path}:{hit.StartLine} (相似度 {hit.Score:0.###})");
            sb.AppendLine(hit.Snippet);
            sb.AppendLine();
        }
        return ToolExecutionResult.Success(sb.ToString().TrimEnd());
    }
}

/// <summary>调用已启用的本地技能（读取 SKILL.md 正文并返回）</summary>
public class WorkUseSkillTool : IToolExecutor
{
    private const int MaxBodyChars = 8000;

    private readonly WorkToolContext _context;
    private readonly ILocalSkillService _localSkillService;

    public WorkUseSkillTool(WorkToolContext context, ILocalSkillService localSkillService)
    {
        _context = context;
        _localSkillService = localSkillService;
    }

    public string Name => "work_skill";
    public string Description => "按名称加载某个已启用技能的完整说明（SKILL.md 正文），然后按说明完成后续步骤";
    public ToolApprovalMode DefaultApproval => ToolApprovalMode.Bypass;
    public ToolRisk Risk => ToolRisk.Read;
    public string? UsageGuideline => "system prompt 里列出的技能只给了名称和一句话描述；当某个技能明显匹配当前任务时，先调用本工具读取完整说明再动手。";

    private static readonly JsonElement _schema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "name": { "type": "string", "description": "技能名称或 Id（见 system prompt 中的技能列表）" }
        },
        "required": ["name"]
    }
    """).RootElement;
    public JsonElement ParametersSchema => _schema;

    public async Task<ToolExecutionResult> ExecuteAsync(string argumentsJson, CancellationToken cancellationToken = default)
    {
        string name;
        try
        {
            var args = JsonSerializer.Deserialize<JsonElement>(argumentsJson);
            name = args.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
        }
        catch (JsonException ex)
        {
            return ToolExecutionResult.Error($"参数解析失败：{ex.Message}");
        }

        if (string.IsNullOrWhiteSpace(name))
            return ToolExecutionResult.Error("name 不能为空");

        var scanner = await _localSkillService.ScanAllAsync(cancellationToken);
        var skills = scanner.Data ?? [];
        var skill = skills.FirstOrDefault(s =>
            string.Equals(s.Id, name, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase));

        if (skill == null)
        {
            var available = string.Join("、", skills.Where(s => s.IsEnabled).Select(s => s.Name).Take(20));
            return ToolExecutionResult.Error($"未找到技能「{name}」。已启用技能：{(available.Length > 0 ? available : "（无）")}");
        }

        if (!skill.IsEnabled)
            return ToolExecutionResult.Error($"技能「{skill.Name}」当前已禁用，请先在设置中启用。");

        string body;
        try
        {
            body = File.Exists(skill.FilePath)
                ? await File.ReadAllTextAsync(skill.FilePath, cancellationToken)
                : "（技能文件不存在或已被删除）";
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Error($"读取技能文件失败：{ex.Message}");
        }

        if (body.Length > MaxBodyChars)
            body = body[..MaxBodyChars] + $"\n…（正文已截断，共 {body.Length} 字符，完整文件：{skill.FilePath}）";

        if (!string.IsNullOrWhiteSpace(_context.ProjectRoot))
            body = body.Replace("{{projectRoot}}", _context.ProjectRoot);

        return ToolExecutionResult.Success($"技能 {skill.Name}（{skill.Category}）说明：\n\n{body}");
    }
}
