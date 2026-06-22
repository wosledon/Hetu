mod backend;

use std::sync::Arc;

use backend::{spawn_backend, BackendHandle};
use serde::Serialize;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Runtime, WindowEvent};
use tokio::sync::OnceCell;

/// dev 模式下主窗口加载的前端开发服务器地址（与 `frontend/vite.config.ts` 的 `server.port` 一致）。
const DEV_FRONTEND_URL: &str = "http://localhost:5174";

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_backend_info,
            open_main_window,
            open_data_dir,
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
                        // 强制加载动画至少展示 1.5s，避免后端秒开导致一闪而过。
                        let min_splash = std::time::Duration::from_millis(1500);
                        let elapsed = splash_start.elapsed();
                        if elapsed < min_splash {
                            tokio::time::sleep(min_splash - elapsed).await;
                        }
                        if let Err(err) = navigate_main_window(&handle) {
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
            if let WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    // 当前策略：关闭主窗口即退出应用；如需改为托盘最小化，可调用 api.prevent_close() + window.hide()。
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
fn navigate_main_window<R: Runtime>(app: &AppHandle<R>) -> anyhow::Result<()> {
    let target_url = resolve_main_url(app)?;
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| anyhow::anyhow!("main window not found"))?;
    tracing::info!("navigating main window to {target_url}");
    // 用 location.replace 导航，不留历史记录，避免用户后退回加载页。
    let js = format!(
        "window.location.replace({})",
        serde_json::to_string(&target_url)?
    );
    main.eval(&js)?;
    Ok(())
}

fn resolve_main_url<R: Runtime>(app: &AppHandle<R>) -> anyhow::Result<String> {
    // dev：直接指向 Vite，享受 HMR；prod：指向后端 sidecar 同源 wwwroot。
    if cfg!(debug_assertions) {
        return Ok(DEV_FRONTEND_URL.to_string());
    }
    if let Some(handle) = app.try_state::<Arc<BackendHandle>>() {
        return Ok(format!("{}/", handle.base_url.trim_end_matches('/')));
    }
    Ok(DEV_FRONTEND_URL.to_string())
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
