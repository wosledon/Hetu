mod backend;

use std::sync::Arc;
use std::time::Duration;

use backend::{spawn_backend, BackendHandle};
use serde::Serialize;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Runtime, WindowEvent};
use tokio::sync::OnceCell;

/// dev 模式下主窗口加载的前端开发服务器地址（与 `frontend/vite.config.ts` 的 `server.port` 一致）。
const DEV_FRONTEND_URL: &str = "http://localhost:5174";

/// 关闭主窗口时默认最小化到托盘（与后端 `CloseToTray` 设置默认值保持一致）。
const CLOSE_TO_TRAY_DEFAULT: bool = true;

/// 用一个 OnceCell 跟踪后端句柄，方便 RunEvent 阶段清理。
static BACKEND: OnceCell<Arc<BackendHandle>> = OnceCell::const_new();

#[derive(Clone, Serialize)]
struct BackendReadyPayload {
    port: u16,
    base_url: String,
    data_dir: String,
}

#[tauri::command]
fn get_backend_info(state: tauri::State<'_, Arc<BackendHandle>>) -> BackendReadyPayload {
    BackendReadyPayload {
        port: state.port,
        base_url: state.base_url.clone(),
        data_dir: state.data_dir.to_string_lossy().to_string(),
    }
}

#[tauri::command]
async fn open_main_window<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    // main 窗口由 tauri.conf.json 在启动时创建；托盘点击仅做显示/聚焦。
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        main.show().map_err(|e| e.to_string())?;
        let _ = main.set_focus();
    }
    Ok(())
}

#[tauri::command]
fn open_data_dir<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let handle = app
        .try_state::<Arc<BackendHandle>>()
        .ok_or_else(|| "backend not ready".to_string())?;
    let path = handle.data_dir.to_string_lossy().to_string();
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(path, None::<String>)
        .map_err(|e| e.to_string())
}

/// 打开应用内嵌网页窗口（独立 WebViewWindow）。
///
/// 大模型网页对话普遍设置 X-Frame-Options / CSP frame-ancestors，前端 iframe 会被拒绝连接；
/// 用真实子窗口加载则不受该限制。已打开过的应用仅聚焦，不重复开窗。
#[tauri::command]
async fn open_app_webview<R: Runtime>(app: AppHandle<R>, url: String, title: String) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let parsed: url::Url = url.parse().map_err(|e| format!("invalid url: {e}"))?;
    let label = format!("app-{:x}", stable_hash(parsed.as_str()));

    if let Some(existing) = app.get_webview_window(&label) {
        existing.show().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let window_title = if title.trim().is_empty() { parsed.host_str().unwrap_or("应用").to_string() } else { title.trim().to_string() };
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title(&window_title)
        .inner_size(1200.0, 860.0)
        .min_inner_size(720.0, 480.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 稳定字符串哈希（FxHash 风格），用于把 URL 映射为窗口 label。
fn stable_hash(input: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in input.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            get_backend_info,
            open_main_window,
            open_data_dir,
            open_app_webview,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // 记录加载页开始显示的时刻，用于强制最小展示时长。
            let splash_start = std::time::Instant::now();

            // 后端启动放到异步任务，避免阻塞 setup（main 窗口由 config 直接显示加载页）。
            tauri::async_runtime::spawn(async move {
                match spawn_backend(&handle).await {
                    Ok(backend) => {
                        handle.manage(backend.clone());
                        let _ = BACKEND.set(backend.clone());
                        let payload = BackendReadyPayload {
                            port: backend.port,
                            base_url: backend.base_url.clone(),
                            data_dir: backend.data_dir.to_string_lossy().to_string(),
                        };
                        let _ = handle.emit("backend-ready", payload);
                        // 首屏最短展示时长：图标淡入 + 呼吸动效约需 0.6s，这里留一点缓冲。
                        let min_splash = std::time::Duration::from_millis(1200);
                        let elapsed = splash_start.elapsed();
                        if elapsed < min_splash {
                            tokio::time::sleep(min_splash - elapsed).await;
                        }
                        if let Err(err) = navigate_main_window(&handle, &backend.base_url) {
                            tracing::error!("navigate main window failed: {err:?}");
                            let _ = handle.emit("backend-error", err.to_string());
                        }
                    }
                    Err(err) => {
                        tracing::error!("backend spawn failed: {err:?}");
                        let _ = handle.emit("backend-error", err.to_string());
                    }
                }
            });

            // 系统托盘
            build_tray(app.handle())?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // 开启"最小化到托盘"时阻止关闭并隐藏窗口：应用与后端子进程继续后台运行，
                // 通过托盘图标可重新打开窗口，或经托盘菜单「退出 Hetu」真正退出。
                if window.label() == "main" && should_minimize_to_tray(window.app_handle()) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        if let RunEvent::ExitRequested { .. } = event {
            if let Some(handle) = BACKEND.get().cloned() {
                tauri::async_runtime::block_on(async move {
                    handle.shutdown().await;
                });
            }
            let _ = app;
        }
    });
}

/// 后端就绪后，把 main 窗口的加载页切换到前端主界面。
///
/// main 窗口由 `tauri.conf.json` 在启动时直接创建并显示加载动画，
/// 此处仅做 URL 导航，避免窗口创建/销毁带来的切换闪烁。
fn navigate_main_window<R: Runtime>(app: &AppHandle<R>, backend_base_url: &str) -> anyhow::Result<()> {
    let target_url = if cfg!(debug_assertions) {
        DEV_FRONTEND_URL.to_string()
    } else {
        format!("{}/", backend_base_url.trim_end_matches('/'))
    };
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| anyhow::anyhow!("main window not found"))?;
    tracing::info!("navigating main window to {target_url}");
    let url: url::Url = target_url.parse()?;
    main.navigate(url)?;
    Ok(())
}

/// 读取 `CloseToTray` 设置：关闭主窗口时是否最小化到系统托盘。
///
/// 设置保存在后端 SQLite，关闭窗口事件在 UI 线程同步触发，
/// 本地健康端点毫秒级返回；请求失败/后端未就绪时回落到默认值（后台运行）。
fn should_minimize_to_tray<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(backend) = app.try_state::<Arc<BackendHandle>>() else {
        return CLOSE_TO_TRAY_DEFAULT;
    };
    let url = format!("{}/api/settings/CloseToTray", backend.base_url);
    tauri::async_runtime::block_on(fetch_close_to_tray(&url)).unwrap_or(CLOSE_TO_TRAY_DEFAULT)
}

/// 查询后端 `GET /api/settings/CloseToTray`；`Some(true/false)` 为已持久化的值，`None` 表示未设置或请求失败。
async fn fetch_close_to_tray(url: &str) -> Option<bool> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(600))
        .build()
        .ok()?;
    let resp = client.get(url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let json: serde_json::Value = resp.json().await.ok()?;
    let data = json.get("data")?;
    if data.is_null() {
        return None;
    }
    Some(
        data.get("value")
            .and_then(|v| v.as_str())
            .is_some_and(|v| v.eq_ignore_ascii_case("true")),
    )
}

/// 托盘菜单事件分发。
fn handle_menu_event<R: Runtime>(handle: &AppHandle<R>, id: &str) {
    match id {
        "tray-quit" => {
            handle.exit(0);
        }
        "tray-open-data" => {
            if let Err(err) = open_data_dir(handle.clone()) {
                tracing::warn!("open data dir failed: {err}");
            }
        }
        "tray-show" => {
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        _ => {}
    }
}

fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id("tray-show", "显示主窗口").build(app)?;
    let open_data = MenuItemBuilder::with_id("tray-open-data", "打开数据目录").build(app)?;
    let quit = MenuItemBuilder::with_id("tray-quit", "退出 Hetu").build(app)?;
    let tray_menu = MenuBuilder::new(app)
        .item(&show)
        .separator()
        .item(&open_data)
        .separator()
        .item(&quit)
        .build()?;

    TrayIconBuilder::with_id("hetu-tray")
        .tooltip("Hetu")
        .icon(app.default_window_icon().expect("default window icon").clone())
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|handle, event| handle_menu_event(handle, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let handle = tray.app_handle();
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

fn init_tracing() {
    use tracing_subscriber::EnvFilter;
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,hetu::backend=debug"));
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
}
