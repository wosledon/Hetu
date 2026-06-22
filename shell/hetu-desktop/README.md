# Hetu Desktop Shell (Tauri 2)

Tauri 2 桌面外壳：在 Rust 侧拉起 `Hetu.Api`（ASP.NET Core 10）作为子进程，前端由后端的 `wwwroot` 同源托管，开发期由 Vite 提供 HMR。

## 架构概览

```
┌───────────────────── Tauri 主进程 (Rust) ─────────────────────┐
│  splash 窗口（启动页，监听 backend-ready/backend-error）       │
│  └─► spawn_backend() → /api/health 轮询 → 创建 main 窗口      │
│         ├─ dev: dotnet run --urls http://127.0.0.1:5000       │
│         └─ prod: sidecar Hetu.Api-<triple> + 动态端口         │
│  main 窗口                                                    │
│  └─► dev:  http://localhost:5174   (Vite, 代理 /api → 5000)   │
│      prod: http://127.0.0.1:{port} (sidecar 同源 wwwroot)     │
└────────────────────────────────────────────────────────────────┘
```

- **dev 模式**：Tauri 检测到 5000 端口已有健康后端则复用，否则自己 `dotnet run`。主窗口指向 5174，前端走 Vite 代理。
- **prod 模式**：Tauri 启动 sidecar 并挑选随机空闲端口；主窗口指向 sidecar，所有 `/api/...` 同源直连。
- **数据目录**：默认 OS 用户本地数据目录（Windows `%LOCALAPPDATA%/Hetu`；macOS `~/Library/Application Support/com.hetu.desktop`；Linux `~/.local/share/Hetu`）。可通过 `HETU_DATA_DIR` 环境变量覆盖。

## 开发

```bash
# 一键并行：dotnet (5000) + frontend Vite (5174) + Tauri shell
pwsh ./scripts/desktop-dev.ps1

# 或者分别启动
cd src/Hetu.Api && dotnet run --urls http://localhost:5000
cd frontend && npm run dev
cd shell/hetu-desktop && npm run tauri:dev
```

## 构建发行版

提供两个发行渠道：

| 渠道            | 命令                                                        | 体积    | 用户要求             |
| --------------- | ----------------------------------------------------------- | ------- | -------------------- |
| **fat（默认）** | `npm run publish:backend` → `npm run tauri:build:fat`       | ~120 MB | 无                   |
| **slim**        | `npm run publish:backend:slim` → `npm run tauri:build:slim` | ~30 MB  | 已装 .NET 10 Runtime |

完整流程（Windows x64）：

```powershell
# 1. 发布 Hetu.Api 为 sidecar（自动复制 wwwroot 与 sqlite-vec）
pwsh ./scripts/publish-backend.ps1                            # SelfContained（fat）
pwsh ./scripts/publish-backend.ps1 -Mode FrameworkDependent   # 瘦版（slim）

# 2. 打包 Tauri（MSI/NSIS），分别选择 fat / slim profile
cd shell/hetu-desktop
npm run tauri:build:fat    # 使用 tauri.fat.conf.json
npm run tauri:build:slim   # 使用 tauri.slim.conf.json
```

- sidecar 命名遵循 Tauri 约定：`Hetu.Api-x86_64-pc-windows-msvc.exe`。
- 跨平台只需把 `-Rid` 改成 `linux-x64` / `osx-arm64` 等并在对应 OS 上构建 Tauri。

## 关键文件

| 路径                                     | 说明                                                    |
| ---------------------------------------- | ------------------------------------------------------- |
| `src-tauri/src/lib.rs`                   | 应用入口：splash、托盘、菜单、命令、生命周期            |
| `src-tauri/src/backend.rs`               | 后端子进程管理：端口、健康检查、关闭清理                |
| `src-tauri/tauri.conf.json`              | Tauri 基础配置：splash 窗口、bundle、图标               |
| `src-tauri/tauri.fat.conf.json`          | fat 渠道覆盖：注入 sidecar `Hetu.Api` 与静态资源        |
| `src-tauri/tauri.slim.conf.json`         | slim 渠道覆盖（依赖系统 .NET 10）                       |
| `src-tauri/capabilities/default.json`    | 通用权限（webview、tray、menu、opener）                 |
| `src-tauri/capabilities/backend.json`    | shell 权限：允许执行 `dotnet` / sidecar `Hetu.Api`      |
| `index.html`                             | Splash 启动页（监听 `backend-ready` / `backend-error`） |
| `../../scripts/publish-backend.{ps1,sh}` | 发布 sidecar 的辅助脚本                                 |
| `../../scripts/desktop-dev.ps1`          | 一键启动开发栈                                          |

## 推荐 IDE

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
