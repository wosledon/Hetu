# Hetu — 实现约定

> 本文件是给人和 AI 协作者的实现约定。动手前先读一遍；改完按「验证清单」跑一遍。

## 项目概述

Hetu（河图）是**本地优先**的 AI 知识与 Agent 工作台，由两个引擎和一层底座组成：

- **笔记**（`/`）：Markdown 编辑、笔记本、标签、历史版本、分享、回收站、导出备份。
- **Agent 工作台**（`/code`）：对话与 Code 会话（项目 / 工作树 / 分支 / 文件 / 终端 / Git / PR）。
- **底座**：知识库（分块 + 向量）、知识图谱、Wiki 生成、记忆与 Dream、任务看板 / 工作流 / 后台任务、
  智能体 / 技能 / 工具 / MCP、模型与供应商 / 代理 / 用量统计。
- **桌面**：`shell/hetu-desktop`（Tauri 2）拉起后端 sidecar，提供托盘、自动更新与安装包。
- **Agent 运行时**：`src/Hetu.Agents`（Microsoft Agent Framework 1.28 + 官方 OpenAI/Anthropic Provider）。

无账号、无云依赖；所有数据与模型调用都在本机（SQLite + `sqlite-vec`，可切 PostgreSQL + `pgvector`）。

## 技术栈

| 层            | 技术                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------ |
| 后端          | ASP.NET Core 10（`net10.0`）· EF Core 10 · Serilog · Scalar（`/scalar/v1`）                |
| 存储          | SQLite（默认，`sqlite-vec` 扩展）/ PostgreSQL 16+（`pgvector`）                            |
| 前端          | React 19 · TypeScript 6（strict）· Vite 8 · Tailwind CSS 4 · react-router 7                |
| 状态          | Zustand（客户端）+ TanStack Query v5（服务端）                                             |
| 编辑器/可视化 | Milkdown · CodeMirror · xterm.js · react-markdown(+KaTeX/Mermaid) · ECharts · XYFlow+dagre |
| 桌面          | Tauri 2（Rust 外壳 + sidecar + updater + NSIS 安装器）                                     |
| 国际化        | i18next（`zh` / `en` 两份文案必须同步）                                                    |

## 目录结构

```
src/
├── Hetu.Api/                                  # 控制器、SSE 流、后台 Worker、Program.cs
├── Hetu.Agents/                               # MAF 运行时：AIAgent 工厂、工具 AIFunction、会话与审批
├── Hetu.Core/                                 # 实体（Entities）、服务（Services）、仓储接口（Interfaces）
├── Hetu.Infrastructure/                       # EF Core、仓储实现、AI Provider、MCP、sqlite-vec
├── Hetu.Infrastructure.PostgresMigrations/    # PostgreSQL 迁移与模型快照
└── Hetu.Shared/                               # DTO / 枚举 / 常量（前后端契约）
frontend/src/{pages,components,hooks,stores,services,types,utils,i18n}
shell/hetu-desktop/{src,src-tauri}             # Rust 外壳 + Tauri 配置 + 安装器钩子
scripts/                                       # start / desktop-dev / publish-backend / tag-release / test-api
docs/                                          # PRD 与 screenshots（README 用图）
```

## 质量红线

1. **0 告警**：`dotnet build` 与 `npx eslint .` 都必须干净。
2. **禁止抑制**：不允许 `#pragma warning disable`、`SuppressMessage`、`eslint-disable`、`// @ts-ignore`。
   告警只能修根因（可空性就加判空、平台 API 就加 `OperatingSystem.IsXxx` 守卫、
   依赖漏洞就升级包）。
3. **不留临时物**：测试用的临时目录、进程、数据库改动用完即清。

### 验证清单（改完必跑）

```bash
dotnet build src/Hetu.Api/Hetu.Api.csproj -c Release -v q   # 期望 0 告警 0 错误
cd frontend && npx eslint . && npx tsc -b                    # 期望 0 problem / 通过
node scripts/audit-ui.mjs                                    # 组件边界：原生控件/第三方 import 只降不升
# 后端手动起一遍并冒烟（vite 5174 / api 5000）：
dotnet run --project src/Hetu.Api --urls "http://localhost:5000"
curl.exe -s "http://localhost:5000/api/notes?page=1&pageSize=2"
./scripts/test-api.sh                                        # 后端已启动时
```

涉及 UI 的改动：用浏览器实测目标流程，并确认控制台没有 error / warning。

## 后端约定

### 分层与依赖方向

`Api → Core ← Infrastructure`：**Core 不引用 EF Core / ASP.NET 具体实现**，只定义实体、服务与接口；
数据访问通过 `IUnitOfWork` 暴露的仓储接口进行。新增外部集成（AI、MCP、进程、文件系统）放 `Hetu.Infrastructure`。

### 命名

- 类 / 方法 / 常量：`PascalCase`；私有字段 `_camelCase`；接口 `I` 前缀。
- 服务命名：`XxxService` + `IXxxService`；控制器 `XxxController`（路由 `api/xxx`）。
- 测试命名（新增测试时）：`方法名_场景_预期结果`。

### API 设计

- 统一响应：`ApiResponse<T>`（`{ success, data?, error? }`）；列表统一 `PagedResult<T>`（`page` 从 1 开始，`pageSize` 默认 20）。
- 错误用 HTTP 状态码 + 统一结构，**不泄漏堆栈**；业务错误抛 `BusinessException` 由中间件兜底。
- **所有列表接口必须分页**，分页与排序在数据库完成（不要 `ToList()` 后再 `Skip/Take`）。
- 被页面高频轮询的只读接口加 `[ResponseCache(Duration = N)]`（如知识库状态 / 索引列表）。

### 本地化

- 文案必须走 `ILocalizer.T("key", args)`；文案文件在 `src/Hetu.Infrastructure/Localization/Locales/{zh,en}`。
- **新增 key 必须同时补 zh 与 en**，前端同理（`frontend/src/i18n/locales/{zh,en}/*.ts`）。

### 数据库与 EF Core

- 实体继承 `BaseEntity`（`Id` / `CreatedAt` / `UpdatedAt`，时间统一 `DateTimeOffset` **UTC**）。
- 软删除用 `IsDeleted`（+ `DeletedAt`），查询默认带全局过滤器；需要包含已删时用 `IgnoreQueryFilters()`。
- 只读查询用 `AsNoTracking()`；只取需要的列时用投影（`Select`）。
- Code First + 迁移；改模型后 `dotnet ef migrations add <Name> --project src/Hetu.Infrastructure --startup-project src/Hetu.Api`。

### ⚠️ SQLite 的 DateTimeOffset 限制（踩过坑）

EF Core 的 SQLite provider **不支持在 SQL 中排序或聚合 `DateTimeOffset`**（`ORDER BY` / `MAX` 会抛
`NotSupportedException` 或无法翻译）。因此：

- 分页排序用 `IRepository.GetPagedByDateAsync(...)`（内部：SQLite 下先投影 `Id + 排序键` 内存定序再按主键回表；
  其它 provider 直接 `ORDER BY` + `OFFSET/FETCH`）。
- 分组计数用 `IRepository.CountByAsync(...)`；清理旧数据用 `IRepository.PruneAsync(...)`。
- 需要「最近更新时间」这类聚合时：计数/维度等标量放 SQL，时间戳只投影两列后内存取最大值。
- **不要**写 `OrderBy(x => x.CreatedAt)` 直接作用在 `IQueryable` 上（SQLite 会运行时炸）；先在内存再排序是可以的。
- 同理，`DateTimeOffset` 的**比较**（`x.CreatedAt > since`）在 SQLite 里也不能翻译，改为投影后在内存判断。

### 仓储与 UnitOfWork

- 通用方法（`IRepository<T>` / `EfRepository<T>`）：`GetByIdAsync`、`GetAllAsync`、`FindAsync`、`CountAsync`、
  `SelectAsync`、`CountByAsync`、`GetPagedByDateAsync`、`PruneAsync`、`AddAsync`、`UpdateAsync`、`DeleteAsync`。
- 领域专用仓储（如 `INoteRepository`、`IKnowledgeItemRepository`）放 `Hetu.Core/Interfaces`，实现在
  `Hetu.Infrastructure/Repositories`，并挂到 `IUnitOfWork`。
- **禁止在循环里查库**（N+1）：改成一次 `Where(id in …)` / 分组聚合 / 批量投影。

### 后台任务与 Agent 运行时

- 长耗时工作提交给 `IBackgroundTaskCoordinator`（记录 `TaskItem`，前端「后台任务」页可见）；不要用即发即忘的 `Task.Run`。
- Agent 运行时在 `src/Hetu.Agents/HetuAgentRunner.cs`：直接组合 MAF 的 `AIFunction`、`FunctionInvokingChatClient`、
  `ChatClientAgent` 与 `ToolApprovalAgent`；不要在 Core 里重新实现模型/工具循环。
- 运行中引导（`AgentSteeringHub`）通过 `SteeringContextProvider` 注入；权限模式（plan/readonly/ask/auto/bypass）折算为
  MAF 审批管道的放行/询问/拒绝，`ToolApprovalAgent` 负责自动放行，`ask` 通过 `ToolExecutionService` 等待前端。
  工作流 Agent / 工具节点没有审批或交互通道：`AgentNodeExecutor` 必须设 `InteractiveToolsSupported = false`，
  `ToolNodeExecutor` 必须传 `interactiveInputSupported: false`；遇到 `ask` / `ask_question` / `plan` 直接返回明确错误而不是等待超时。
- 对话历史统一交给 MAF `ChatHistoryProvider`：对话 / Code 会话由 Controller 从数据库加载历史并构造
  `PreloadedChatHistoryProvider`，`HetuAgentRunner` 只把「最后一条 user 消息」作为本轮输入；其他入口可回落到
  `InMemoryChatHistoryProvider`。历史压缩通过 `HetuChatReducer`（`ChatReducer`）执行，长历史会自动摘要旧消息；
  不要在 Agent 内部再手写一套历史循环。
- RAG / steering / @ 引用等消息类 `AIContextProvider` 注册在 chat client 管道（`UseAIContextProviders`），
  每次模型调用前执行；`AgentSkillsProvider` 必须留在 agent 级（它要注入工具，不能被 `AgentContextChatClient` 覆盖）。
- 技能广告走 MAF `AgentSkillsProvider` + 自定义 `AgentSkillsSource`，不要再把技能清单手工拼进 system prompt；
  技能脚本由 `AgentFileSkillScriptRunner` 执行（pwsh / bash / python / node，5 分钟超时），执行前必须经过审批管道。
- 子 Agent 使用 `AIAgent.AsAIFunction`（agent-as-tool）暴露给父 Agent；业务进度仍通过 `IAgentLoopSink` 转发。
- 非 Agent 文本任务需要 JSON 时使用 `ITextGenerationClient.ChatJsonWithUsageAsync<T>` / `ChatResponseFormatJson`，
  `LlmJsonExtractor` 只作为不支持 JSON Schema 的 Provider 的兜底。
- Agent 管道用 `AIAgentBuilder.UseOpenTelemetry` 包裹，保留 MAF 原生 tracing；不要另建一套调用链追踪。
- 会话状态用 `AIAgent.SerializeSessionAsync` 落 `AppSettings`（key 前缀 `agent-session:`）；Chat / Code 会话默认启用。
- 会话历史向量召回由 `ChatHistoryMemoryProvider` + `HetuChatHistoryVectorStore` 提供，受 AppSetting `EnableHistoryMemory` 控制；
  SQLite 用 `sqlite-vec` 的 `MATCH`、PostgreSQL 用 `pgvector` 的 `<=>` 做原生近邻检索，扩展不可用时回退内存余弦；
  `HistoryMemoryRetentionDays` 由 `AgentMemoryCleanupService` 每日清理（含 sqlite-vec 虚拟表）。
  `UsePerServiceCallHistoryPersistence` 控制 MAF 每服务调用的历史持久化。两者不要同时开启（会重复写入向量表）。
- Agent 消息契约使用 MEAI `ChatMessage`；`LlmChatMessage` 只保留在数据库/文本任务边界，转换集中在 `ChatMessageConversion`。
- 工具执行器仍是 `IToolExecutor` 业务抽象；交给 MAF 的边界统一为 `AIFunction`（`HetuAIFunction` / 原生 `McpClientTool`），
  不要再建第二套工具循环或工具定义协议（token 估算直接用 `ToolRegistry.EstimateSchemaChars`，不要为估算再造工具定义对象）。
- 工作流 Agent 节点的权限统一走运行级 `permissionMode`（五档）→ `AgentToolPolicy` → `DecideToolCall`；
  节点配置的 `toolApprovals` 只作显式覆盖。不要再新增运行级审批字符串参数（旧的 `toolApprovalMode` 已移除）。
- 权限模式清单（值 / 名称 / 说明）由后端 `/api/agent/permission-modes` 下发，前端只保留图标与配色映射；
  不要在两端各维护一份档位列表。
- `LlmStreamParser` 只解析文本形式的 `<thinking>` / `<tool_call>` 标签，是没有原生 function calling 的模型兼容层；
  原生工具调用走 `FunctionCallContent`，不要让它进入文本解析路径。
- RAG / 记忆检索封装为 `AIContextProvider`（`RagContextProvider`），通过 `AgentLoopRequest.ContextProviders` 交给 MAF；
  提供者内部只执行一次检索，后续迭代复用结果，避免每轮重复搜索。
- `@` 引用同样走 `AIContextProvider`（`MentionContextProvider`）；运行中引导走 `SteeringContextProvider`，
  不要把这些上下文再手工插入 `chatMessages`。
- MCP 统一走官方 `ModelContextProtocol`：`McpClientProvider` 复用连接，`McpClientTool` 直接作为 `AIFunction` 交给 MAF；
  不要再新增手写 JSON-RPC / stdio 客户端。
- 非 Agent 的文本任务（NoteAI / Wiki / Graph / 压缩 / 查询改写等）统一走 `ITextGenerationClient`（内部创建 MAF Agent），
  不要再引入第二套 LLM Provider HTTP 实现。
- SSE 事件（`delta` / `thinking` / `tool_*` / `steering` / `checkpoint` / `notice` …）在 `HetuAgentRunner` 边界转发。
  新增事件类型时前后端同步（`src/Hetu.Shared/Agent` + `frontend/src/utils/agentStream.ts`）。
- 异步迭代器带取消令牌时必须加 `[EnumeratorCancellation]`（否则 CS8425，且取消不生效）。

## 前端约定

### 组件与目录

- 函数组件 + Hooks；组件文件 `PascalCase.tsx`，页面在 `pages/`，通用组件在 `components/`（子域可建目录，如 `work/`、`agent/`）。
- 每个组件一个文件；**组件文件只导出组件**（工具函数放 `utils/`，否则 `react-refresh/only-export-components` 报错）。
- 自定义 Hook 放 `hooks/`，纯函数放 `utils/`。

### 组件化与样式来源（硬性准则）

- **交互控件禁止直接用原生标签**：`<button>`、`<input>`、`<textarea>`、`<select>` 等一律来自 `components/ui`
  （Button / IconButton / ToolbarToggle / Input / Textarea / SearchInput / Select / MultiSelect / Modal / TreeRow …）
  或已封装的业务组件；原生 `div` / `span` 只用于布局，不承载控件语义与视觉表面。
- **第三方库只允许出现在包装层**：ECharts、Milkdown、xterm、Markdown 渲染器等先包装成项目组件（收口主题、事件、空态与错误态），
  页面与业务组件不得从第三方包直接 import。
- **差异一律通过 props / 插槽表达**：variant / tone / size / pill / plain / padded，children、icon / iconRight、
  toolbar / toolbarTrailing / footerLeading / forehead / aboveInput、renderItem 等；
  需要新外观时扩展共享组件的静态变体表（如 `ui/tones.ts`、`ui/Input.tsx` 的 SIZES、`ui/ToolbarToggle.tsx` 的 tone 表），
  不在调用处拼 className 造样式。
- **页面不写一次性视觉样式**：边框、背景、圆角、阴影、悬停 / 聚焦 / 激活态等表面样式只能来自共享组件与
  `utils/styles.ts` 的公共类；页面 className 仅用于布局（flex / grid / gap / 尺寸 / 溢出）。颜色走 tone / 主题变量，不写死色值。
- **新增控件先查 `ui/`**：没有对应封装就先在 `ui/` 封装（含无障碍 label、dark 变体、禁用 / 激活态），再在页面使用；
  新增或调整共享组件、变体时，同步在 `/components` 组件页补一个真实示例（禁止用仿制品替代）。
- 存量代码不做无边界重写：改动到哪收敛到哪；**新增代码必须 100% 遵守本准则**。
- 边界由 `node scripts/audit-ui.mjs` 审计（基线 `scripts/ui-audit-baseline.json`）：原生控件与包装层外第三方 import
  **只降不升**；每个收敛批次完成后执行 `--update` 下调基线。
- 边界已固化到 ESLint：`no-restricted-syntax` 禁止在页面/业务组件写原生交互控件，`no-restricted-imports`
  禁止包装层外引入第三方 UI 库，不得用 eslint-disable 绕过。

### TypeScript

- `strict: true`；不用 `any`（用 `unknown` + 收窄或具体类型）；接口在 `types/` 统一导出。
- 类型不写 `as` 断言绕检查；确实需要时先注释原因。

### 数据获取

- 统一走 `services/*.ts` 封装（axios 实例 + 拦截器），组件里用 TanStack Query。
- Query key：`['资源', ...参数]`（如 `['workMessages', sessionId]`）；默认 `staleTime` 30s、`refetchOnWindowFocus: false`（见 `utils/queryClient.ts`）。
- 需要轮询的页面用 `refetchInterval`，并且**只在进行中时轮询**（`(q) => q.state.data?.some(x => x.running) ? 3000 : false`）。

### React 反模式清单（清过 18 个 eslint 报错，别再犯）

- **不要在 `useEffect` 里同步 `setState`**（会级联渲染）。需要「跟随 prop 变化」就用**派生值**：
  `const view = nav ?? selected ?? today`、`const draft = edit?.base === server ? edit.value : server`。
- `useEffect` / `useCallback` / `useMemo` 的依赖数组必须完整；不稳定的数组/对象先 `useMemo`（否则每次渲染重挂副作用）。
- 不要在渲染中创建会被当作依赖的对象/函数；`onClick={() => ...}` 这类内联回调没问题，但**传给副作用依赖的**必须包 `useCallback`。
- 数据到达后不需要「重置本地 state + effect」两段式；用 key 或派生值表达。

### 国际化与样式

- 所有可见文案走 `t('namespace:key')`，zh / en 同步添加。
- 样式分两层：**表面样式**（描边 / 底色 / 圆角 / 阴影 / 悬停 / 聚焦 / 激活态）只能来自共享组件；
  **布局样式**用 Tailwind 工具类（flex / grid / 间距 / 尺寸），深色模式差异由组件自带 `dark:` 变体。

### 路由

- 集中在 `frontend/src/App.tsx`；路径 kebab-case；页面级懒加载不强制。Code 页是 `对话 + Code` 的统一入口（`/chat`、`/work` 都重定向到 `/code`）。

## 桌面外壳（Tauri 2）

### 结构与环境变量

- `shell/hetu-desktop/src/backend.rs`：选空闲端口 → 起 sidecar（或开发时 `dotnet run`）→ 轮询 `/api/health` → 退出时 kill 子进程。
- 注入环境变量：`HETU_DATA_DIR`（SQLite/日志目录）、`HETU_PARENT_PID`（后端看门狗：外壳被强杀时后端自行退出，
  见 `src/Hetu.Api/Services/ParentProcessWatchdog.cs`）、`HETU_API_DEV_PORT`（开发复用外部后端端口）。
- sidecar 命名必须符合 Tauri 约定：`binaries/Hetu.Api-<rust-target-triple>(.exe)`。

### 托盘与退出

- 关闭主窗口默认最小化到托盘（后端继续跑，设置项 `CloseToTray`）；只有托盘「退出 Hetu」才真正退出并清理后端子进程。
- 结束进程 / `netstat` 调用要带 `CREATE_NO_WINDOW`，否则 Windows 会闪命令行窗口。

### 工作树

- 默认目录：`<仓库父目录>/.hetu-worktrees/<仓库名>/<工作树名>`；可在设置（`/api/settings/worktree`，键 `WorktreeConfig`）改根目录。
- 自动清理：`WorktreeCleanupWorker` + 配置（`WorktreeCleanupConfig`：间隔 / 空闲阈值 / 是否删分支），只清「干净且已合并/远端已删」的工作树。

### 安装器与更新

- `tauri.conf.json` 挂 `bundle.windows.nsis.installerHooks: "nsis-hooks.nsh"`：安装/升级前先
  `taskkill /F /IM Hetu.Api.exe /T`（否则残留后端的孤儿进程会锁住 `sqlite-vec\vec0.dll`，安装报
  “Error opening file for writing” —— 已发生过一次）。
- 双渠道：`tauri.fat.conf.json`（`Hetu`，自带运行时）/ `tauri.slim.conf.json`（`Hetu (Slim)`，需系统 .NET 10）。
- 更新清单由 `shell/hetu-desktop/scripts/make-latest-json.mjs` 生成：fat → `latest*.json`，slim → `latest-slim*.json`
  （各含 3 个镜像变体）。**URL 必须用 GitHub 清洗后的资产名**（非法字符段替换为单个点，例如
  `Hetu (Slim)_0.3.2_x64-setup.exe` → `Hetu.Slim._0.3.2_x64-setup.exe`）；任一渠道清单生成失败脚本会 `exit 1`，
  CI 直接失败，避免发出「更新点不动」的版本。

### 发版流程

```bash
# 1) 两处版本号必须同时改：
#    shell/hetu-desktop/src-tauri/tauri.conf.json 的 version
#    src/Hetu.Api/Hetu.Api.csproj 的 <Version>（前端「关于」页通过 /api/system/version 显示）
# 2) 提 PR → 合并到 main
# 3) 写 release-notes/v<version>.md（Release 与更新弹窗共用；缺省时 CI 按提交自动生成）
# 4) 打 tag 触发 Release Build（.github/workflows/release.yml）
pwsh ./scripts/tag-release.ps1 -Version 0.3.4
```

CI 产出：Windows NSIS/MSI + Linux AppImage/deb（fat / slim 各一套，带 `.sig`）、更新清单、GitHub Release。

## 数据库切换与向量存储

```bash
export DatabaseProvider=Postgresql
export ConnectionStrings__DefaultConnection="Host=...;Database=...;Username=...;Password=..."
dotnet ef migrations add <Name> --project src/Hetu.Infrastructure.PostgresMigrations --startup-project src/Hetu.Api
```

- PostgreSQL 必须安装并启用 `pgvector`。
- 向量维度由 `Embedding:Dimensions` 决定（默认 1536），必须与 Embedding 模型实际维度一致（SQLite 下不一致会插入失败）。
- Embedding 统一走官方 MEAI `IEmbeddingGenerator`（`MafEmbeddingProvider`），不要手写 `/embeddings` HTTP 请求。
- SQLite 的 `sqlite-vec` 原生库在 `src/Hetu.Infrastructure/sqlite-vec/vec0.dll`，连接打开时自动加载。

## 测试与验证

- 测试工程在 `src/Hetu.Core.Tests`（xUnit + NSubstitute）：`dotnet test src/Hetu.Core.Tests/Hetu.Core.Tests.csproj`。
  当前验证方式：Release 构建 0 告警 → 测试 → `eslint` / `tsc` → 起后端跑 `scripts/test-api.sh` 与针对性 `curl`
  → 浏览器实测关键流程。
- 新增核心业务逻辑（分页、聚合、压缩管道、Agent 循环等纯逻辑）时同步补测试
  （约定：xUnit + NSubstitute、命名 `方法名_场景_预期结果`，覆盖率目标核心逻辑 > 80%）。

## 提交与分支

```
<type>(<scope>): <subject>

<body 说明改了什么、为什么、怎么验证的>
```

- `type`：`feat | fix | docs | style | refactor | perf | test | chore`
- `scope`：`api | ui | db | ai | work | desktop | config`
- 分支：工作在一个 feature 分支上，完成即开 PR 合到 `main`；发版用单独的 `chore(release)` PR + tag。
- 一个 PR 解决一件事；PR 描述写清验证方式（命令 + 结果）。

## 文档

- `README.md`（English）与 `README.zh-CN.md`（简体中文）**必须同步更新**；界面截图放 `docs/screenshots/` 并保持一致命名。
- **官网与文档站**（GitHub Pages，源为 `main` 的 `/docs` 目录，地址 <https://wosledon.github.io/Hetu/>）：
  - 中文站：`docs/index.html` + `docs/guide/*.html`；英文站：`docs/en/index.html` + `docs/en/guide/*.html`（**两种语言成对维护**，各 16 个功能页）
  - 样式与脚本在 `docs/assets/`（无外部依赖、无构建步骤），`docs/.nojekyll` 关闭 Jekyll 处理
  - 每页必须带 `lang`、`canonical`、`og:*` 与三套 `hreflang`（zh-CN / en / x-default）；语言切换链接指向对应页面的另一语言
  - 截图放 `docs/screenshots/`，页面里用 `<img class="shot" src="../screenshots/xxx.png">` 引用（相对路径按页面深度算：`/guide` 用 `../`、`/en/guide` 用 `../../`），灯箱由 `site.js` 自动接管
  - 页脚访问计数：每页页脚内联 `<span class="visit-counter" data-visit-counter>`，数据由 `site.js` 从 abacus（命名空间 `hetu-docs`）读取，展示「访问人数 / 浏览量」；访客数用 `localStorage` 去重，`localhost`/`file:` 只读不写，接口不可用时整块隐藏（新增页面不要漏掉这段页脚标记）
  - 改完在本地起静态服务器（`python -m http.server 5180 --directory docs`）逐页点一遍：无失效链接、无横向滚动条、移动端导航可展开、灯箱与主题切换正常
- 公共 API 加 XML 文档注释；复杂业务逻辑写清楚「为什么」；TODO 用 `// TODO(名字): 描述`。
- 接口文档由 Scalar 生成（`/scalar/v1`），新增端点尽量给出示例请求/响应。

## 安全

- API Key 用 DataProtection 加密落库（Windows 走 DPAPI），不要明文写日志或返回给前端。
- 所有数据本地优先，不引入遥测/上报；网络请求只发往用户配置的模型供应商、用户启用的 MCP/搜索服务。唯一例外是官网页脚的聚合访问计数（写入 abacus 的 `hetu-docs` 命名空间，只上报递增计数，不携带 Cookie、账号或内容）。
- 命令执行类工具必须经过权限模式（`plan` / `readonly` / `ask` / `auto` / `bypass`）判定，不要绕过。
- SQL 一律走 EF Core 参数化查询；用户输入渲染 Markdown 前经 DOMPurify 过滤。
