# Hetu

> AI-augmented personal knowledge management — Notes + Chat as dual engines, local-first by design.

[简体中文](./README.zh-CN.md) | English

Hetu (河图) is a local-first knowledge workspace that fuses a Markdown note system with an AI chat workspace, then connects them through embeddings, a knowledge graph, an agent + tool layer (MCP, web search, skills, memories) and structured background tasks — so notes, conversations and AI actions evolve as one living knowledge base.

---

## ✨ Features

### 📝 Notes & Notebooks

- WYSIWYG Markdown editing (Milkdown) plus **Edit / Preview / Split** view modes.
- **Inline AI** triggered by text selection (Polish / Translate / Condense / Expand / Explain / Custom) — replace selection or insert the result back into the note.
- **AI Assistant panel** for whole-note actions, with **per-call model selection** independent of the global default.
- Infinitely-nested notebooks with a tree sidebar (create / rename / delete / context menu), including a default "Uncategorized" bucket.
- Tags with color picker, rename, merge and filter from the sidebar.
- **3-second autosave** with explicit save / dirty / saved indicators.
- **Version history** — auto-snapshotted on update, with preview, diff and one-click restore.
- **Share links** per note (permanent / 24h / 3-day), with view counters and one-click disable; public viewer at `/share/:code`.
- Per-note **knowledge-base index** status (chunk count, re-index button) and **one-click graph extraction** that reports new entities / relations.
- **Trash** view with soft-delete and 30-day cleanup.

### 💬 Chat Workspace

- Conversation **Groups** and **Topics**, each topic with its own model, system prompt, context window and message history.
- **SSE streaming** with rich event types — `delta`, `thinking`, web-search results, knowledge-base hits, memory hits, tool calls / results, interactive questions, and live to-do plans.
- **Deep thinking** toggle with reasoning-effort picker (low / medium / high) and a collapsible thinking trace per message.
- **Toolbelt toggles** alongside the input box: Web Search, Knowledge Base, Memory, Tool-calling (with approval mode: auto / ask / bypass), Model picker, Agent picker, Reasoning effort.
- **Slash menu** (`/`) to invoke Skills or Agents inline.
- Message **copy / edit / delete**, with topic **fork** for branching exploration.
- **Distill to note** — turn a topic into a Markdown note in 4 styles (Summary / Detailed / Q&A / custom prompt) with streaming preview and notebook picker.
- **File attachments** on the input, plus full-conversation **search** across messages.

### 🤖 Agents, Skills & Prompts

- **Agents page** — manage system-prompt presets ("agents") with categories, search, per-agent **tool whitelist** and **per-tool approval policy** (silent / auto / ask), plus JSON **import / export** of all agents.
- Available tool surface includes: `search_notes`, `read_note`, `search_web`, `search_memory`, `search_graph`, `create_note`, `update_note`, `create_memory`, `ask_question`, `todo`, `run_command`.
- **Skills page** — two tabs:
  - **Database skills**: built-in (Translate / Summarize / Explain / Polish) + custom skills with editable prompt template and system prompt; invoke directly from the page to preview output.
  - **Local skills**: load Markdown / JSON skill files from configurable directories on disk, with directory management UI.
- Skills are callable from chat via `/skill-name` and from the prompt-preset library.

### 🧠 Knowledge Base

- Three tabs: **Overview**, **Index management** and **Search test**.
- Index any combination of **notes, uploaded files and URLs** — type filters for Notes / Files / URLs / All.
- Live indexing status with auto-polling while items remain unindexed; per-item chunk counts and re-index actions.
- Built-in **semantic search playground** to validate retrieval with adjustable Top-K and highlighted chunk previews.

### 🕸️ Knowledge Graph

- Force-directed graph visualization with zoom, pan, search and reset-layout controls.
- **Entity types** with distinct colors and icons: Concept, Person, Organization, Technology, Project, Custom.
- **Relation types**: belongs-to, related-to, depends-on, contains, compared-with, custom.
- **AI extraction** of entities and relations from any selected note, with merge / dedup pass.
- Click an entity to see linked notes and jump back into the editor.

### 🔌 MCP Servers

- Manage **Model Context Protocol** servers from Settings → MCP Server.
- **stdio** transport fully supported (process spawning + JSON-RPC 2.0); SSE transport is configurable.
- **Auto tool discovery** (`tools/list`) and tool invocation (`tools/call`); discovered tools become callable from chat.

### 🧬 Memories

- Long-term **AI memory store** — content, optional category (Preference / Identity / Work / Habit / Knowledge / …) and **importance** score (rendered as 1–5 stars).
- Create, edit, delete, search and filter memories; surfaced to chat through the **Memory** toggle and the `search_memory` tool.

### 🗂️ Tasks (Background Jobs)

- Two tabs: **Background tasks** and **Scheduled tasks**.
- Live status for jobs: Queued / Running / Done / Failed, with type filtering (e.g. *Generate Embedding*, *Graph Extract*).
- Auto-refresh every 5 s, plus "clear completed" and per-task delete.

### 🔎 Global Search

- Unified search across **Notes / Chats / Tags** with tabs and `⌘/Ctrl + K` focus shortcut.
- Two modes: **Keyword search** and **Semantic (embedding) search**; results highlight matched fragments and open the full note in-place.

### 🤝 Sharing & Export

- Per-note **share links** with expiration and access counters; public viewer route renders the rendered Markdown without login.
- Settings → **Data & backup**: export all notes as a Markdown ZIP, back up / restore the SQLite database file.

### ⚙️ Settings

- **App**: display name, theme (System / Light / Dark) and graph options.
- **AI Models**: providers (OpenAI-compatible / Anthropic), models per purpose (`chat` / `embedding` / `completion`), default-by-purpose, encrypted API keys.
- **MCP Server** management.
- **Database**: switch between SQLite and PostgreSQL, run connection tests.
- **Trash** shortcut from the settings index.

### 🔐 Privacy & Storage

- 100% local execution — no cloud account required.
- API keys encrypted at rest via ASP.NET DataProtection (DPAPI on Windows).
- Vectors stored locally with `sqlite-vec`, or in PostgreSQL with `pgvector`.

---

## 🧱 Tech Stack

| Layer    | Stack                                                              |
| -------- | ------------------------------------------------------------------ |
| Backend  | ASP.NET Core 10, EF Core 10, Serilog                               |
| Storage  | SQLite (default, with `sqlite-vec`) / PostgreSQL (with `pgvector`) |
| Frontend | React 19, TypeScript ~6, Vite 8, Tailwind CSS 4                     |
| State    | Zustand (client) + TanStack Query (server)                         |
| Editor   | Milkdown (WYSIWYG) + react-markdown renderer + DOMPurify           |
| AI       | OpenAI-compatible & Anthropic protocols, embeddings, SSE streaming |
| Protocol | RESTful API, JSON-RPC 2.0 for MCP                                  |

## 📂 Project Structure

```
Hetu/
├── src/
│   ├── Hetu.Api/                                 # Web API host
│   ├── Hetu.Core/                                # Domain entities, services, interfaces
│   ├── Hetu.Infrastructure/                      # EF Core, AI providers, MCP, sqlite-vec
│   ├── Hetu.Infrastructure.PostgresMigrations/   # PostgreSQL migrations
│   └── Hetu.Shared/                              # DTOs and shared models
├── frontend/                                     # React + Vite app (see pages below)
├── shell/
│   └── hetu-desktop/                             # Tauri 2 desktop shell (optional)
├── scripts/                                      # start.sh / start.ps1 / test scripts
├── docs/                                         # PRD and design notes
├── design/                                       # HTML prototypes
└── AGENTS.md                                     # Implementation conventions
```

Frontend page map (routes in [`frontend/src/App.tsx`](frontend/src/App.tsx)):

| Route                            | Page            | Purpose                                     |
| -------------------------------- | --------------- | ------------------------------------------- |
| `/`                              | Notes           | Notebook tree + note list + Markdown editor |
| `/tags`                          | Tags            | Tag CRUD, merge, rename                     |
| `/chat`                          | Chat            | Groups + topics + streaming message area    |
| `/agents`                        | Agents          | System-prompt presets + tool policies       |
| `/skills`                        | Skills          | Database skills + local skills              |
| `/knowledge-base`                | Knowledge Base  | Indexing & semantic-search playground       |
| `/graph`                         | Knowledge Graph | Force-directed entity/relation graph        |
| `/tasks`                         | Tasks           | Background & scheduled job monitor          |
| `/memories`                      | Memories        | Long-term AI memory store                   |
| `/search`                        | Search          | Keyword + semantic search across content    |
| `/trash`                         | Trash           | Soft-deleted notes                          |
| `/settings`                      | Settings        | App / AI / MCP / Database / Trash           |
| `/share/:code`                   | Shared note     | Public read-only viewer                     |
| `/models`, `/work`, `/workflows` | Placeholders    | Reserved for upcoming surfaces              |

## 🚀 Quick Start

### Prerequisites

- .NET SDK **10.0+**
- Node.js **20+**
- (Optional) PostgreSQL **16+** with the `pgvector` extension

### One-shot launch

```bash
# Linux / macOS / Git Bash
./scripts/start.sh

# PowerShell
.\scripts\start.ps1
```

### Run manually

```bash
# Backend (defaults to http://localhost:5000)
dotnet run --project src/Hetu.Api --urls "http://localhost:5000"

# Frontend (defaults to http://localhost:5174)
cd frontend
npm install
npm run dev
```

Then open <http://localhost:5174>. The API is served at <http://localhost:5000/api>.

### Desktop Shell (Tauri 2, optional)

A native desktop wrapper is available under `shell/hetu-desktop/`. It launches the backend as a sidecar process and loads the frontend in a WebView.

```bash
# Development
pwsh ./scripts/desktop-dev.ps1

# Build (SelfContained ≈120 MB, or FrameworkDependent slim)
pwsh ./scripts/publish-backend.ps1
cd shell/hetu-desktop && npm run tauri:build
```

The backend receives the OS user data directory via `HETU_DATA_DIR`, where SQLite databases and logs are stored.

## ⚙️ Configure AI Providers

1. Open the app and go to **Settings → AI Models**.
2. Add a **Provider**: pick a protocol (OpenAI / Anthropic), enter Base URL and API Key.
3. Add **Models** under that provider:
   - `Purpose`: `chat`, `embedding`, or `completion`.
   - Mark one model as default per purpose.
4. Save — chat streams replies, notes can be embedded for semantic search, and graph extraction can run.

> API keys are encrypted at rest using ASP.NET DataProtection.

## 🗄️ Switching to PostgreSQL

SQLite is the default and requires no setup. To use PostgreSQL + `pgvector`:

```bash
export DatabaseProvider=Postgresql
export ConnectionStrings__DefaultConnection="Host=localhost;Database=hetu;Username=postgres;Password=postgres"

# Apply migrations (only needed when the schema changes)
dotnet ef database update \
  --project src/Hetu.Infrastructure.PostgresMigrations \
  --startup-project src/Hetu.Api
```

The vector column dimension is controlled by `Embedding:Dimensions` (default `1536`) and must match your embedding model.

## 🧪 Build & Test

```bash
# Backend build (whole solution)
dotnet build Hetu.slnx

# Frontend type-check + production build
cd frontend
npm run build

# API smoke tests (backend must be running)
./scripts/test-api.sh
```

## ⚠️ Known Limitations

- Anthropic does not currently expose a public embedding API — selecting Anthropic for `embedding` raises an explicit error.
- MCP **SSE** transport is configurable but only **stdio** is wired up for tool execution.
- `/models`, `/work`, `/workflows` pages are placeholders for upcoming features.
- Full-text search across notes uses `LIKE`; an FTS5 / `tsvector` upgrade is planned.

## 🤝 Contributing

Issues and PRs are welcome. Please read [`AGENTS.md`](./AGENTS.md) for layering, naming, commit format and testing conventions before submitting changes.

Conventional commit format:

```
<type>(<scope>): <subject>

# type: feat | fix | docs | style | refactor | test | chore
# scope: api | ui | db | ai | config
```

## 📜 License

Licensed under the [Apache License 2.0](./LICENSE).

```
Copyright 2026 Hetu Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```
