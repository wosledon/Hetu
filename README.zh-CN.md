# Hetu 河图

> AI 增强的个人知识管理工具 —— 笔记 + 对话双引擎，本地优先。

[English](./README.md) | 简体中文

Hetu（河图）是一个本地优先的知识工作台，把 Markdown 笔记系统与 AI 对话工作区融合成一个整体，再通过向量检索、知识图谱、Agent + 工具层（MCP、联网搜索、技能、记忆）以及结构化的后台任务把它们串起来，让笔记、对话与 AI 行为沿着同一份不断生长的知识库共同进化。

---

## ✨ 功能介绍

### 📝 笔记与笔记本

- 基于 Milkdown 的所见即所得 Markdown 编辑器，支持 **编辑 / 预览 / 分栏** 三种视图。
- **行内 AI**：选中文本即可触发润色 / 翻译 / 精简 / 扩写 / 解释 / 自定义指令，可直接替换选区或将结果插入笔记。
- **AI 助手面板**：针对整篇笔记的全文操作；可按次切换模型，独立于全局默认模型。
- 无限层级笔记本，左侧树形侧栏支持创建 / 重命名 / 删除 / 右键菜单，并提供默认的「未分类」笔记本。
- 标签支持颜色、重命名、合并，以及在侧栏按标签筛选。
- **3 秒自动保存**，并有保存中 / 未保存 / 已保存 状态提示。
- **历史版本**：更新时自动留存版本，支持预览、对比与一键回滚。
- 笔记级 **分享链接**：永久 / 24 小时 / 3 天三档时效，自带访问计数与一键禁用，`/share/:code` 公开访问。
- 笔记顶部展示知识库 **索引状态**（已索引块数 / 重新索引按钮），以及 **一键图谱提取**（反馈新增实体 / 关系数）。
- **回收站**：软删除 + 30 天自动清理。

### 💬 对话工作区

- **会话组** + **话题** 两级组织，每个话题独立保留模型、系统提示词、上下文窗口和消息历史。
- **SSE 流式** 输出，事件类型丰富：`delta`、`thinking`、网络搜索结果、知识库命中、记忆命中、工具调用 / 工具结果、交互式提问、实时待办计划。
- **深度思考** 开关 + 思考强度选择（低 / 中 / 高），每条消息的思考链路可折叠查看。
- 输入区上方提供 **工具开关**：联网搜索、知识库、记忆、工具调用（带 自动 / 询问 / 静默 三种审批模式）、模型选择、Agent 选择、思考强度。
- **斜杠菜单**：输入 `/` 即可呼出技能 / Agent 快速调用。
- 消息支持 **复制 / 编辑 / 删除**，话题支持 **Fork** 进行分支探索。
- **一键整理为笔记**：摘要 / 详细 / Q&A / 自定义提示词 共 4 种风格，整理前流式预览，整理后写入指定笔记本。
- 支持 **附件上传** 与全话题内的消息 **搜索**。

### 🤖 智能体、技能与提示词

- **智能体页**：管理「系统提示词预设」（即 Agent），按分类组织，可搜索；每个 Agent 可配置 **工具白名单** 及 **每个工具的审批策略**（静默 / 自动 / 询问），并支持 JSON **导入 / 导出**。
- 内置工具面板包含：`search_notes`、`read_note`、`search_web`、`search_memory`、`search_graph`、`create_note`、`update_note`、`create_memory`、`ask_question`、`todo`、`run_command`。
- **技能页** 提供两个标签：
  - **数据库技能**：内置（翻译 / 总结 / 解释 / 润色）+ 自定义技能，可编辑提示词模板与系统提示词，并在页面内直接调用预览结果。
  - **本地技能**：从可配置目录加载磁盘上的 Markdown / JSON 技能文件，目录管理同样在页面内完成。
- 技能可以在对话中通过 `/skill-name` 调用，也可挂接到提示词预设上。

### 🧠 知识库

- 三个标签：**概览**、**索引管理** 与 **搜索测试**。
- 支持索引 **笔记、上传文件、网址** 三类来源，并提供类型筛选。
- 索引状态自动轮询：仍有未索引项时每 3 秒刷新一次；每条目展示块数与重新索引操作。
- 内置 **语义搜索 Playground**：可调 Top-K，高亮命中片段，验证检索效果。

### 🕸️ 知识图谱

- 力导向布局可视化，支持缩放、平移、搜索、重置布局。
- 实体类型带不同颜色与图标：概念、人物、组织、技术、项目、自定义。
- 关系类型：属于、相关、依赖、包含、对比、自定义。
- 支持对任一笔记 **AI 抽取** 实体与关系，并自动合并去重。
- 点击实体可以看到关联笔记并跳回编辑器。

### 🔌 MCP Server

- 在「设置 → MCP Server」管理 **Model Context Protocol** 服务。
- **stdio** 通道完整支持（进程拉起 + JSON-RPC 2.0），SSE 通道仅支持配置。
- **工具自动发现**（`tools/list`）与调用（`tools/call`），发现的工具可直接在对话中使用。

### 🧬 记忆

- 长期 **AI 记忆**：内容 + 可选分类（偏好 / 身份 / 工作 / 习惯 / 知识 / …）+ **重要度**（以 1–5 星形式呈现）。
- 支持创建、编辑、删除、搜索与筛选；通过对话中的 **记忆** 开关或 `search_memory` 工具被使用。

### 🗂️ 任务（后台作业）

- 两个标签：**后台任务** 与 **定时任务**。
- 实时状态：排队中 / 执行中 / 已完成 / 失败；支持按类型筛选（如 *Embedding 生成*、*知识图谱提取*）。
- 每 5 秒自动刷新；支持「清理已完成」与逐条删除。

### 🔎 全局搜索

- 跨 **笔记 / 对话 / 标签** 的统一搜索，分标签展示，`⌘/Ctrl + K` 一键聚焦。
- 提供 **关键词搜索** 与 **语义（向量）搜索** 两种模式；命中片段高亮显示，并可在原页内打开完整笔记。

### 🤝 分享与导出

- 笔记级 **分享链接**：带过期时间与访问计数；`/share/:code` 提供免登录只读阅读页。
- 设置 → **数据与备份**：一键导出全部笔记为 Markdown ZIP，备份 / 恢复 SQLite 数据库文件。

### ⚙️ 设置

- **应用**：显示名、主题（系统 / 亮色 / 暗色）、图谱选项。
- **AI 模型**：Provider（OpenAI 兼容 / Anthropic）、按用途（`chat` / `embedding` / `completion`）管理模型与默认值，API Key 加密。
- **MCP Server** 管理。
- **数据库**：在 SQLite / PostgreSQL 之间切换，并提供连接测试。
- **回收站** 入口。

### 🔐 隐私与存储

- 完全本地运行，无需注册任何云账号。
- API Key 通过 ASP.NET DataProtection（Windows 下走 DPAPI）加密落盘。
- 向量本地存储：SQLite 走 `sqlite-vec`，PostgreSQL 走 `pgvector`。

---

## 🧱 技术栈

| 层      | 选型                                                        |
| ------- | ----------------------------------------------------------- |
| 后端    | ASP.NET Core 10、EF Core 10、Serilog                        |
| 存储    | SQLite（默认，配合 `sqlite-vec`）/ PostgreSQL（`pgvector`） |
| 前端    | React 19、TypeScript 5、Vite 8、Tailwind CSS 4              |
| 状态    | Zustand（客户端）+ TanStack Query（服务端）                 |
| 编辑器  | Milkdown（所见即所得）+ react-markdown + DOMPurify          |
| AI 协议 | OpenAI 兼容、Anthropic，支持 Embedding 与 SSE 流式          |
| 接口    | RESTful API，MCP 使用 JSON-RPC 2.0                          |

## 📂 项目结构

```
Hetu/
├── src/
│   ├── Hetu.Api/                                 # Web API 主项目
│   ├── Hetu.Core/                                # 领域模型、服务、接口
│   ├── Hetu.Infrastructure/                      # EF Core、AI Provider、MCP、sqlite-vec
│   ├── Hetu.Infrastructure.PostgresMigrations/   # PostgreSQL 迁移
│   └── Hetu.Shared/                              # DTO 与共享模型
├── frontend/                                     # React + Vite 前端（页面见下表）
├── scripts/                                      # start.sh / start.ps1 / 测试脚本
├── docs/                                         # PRD 与设计文档
├── design/                                       # HTML 原型
└── AGENTS.md                                     # 实现约定
```

前端页面（路由定义见 [`frontend/src/App.tsx`](frontend/src/App.tsx)）：

| 路由                             | 页面     | 作用                                |
| -------------------------------- | -------- | ----------------------------------- |
| `/`                              | 笔记     | 笔记本树 + 笔记列表 + Markdown 编辑 |
| `/tags`                          | 标签     | 标签增删改、合并、重命名            |
| `/chat`                          | 对话     | 会话组 + 话题 + 流式消息区          |
| `/agents`                        | 智能体   | 系统提示词预设 + 工具策略           |
| `/skills`                        | 技能     | 数据库技能 + 本地技能               |
| `/knowledge-base`                | 知识库   | 索引管理与语义检索 Playground       |
| `/graph`                         | 知识图谱 | 力导向实体 / 关系图                 |
| `/tasks`                         | 任务     | 后台 / 定时任务监控                 |
| `/memories`                      | 记忆     | 长期 AI 记忆库                      |
| `/search`                        | 搜索     | 笔记 / 对话 / 标签 统一检索         |
| `/trash`                         | 回收站   | 软删除的笔记                        |
| `/settings`                      | 设置     | 应用 / AI / MCP / 数据库 / 回收站   |
| `/share/:code`                   | 分享笔记 | 免登录只读阅读页                    |
| `/models`、`/work`、`/workflows` | 占位页   | 为后续功能预留入口                  |

## 🚀 快速开始

### 环境要求

- .NET SDK **10.0+**
- Node.js **20+**
- （可选）PostgreSQL **16+** 且安装 `pgvector` 扩展

### 一键启动

```bash
# Linux / macOS / Git Bash
./scripts/start.sh

# PowerShell
.\scripts\start.ps1
```

### 手动启动

```bash
# 后端（默认 http://localhost:5000）
dotnet run --project src/Hetu.Api --urls "http://localhost:5000"

# 前端（默认 http://localhost:5173）
cd frontend
npm install
npm run dev
```

打开 <http://localhost:5173> 即可使用，API 地址为 <http://localhost:5000/api>。

## ⚙️ 配置 AI

1. 打开前端进入 **设置 → AI 模型**。
2. 添加 **Provider**：选择协议（OpenAI / Anthropic），填写 Base URL 与 API Key。
3. 在该 Provider 下添加 **Model**：
   - `Purpose`：`chat` / `embedding` / `completion`。
   - 为每个用途指定一个默认模型。
4. 保存后即可：对话流式输出、笔记向量化做语义搜索、对笔记跑图谱抽取。

> API Key 通过 ASP.NET DataProtection 加密落盘。

## 🗄️ 切换到 PostgreSQL

默认使用 SQLite，无需配置。如需切换到 PostgreSQL + `pgvector`：

```bash
export DatabaseProvider=Postgresql
export ConnectionStrings__DefaultConnection="Host=localhost;Database=hetu;Username=postgres;Password=postgres"

# 应用迁移（仅 schema 变化时需要）
dotnet ef database update \
  --project src/Hetu.Infrastructure.PostgresMigrations \
  --startup-project src/Hetu.Api
```

向量维度由 `Embedding:Dimensions`（默认 `1536`）控制，需与所配置的 Embedding 模型保持一致。

## 🧪 构建与测试

```bash
# 后端整解决方案构建
dotnet build Hetu.slnx

# 前端类型检查与生产构建
cd frontend
npm run build

# API 冒烟测试（需先启动后端）
./scripts/test-api.sh
```

## ⚠️ 已知限制

- Anthropic 暂未提供公开 Embedding API，把 Anthropic 用作 `embedding` 时会明确报错。
- MCP 仅 **stdio** 通道可用，**SSE** 通道仅支持配置、尚未实现调用。
- `/models`、`/work`、`/workflows` 当前为占位页，待后续功能落地。
- 笔记全文搜索目前使用 `LIKE`，FTS5 / `tsvector` 升级在路线图中。

## 🤝 参与贡献

欢迎提 Issue 与 PR。提交变更前请阅读 [`AGENTS.md`](./AGENTS.md) 了解项目约定（分层、命名、Commit 格式、测试要求）。

Commit 信息约定：

```
<type>(<scope>): <subject>

# type: feat | fix | docs | style | refactor | test | chore
# scope: api | ui | db | ai | config
```

## 📜 License

本项目基于 [Apache License 2.0](./LICENSE) 开源。

```
Copyright 2026 Hetu Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```
