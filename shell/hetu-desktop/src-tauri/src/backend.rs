//! Hetu.Api 后端子进程管理。
//!
//! 设计要点：
//! - 动态选取空闲端口（portpicker），通过 `--urls http://127.0.0.1:{port}` 注入后端。
//! - 通过 `HETU_DATA_DIR` 环境变量把 SQLite/日志切到 Tauri 提供的用户数据目录。
//! - 开发模式直接 `dotnet run --project ...`；发布模式使用 Tauri sidecar (`Hetu.Api`)。
//! - 启动后轮询 `/api/health` 判断就绪；窗口关闭时 kill 子进程，避免遗留。

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use tauri::async_runtime::Mutex;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::time::{sleep, timeout};

/// 启动后端时的健康检查超时。
const HEALTH_TIMEOUT: Duration = Duration::from_secs(60);
/// 单次健康检查 HTTP 超时。
const HEALTH_PROBE_TIMEOUT: Duration = Duration::from_millis(800);
/// 健康检查轮询间隔。
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(400);

/// 后端运行态。注入到 Tauri State，供前端命令查询端口、关闭时清理。
pub struct BackendHandle {
    pub port: u16,
    pub base_url: String,
    pub data_dir: PathBuf,
    child: Mutex<Option<CommandChild>>,
}

impl BackendHandle {
    pub fn new(port: u16, data_dir: PathBuf, child: CommandChild) -> Self {
        Self {
            port,
            base_url: format!("http://127.0.0.1:{port}"),
            data_dir,
            child: Mutex::new(Some(child)),
        }
    }

    /// 创建一个不持有子进程的句柄（开发期复用已有后端时使用）。
    pub fn new_external(port: u16, data_dir: PathBuf) -> Self {
        Self {
            port,
            base_url: format!("http://127.0.0.1:{port}"),
            data_dir,
            child: Mutex::new(None),
        }
    }

    /// 优雅关闭后端子进程；调用多次安全。
    pub async fn shutdown(&self) {
        let mut guard = self.child.lock().await;
        if let Some(child) = guard.take() {
            if let Err(err) = child.kill() {
                tracing::warn!("kill backend child failed: {err:?}");
            } else {
                tracing::info!("backend child killed");
            }
        }
    }
}

/// 启动后端并等待健康检查通过。
pub async fn spawn_backend(app: &AppHandle) -> Result<Arc<BackendHandle>> {
    // dev 模式（debug build）：使用固定端口，与 `frontend/vite.config.ts` 的代理目标一致；
    //                          被占用时直接报错，避免与已在跑的 `dotnet run` 双开冲突。
    // prod 模式：每次随机挑选空闲端口，避免与用户机器上其他服务冲突。
    let port = if cfg!(debug_assertions) {
        let fixed: u16 = std::env::var("HETU_API_DEV_PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(5000);
        fixed
    } else {
        portpicker::pick_unused_port().ok_or_else(|| anyhow!("no free TCP port available"))?
    };
    let urls = format!("http://127.0.0.1:{port}");

    let data_dir = resolve_data_dir(app)?;
    std::fs::create_dir_all(&data_dir).with_context(|| format!("create data dir {data_dir:?}"))?;

    tracing::info!(target: "hetu::backend", "spawning backend on {urls}, data dir {data_dir:?}");

    // dev 模式：若端口上已经有健康的后端（开发者自己 `dotnet run`），跳过 spawn 复用即可。
    if cfg!(debug_assertions) {
        if probe_health(port, Duration::from_millis(500)).await {
            tracing::info!(target: "hetu::backend", "detected existing backend on {urls}, reusing");
            return Ok(Arc::new(BackendHandle::new_external(port, data_dir)));
        }
    }

    let (mut rx, child) = build_command(app, &urls, &data_dir)?;

    // 把后端 stdout/stderr 转发到 tracing，便于在 Tauri 控制台调试。
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    tracing::info!(target: "hetu::backend::stdout", "{}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Stderr(line) => {
                    tracing::warn!(target: "hetu::backend::stderr", "{}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Error(err) => {
                    tracing::error!(target: "hetu::backend", "backend error: {err}");
                }
                CommandEvent::Terminated(payload) => {
                    tracing::warn!(target: "hetu::backend", "backend terminated: {:?}", payload);
                    break;
                }
                _ => {}
            }
        }
    });

    wait_until_ready(port).await.with_context(|| {
        format!("backend at {urls} did not become healthy within {:?}", HEALTH_TIMEOUT)
    })?;

    Ok(Arc::new(BackendHandle::new(port, data_dir, child)))
}

/// 根据运行模式构建 sidecar 或 `dotnet run` 命令。
fn build_command(
    app: &AppHandle,
    urls: &str,
    data_dir: &PathBuf,
) -> Result<(tauri::async_runtime::Receiver<CommandEvent>, CommandChild)> {
    let shell = app.shell();

    // 优先使用打包的 sidecar；找不到时回退到系统 `dotnet run`（仅供开发用）。
    let sidecar_cmd = shell.sidecar("Hetu.Api");

    let (rx, child) = match sidecar_cmd {
        Ok(cmd) => {
            tracing::info!(target: "hetu::backend", "using bundled sidecar");
            cmd.args(["--urls", urls])
                .env("HETU_DATA_DIR", data_dir.to_string_lossy().to_string())
                .env("ASPNETCORE_ENVIRONMENT", "Production")
                .env("DOTNET_NOLOGO", "1")
                .spawn()
                .context("spawn Hetu.Api sidecar")?
        }
        Err(err) => {
            tracing::warn!(
                target: "hetu::backend",
                "sidecar not available ({err}); falling back to `dotnet run`"
            );
            let project_dir = resolve_dev_project_dir(app)?;
            shell
                .command("dotnet")
                .args([
                    "run",
                    "--project",
                    project_dir.to_string_lossy().as_ref(),
                    "--no-launch-profile",
                    "--",
                    "--urls",
                    urls,
                ])
                .env("HETU_DATA_DIR", data_dir.to_string_lossy().to_string())
                .env("ASPNETCORE_ENVIRONMENT", "Development")
                .env("DOTNET_NOLOGO", "1")
                .spawn()
                .context("spawn dotnet run for Hetu.Api")?
        }
    };

    Ok((rx, child))
}

/// 解析 Hetu.Api 项目目录（仅在开发模式 sidecar 缺失时使用）。
///
/// 优先：`HETU_API_PROJECT` 环境变量；否则按仓库布局推断 `shell/hetu-desktop/src-tauri` → `src/Hetu.Api`。
fn resolve_dev_project_dir(app: &AppHandle) -> Result<PathBuf> {
    if let Ok(custom) = std::env::var("HETU_API_PROJECT") {
        return Ok(PathBuf::from(custom));
    }

    // CARGO_MANIFEST_DIR -> .../shell/hetu-desktop/src-tauri
    let manifest = std::env::var("CARGO_MANIFEST_DIR")
        .map(PathBuf::from)
        .or_else(|_| app.path().resource_dir().map_err(|e| anyhow!(e.to_string())))?;

    let candidate = manifest
        .ancestors()
        .nth(3)
        .map(|p| p.join("src").join("Hetu.Api"));

    match candidate {
        Some(path) if path.exists() => Ok(path),
        _ => Err(anyhow!(
            "cannot locate Hetu.Api project; set HETU_API_PROJECT env var"
        )),
    }
}

/// 解析数据目录。优先 `HETU_DATA_DIR`，否则使用 Tauri 提供的 `BaseDirectory::AppLocalData`。
fn resolve_data_dir(app: &AppHandle) -> Result<PathBuf> {
    if let Ok(custom) = std::env::var("HETU_DATA_DIR") {
        if !custom.trim().is_empty() {
            return Ok(PathBuf::from(custom));
        }
    }

    app.path()
        .resolve("", BaseDirectory::AppLocalData)
        .map(PathBuf::from)
        .or_else(|_| {
            app.path()
                .app_local_data_dir()
                .map_err(|e| anyhow!(e.to_string()))
        })
}

/// 轮询 `/api/health`，直到返回 200 或超时。
async fn wait_until_ready(port: u16) -> Result<()> {
    let url = format!("http://127.0.0.1:{port}/api/health");
    let client = reqwest::Client::builder()
        .timeout(HEALTH_PROBE_TIMEOUT)
        .build()
        .context("build reqwest client")?;

    let probe = async {
        loop {
            match client.get(&url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    tracing::info!(target: "hetu::backend", "health check passed at {url}");
                    return Ok::<(), anyhow::Error>(());
                }
                Ok(resp) => {
                    tracing::debug!(target: "hetu::backend", "health status: {}", resp.status());
                }
                Err(err) => {
                    tracing::debug!(target: "hetu::backend", "health probe error: {err}");
                }
            }
            sleep(HEALTH_POLL_INTERVAL).await;
        }
    };

    timeout(HEALTH_TIMEOUT, probe)
        .await
        .map_err(|_| anyhow!("timeout waiting for /api/health"))?
}

/// 单次健康探测：用于 dev 模式判断端口上是否已有现成后端。
async fn probe_health(port: u16, total_timeout: Duration) -> bool {
    let url = format!("http://127.0.0.1:{port}/api/health");
    let Ok(client) = reqwest::Client::builder()
        .timeout(HEALTH_PROBE_TIMEOUT)
        .build()
    else {
        return false;
    };
    let probe = async {
        if let Ok(resp) = client.get(&url).send().await {
            return resp.status().is_success();
        }
        false
    };
    timeout(total_timeout, probe).await.unwrap_or(false)
}
