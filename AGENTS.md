# Hetu - AI 增强知识管理工具

## 项目概述

Hetu 是一款面向个人用户的 AI 增强知识管理工具，采用笔记 + 对话双引擎设计，支持本地优先的数据存储策略。

## 技术栈

### 后端
- **框架**: ASP.NET Core 10
- **ORM**: Entity Framework Core
- **数据库**: SQLite（默认）/ PostgreSQL（可选）
- **API 风格**: RESTful API
- **认证**: 无认证（本地个人工具）

### 前端
- **框架**: React 18+
- **语言**: TypeScript
- **样式**: Tailwind CSS
- **状态管理**: Zustand
- **路由**: React Router
- **构建工具**: Vite

### AI 能力
- **LLM 协议**: OpenAI / Anthropic
- **Embedding**: OpenAI / Anthropic
- **MCP**: 支持 Model Context Protocol
- **Skill**: 技能系统

## 目录结构

```
Hetu/
├── src/                    # 后端源代码
│   ├── Hetu.Api/          # API 主项目
│   ├── Hetu.Core/         # 核心业务逻辑
│   ├── Hetu.Infrastructure/ # 基础设施层
│   └── Hetu.Shared/       # 共享模型/DTO
├── frontend/              # 前端源代码
│   ├── src/
│   │   ├── components/    # React 组件
│   │   ├── pages/         # 页面组件
│   │   ├── hooks/         # 自定义 Hooks
│   │   ├── stores/        # Zustand 状态管理
│   │   ├── services/      # API 调用服务
│   │   ├── types/         # TypeScript 类型定义
│   │   └── utils/         # 工具函数
│   └── public/            # 静态资源
├── docs/                  # 项目文档
│   └── PRD.md            # 产品需求文档
├── design/                # 原型设计
│   ├── index.html        # 笔记页
│   ├── chat.html         # 对话页
│   ├── search.html       # 搜索页
│   ├── graph.html        # 知识图谱页
│   ├── settings.html     # 设置页
│   ├── history.html      # 历史版本页
│   ├── export.html       # 导出与分享页
│   ├── overview.html     # 原型总览
│   ├── styles.css        # 共享样式
│   └── app.js            # 共享脚本
└── AGENTS.md             # 实现约定（本文件）
```

## 开发约定

### 后端约定

#### 项目分层
- **Hetu.Api**: Web API 层，负责路由、控制器、中间件
- **Hetu.Core**: 核心业务逻辑层，领域模型、业务服务
- **Hetu.Infrastructure**: 基础设施层，数据库访问、外部服务集成
- **Hetu.Shared**: 共享层，DTO、枚举、常量

#### 命名规范
- 类名：PascalCase（如 `NoteService`）
- 方法名：PascalCase（如 `GetNoteById`）
- 私有字段：camelCase（如 `_noteRepository`）
- 常量：PascalCase（如 `DefaultPageSize`）

#### API 设计
- RESTful 风格
- 统一响应格式：`{ success: boolean, data?: T, error?: string }`
- 错误码统一使用 HTTP 状态码
- 分页参数：`page`（从 1 开始）、`pageSize`（默认 20）

#### 数据库约定
- 使用 EF Core Code First
- 实体类继承 `BaseEntity`（包含 Id、CreatedAt、UpdatedAt）
- 软删除：使用 `IsDeleted` 字段
- 时间戳：统一使用 `DateTimeOffset`（UTC 时间）

#### 异常处理
- 业务异常：抛出自定义 `BusinessException`
- 全局异常处理中间件统一捕获
- 不向客户端暴露详细错误堆栈

### 前端约定

#### 组件规范
- 使用函数组件 + Hooks
- 组件文件命名：PascalCase（如 `NoteEditor.tsx`）
- 每个组件一个文件夹，包含：
  - `index.tsx` - 组件主文件
  - `types.ts` - 类型定义
  - `styles.ts` - 样式（如需要）

#### TypeScript 规范
- 严格模式：`strict: true`
- 避免使用 `any`，使用 `unknown` 或具体类型
- 接口命名：`I` 前缀（如 `INote`）或名词形式（如 `Note`）
- 类型导出：统一在 `types/index.ts` 导出

#### 状态管理
- 全局状态：Zustand（如用户设置、AI 配置）
- 服务端状态：React Query（如笔记列表、对话列表）
- 表单状态：React Hook Form
- 避免 prop drilling，使用 Context 或 Zustand

#### API 调用
- 统一在 `services/` 目录下封装
- 使用 axios 实例，配置统一的请求/响应拦截器
- 错误统一在拦截器中处理
- 返回类型必须明确定义

#### 样式规范
- 优先使用 Tailwind CSS 工具类
- 复杂样式使用 CSS Modules 或 styled-components
- 颜色、间距等使用 Tailwind 默认主题
- 响应式设计：使用 Tailwind 断点（sm、md、lg、xl）

#### 路由规范
- 使用 React Router v6+
- 路由配置集中在 `routes.tsx`
- 页面级组件放在 `pages/` 目录
- 路由命名：kebab-case（如 `/note-editor`）

### AI 功能约定

#### LLM 集成
- 使用统一的 `ILLMProvider` 接口
- 支持流式输出（SSE）
- Token 计数和费用统计
- 错误重试机制（指数退避）

#### Embedding 集成
- 向量存储：SQLite（本地）/ PostgreSQL（pgvector）
- 向量维度：根据模型自动适配
- 相似度计算：余弦相似度

#### MCP 集成
- 遵循 MCP 协议规范
- 工具发现：`tools/list`
- 工具调用：`tools/call`
- 结果展示：结构化展示输入/输出

#### Skill 系统
- Skill 定义：JSON Schema
- Skill 触发：`/skill-name` 或自然语言
- Skill 执行：调用 LLM 或 MCP 工具

### 测试约定

#### 后端测试
- 单元测试：xUnit
- 集成测试：WebApplicationFactory
- Mock 框架：NSubstitute
- 测试命名：`方法名_场景_预期结果`（如 `GetNoteById_NoteExists_ReturnsNote`）
- 测试覆盖率目标：核心业务逻辑 > 80%

#### 前端测试
- 组件测试：Vitest + React Testing Library
- E2E 测试：Playwright（后续添加）
- Mock API：MSW（Mock Service Worker）
- 测试文件命名：`*.test.tsx` 或 `*.spec.tsx`

### 提交规范

#### Commit Message 格式
```
<type>(<scope>): <subject>

<body>

<footer>
```

#### Type 类型
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 重构（既不是新增功能，也不是修改 bug）
- `test`: 测试相关
- `chore`: 构建过程或辅助工具的变动

#### Scope 范围
- `api`: 后端 API
- `ui`: 前端界面
- `db`: 数据库相关
- `ai`: AI 功能
- `config`: 配置相关

#### 示例
```
feat(api): 添加笔记搜索 API

- 实现全文搜索（SQLite FTS5）
- 实现语义搜索（Embedding 相似度）
- 支持分页和排序

Closes #42
```

### 代码审查要点

#### 后端
- [ ] 是否遵循分层架构
- [ ] 是否有单元测试覆盖
- [ ] 异常处理是否合理
- [ ] 是否有 SQL 注入风险
- [ ] 性能是否可接受

#### 前端
- [ ] 是否使用 TypeScript 严格模式
- [ ] 是否有合理的错误处理
- [ ] 是否避免内存泄漏（清理副作用）
- [ ] 是否遵循组件规范
- [ ] 是否响应式设计

### 性能约定

#### 后端
- API 响应时间：< 200ms（P95）
- 数据库查询：避免 N+1 查询
- 缓存策略：Redis（可选）
- 分页：所有列表 API 必须分页

#### 前端
- 首屏加载：< 2s（3G 网络）
- 代码分割：路由级别懒加载
- 图片优化：WebP 格式，懒加载
- 虚拟滚动：长列表使用虚拟滚动

### 安全约定

#### 后端
- API Key 加密存储（DPAPI / 密钥管理器）
- 输入验证：FluentValidation
- SQL 注入防护：使用 EF Core 参数化查询
- XSS 防护：Markdown 渲染时过滤危险标签

#### 前端
- 敏感信息不存储在 localStorage
- API Key 通过后端代理访问
- 用户输入消毒：DOMPurify

### 文档约定

#### 代码文档
- 公共 API 必须有 XML 文档注释
- 复杂业务逻辑必须有注释
- TODO 注释格式：`// TODO(username): 描述`

#### API 文档
- 使用 Swagger 自动生成
- 每个 API 必须有示例请求/响应
- 错误码说明

#### 用户文档
- 功能说明
- 配置指南
- 常见问题

### 启动方式

#### 本地开发
- 后端：`dotnet run`（默认端口 5000）
- 前端：`npm run dev`（默认端口 5173）
- 数据库：SQLite 本地文件（自动创建）
- 启动顺序：先后端，后前端

#### 一键启动
- 使用 `start.sh` 脚本同时启动前后端
- 或使用 VS Code 的 launch.json 配置多项目启动

#### 桌面外壳（Tauri 2，可选）
- 位于 `shell/hetu-desktop/`，由 Rust 拉起 `Hetu.Api` 子进程并加载前端
- 开发：`pwsh ./scripts/desktop-dev.ps1`（并行起 dotnet+vite+tauri）
- 发布：`pwsh ./scripts/publish-backend.ps1` 生成 sidecar → `cd shell/hetu-desktop && npm run tauri:build`
- 双渠道：SelfContained（默认，单文件，~120MB）/ FrameworkDependent（瘦版，需用户安装 .NET 10）
- sidecar 命名约定：`Hetu.Api-<rust-target-triple>(.exe)`，例 `Hetu.Api-x86_64-pc-windows-msvc.exe`
- 后端通过 `HETU_DATA_DIR` 环境变量接收 OS 用户数据目录（SQLite/日志均落于此）
- dev 期 Tauri 检测 5000 端口已有后端则复用，避免与开发者自己跑的 `dotnet run` 冲突

#### 数据库切换（SQLite / PostgreSQL）
- 通过 `DatabaseProvider` 配置切换：`Sqlite`（默认）或 `Postgresql`
- SQLite 连接字符串：`Data Source=hetu.db`
- PostgreSQL 连接字符串示例：`Host=192.168.1.4;Database=dreamvox;Username=admin;Password=admin@123`
- 生成 PostgreSQL 迁移前需设置环境变量：
  ```bash
  export DatabaseProvider=Postgresql
  export ConnectionStrings__DefaultConnection="Host=...;Database=...;Username=...;Password=..."
  dotnet ef migrations add InitialCreate --project src/Hetu.Infrastructure.PostgresMigrations --startup-project src/Hetu.Api
  ```
- PostgreSQL 必须安装并启用 `pgvector` 扩展，否则迁移会失败

#### 向量存储
- SQLite：使用 `sqlite-vec` 扩展（`src/Hetu.Infrastructure/sqlite-vec/vec0.dll`），连接打开时自动加载
- PostgreSQL：使用 `pgvector` 扩展，向量维度由 `Embedding:Dimensions` 配置决定（默认 1536）
- 维度配置需与 Embedding 模型实际维度一致，否则会导致 SQLite 向量插入失败

### 版本管理

#### 语义化版本
- `MAJOR.MINOR.PATCH`
- MAJOR：不兼容的 API 变更
- MINOR：向下兼容的功能新增
- PATCH：向下兼容的问题修正

#### 分支策略
- `main`: 生产分支
- `develop`: 开发分支
- `feature/*`: 功能分支
- `hotfix/*`: 紧急修复分支

### 依赖管理

#### 后端
- 使用 NuGet 包管理
- 定期更新依赖（每月一次）
- 避免引入不必要的依赖

#### 前端
- 使用 npm 包管理
- 定期更新依赖（每月一次）
- 避免引入过大的依赖（如 moment.js）

### 其他约定

#### 日志
- 使用 Serilog
- 日志级别：Debug、Information、Warning、Error
- 结构化日志（JSON 格式）
- 日志保留：7 天

#### 配置
- 使用 `appsettings.json`
- 敏感配置使用环境变量或密钥管理器
- 配置项命名：PascalCase

#### 国际化
- 当前版本：仅支持中文
- 预留国际化能力（资源文件）

#### 辅助功能
- 键盘快捷键支持
- 屏幕阅读器友好
- 高对比度模式（后续）

---

**最后更新**: 2026-06-19
**维护者**: Hetu 开发团队
