# Hetu - AI 增强知识管理工具

Hetu 是一款面向个人用户的 AI 增强知识管理工具，采用「笔记 + 对话」双引擎设计，支持本地优先的数据存储策略。

## 技术栈

- **后端**: ASP.NET Core 10 + EF Core 10 + SQLite
- **前端**: React 19 + TypeScript 5.x + Vite 8 + Tailwind CSS 4
- **AI**: 统一 LLM / Embedding Provider 抽象，支持 OpenAI 协议与 Anthropic 协议
- **状态管理**: Zustand（客户端状态）+ TanStack Query（服务端状态）

## 已完成功能

### Milestone 1：笔记基础（MVP）

- 笔记本 CRUD，支持无限层级嵌套
- 笔记 CRUD、Markdown 编辑、3 秒自动保存
- 标签管理与筛选
- 全文搜索
- 回收站（软删除、恢复）
- 应用设置（显示名称、主题）

### Milestone 2：AI 能力

- AI Provider 管理（OpenAI / Anthropic）
- AI Model 管理（chat / embedding / completion），支持默认模型
- API Key 使用 DPAPI 加密存储
- 对话模块：会话组、话题、消息
- SSE 流式对话输出
- 笔记侧 AI 后端：摘要、续写
- Embedding 向量化与语义搜索（SQLite 下使用内存余弦相似度）
- 前端 AI 设置页与对话页面

### Milestone 3：对话沉淀与整理

- 一键将话题整理为 Markdown 笔记（摘要 / 详细 / Q&A 风格）
- 整理前流式预览，整理后自动保存到目标笔记本
- 预设提示词库（内置 + 用户自定义）
- 前端设置页管理提示词

### Milestone 4：历史版本

- 笔记更新时自动保存历史版本（最多保留 20 个）
- 查看历史版本列表与内容预览
- 一键恢复到指定历史版本

### Milestone 4：Skill 技能系统

- Skill 实体与 CRUD 管理（内置 + 用户自定义）
- 启动时内置 4 个常用 Skill：translate、summarize、explain、polish
- 在对话中通过 `/skill-name` 命令触发 Skill
- 前端设置页管理 Skill

### Milestone 5：导出与备份

- 一键导出全部笔记为 Markdown ZIP
- 下载 SQLite 数据库备份文件
- 上传 .db 文件恢复数据

## 快速开始

### 环境要求

- .NET SDK 10.0+
- Node.js 20+

### 启动方式

#### 方式一：一键启动（推荐）

```bash
./scripts/start.sh        # Linux / macOS / Git Bash
# 或
.\scripts\start.ps1       # PowerShell
```

#### 方式二：分别启动

```bash
# 后端（默认端口 5000）
dotnet run --project src/Hetu.Api --urls "http://localhost:5000"

# 前端（默认端口 5173）
cd frontend && npm run dev
```

前端访问地址：http://localhost:5173
后端 API 地址：http://localhost:5000/api

## 配置 AI

1. 打开前端页面，进入「设置 → AI 模型」。
2. 添加 Provider：选择协议类型（OpenAI / Anthropic），填写 Base URL、API Key。
3. 在该 Provider 下添加 Model：
   - Purpose: `chat` / `embedding` / `completion`
   - 将需要的用途设为默认（IsDefault）。
4. 保存后即可在对话页使用流式聊天。

## 项目结构

```
Hetu/
├── src/
│   ├── Hetu.Api/              # Web API 层
│   ├── Hetu.Core/             # 核心业务逻辑与接口
│   ├── Hetu.Infrastructure/   # 数据库、AI Provider 实现
│   └── Hetu.Shared/           # DTO 与共享模型
├── frontend/                  # React 前端
├── scripts/                   # 启动与测试脚本
├── docs/
│   └── PRD.md                 # 产品需求文档
└── design/                    # 原型设计文件
```

## 测试

```bash
# 后端构建
dotnet build src/Hetu.Api -c Release

# 前端构建
cd frontend && npm run build

# API 集成测试（需先启动后端）
./scripts/test-api.sh
```

## 已知问题

- EF Core 警告：Note 全局查询过滤器与 NoteTag / NoteVersion / NoteEmbedding 的必需关系冲突（运行时无影响）。
- 语义搜索在 SQLite 模式下使用内存余弦相似度，大数据量时建议切换到 PostgreSQL + pgvector。
- Anthropic 当前未提供公开 Embedding API，选择 Anthropic 用途为 embedding 时会抛出明确提示。
- 前端对话流式输出在遇到 `[ERROR]` 事件时仅追加显示，未做更精细的错误 UI。

## 后续规划

参见 `docs/PRD.md` 中的里程碑计划：

- Milestone 4：MCP Server
- Milestone 5：PostgreSQL、PWA、桌面壳、附件上传
