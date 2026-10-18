mod backend;

use std::path::PathBuf;
use std::process::Stdio;
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

/// 用系统默认浏览器打开外链。
///
/// webview 会拦掉 window.open 与 <a target="_blank">（表现为点击没反应），
/// 必须由壳侧调 opener 插件交给系统浏览器。
#[tauri::command]
fn open_external<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
    tracing::info!(target: "hetu::shell", "open external url: {url}");
    let result = tauri_plugin_opener::OpenerExt::opener(&app).open_url(url.clone(), None::<String>);
    if let Err(err) = &result {
        tracing::error!(target: "hetu::shell", "open external failed: {err}");
    }
    result.map_err(|e| e.to_string())
}

/* ───────── 启动屏主题 ─────────
   启动屏与应用页面不同 origin（壳资源 vs 后端 http 端口），拿不到应用自己的 localStorage，
   所以由应用把主题设置写进数据目录里的一个小文件，启动屏启动时读它铺底色。 */

/// 主题持久化文件路径（与数据库同目录）
fn ui_theme_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    backend::data_dir(app).ok().map(|dir| dir.join("ui-theme"))
}

/// 读取持久化主题；只认 light / dark / system
fn read_ui_theme(app: &AppHandle) -> Option<String> {
    let raw = std::fs::read_to_string(ui_theme_path(app)?).ok()?;
    let theme = raw.trim().to_string();
    if theme == "light" || theme == "dark" || theme == "system" {
        Some(theme)
    } else {
        None
    }
}

/// 窗口底色跟随主题：HTML 绘制前先由壳铺好底，深色主题不会闪一帧白。
/// system 交给 webview 的 prefers-color-scheme，这里不动。
fn apply_window_theme(app: &AppHandle, theme: &str) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let color = match theme {
        "light" => Some(tauri::window::Color(248, 249, 251, 255)),
        "dark" => Some(tauri::window::Color(12, 15, 26, 255)),
        _ => None,
    };
    let _ = window.set_background_color(color);
}

#[tauri::command]
fn get_ui_theme(app: AppHandle) -> Option<String> {
    read_ui_theme(&app)
}

#[tauri::command]
fn set_ui_theme(app: AppHandle, theme: String) -> Result<(), String> {
    if theme != "light" && theme != "dark" && theme != "system" {
        return Err(format!("invalid theme: {theme}"));
    }
    let path = ui_theme_path(&app).ok_or_else(|| "data dir unavailable".to_string())?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, &theme).map_err(|e| e.to_string())?;
    apply_window_theme(&app, &theme);
    tracing::info!(target: "hetu::shell", "ui theme saved: {theme}");
    Ok(())
}

/// 打开应用内嵌网页窗口（独立 WebViewWindow）。
///
/// 大模型网页对话普遍设置 X-Frame-Options / CSP frame-ancestors，前端 iframe 会被拒绝连接；
/// 用真实子窗口加载则不受该限制。已打开过的应用仅聚焦，不重复开窗。
#[tauri::command]
async fn open_app_webview<R: Runtime>(app: AppHandle<R>, url: String, title: String) -> Result<(), String> {
    let parsed: url::Url = url.parse().map_err(|e| format!("invalid url: {e}"))?;
    let window_title = window_title(&parsed, &title);
    create_app_webview(&app, parsed, &window_title)
}

/// 打开网页应用的统一入口。
///
/// 优先用系统里已安装的 Chromium 浏览器（Edge / Chrome / Brave / Chromium）以「应用模式」
/// 开一个独立窗口，并使用应用自己的配置目录：
/// - 真实浏览器内核，Google 等站点不会像对待 WebView 那样拒绝登录；
/// - 每个站点独立 Cookie，登录一次长期有效，不和日常浏览器互相干扰；
/// - 没有地址栏与标签页，观感仍然像一个内置应用。
///
/// 系统没有 Chromium 浏览器时退回 Tauri 自带 WebView 窗口，并在前端提示可改用系统浏览器。
#[tauri::command]
async fn open_app_window<R: Runtime>(app: AppHandle<R>, url: String, title: String) -> Result<String, String> {
    let parsed: url::Url = url.parse().map_err(|e| format!("invalid url: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(format!("unsupported url scheme: {}", parsed.scheme()));
    }
    let window_title = window_title(&parsed, &title);

    match spawn_browser_app_window(&app, &parsed) {
        Ok(()) => Ok("browser".to_string()),
        Err(err) => {
            tracing::warn!(target: "hetu::shell", "browser app window unavailable, falling back to webview: {err}");
            create_app_webview(&app, parsed, &window_title)?;
            Ok("webview".to_string())
        }
    }
}

fn window_title(parsed: &url::Url, title: &str) -> String {
    if title.trim().is_empty() {
        parsed.host_str().unwrap_or("应用").to_string()
    } else {
        title.trim().to_string()
    }
}

/// 创建（或聚焦）Tauri WebView 应用窗口。OAuth 弹窗交给默认实现，避免登录按钮无反应。
fn create_app_webview<R: Runtime>(app: &AppHandle<R>, parsed: url::Url, title: &str) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let label = format!("app-{:x}", stable_hash(parsed.as_str()));

    if let Some(existing) = app.get_webview_window(&label) {
        existing.show().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(app, &label, WebviewUrl::External(parsed))
        .title(title)
        .inner_size(1200.0, 860.0)
        .min_inner_size(720.0, 480.0)
        // 独立数据目录：登录状态与主界面隔离，并跨重启保留（macOS 不支持，忽略即可）
        .data_directory(app_data_dir(app).join("apps").join("webview"))
        // 第三方登录普遍通过 window.open 弹窗完成；不接管会被直接吞掉
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Allow)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 数据目录：优先复用后端注入的 HETU_DATA_DIR，保证应用配置与数据库在同一处。
fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    if let Some(handle) = app.try_state::<Arc<BackendHandle>>() {
        return handle.data_dir.clone();
    }
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
}

/// 用 Chromium 浏览器的应用模式打开独立窗口；找不到浏览器时返回错误，由调用方回退。
fn spawn_browser_app_window<R: Runtime>(app: &AppHandle<R>, parsed: &url::Url) -> Result<(), String> {
    let browser = find_chromium_browser().ok_or_else(|| "no chromium-based browser found".to_string())?;

    let host = parsed.host_str().unwrap_or("app");
    let profile = app_data_dir(app)
        .join("apps")
        .join(format!("{}-{:x}", sanitize_component(host), stable_hash(host)));
    std::fs::create_dir_all(&profile).map_err(|e| format!("create profile dir failed: {e}"))?;

    let mut command = std::process::Command::new(&browser);
    command
        .arg(format!("--app={parsed}"))
        .arg(format!("--user-data-dir={}", profile.display()))
        .args([
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-search-engine-choice-screen",
            "--window-size=1200,860",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 不弹控制台窗口，避免启动应用时黑框闪一下
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
        .spawn()
        .map_err(|e| format!("launch {} failed: {e}", browser.display()))?;
    tracing::info!(target: "hetu::shell", "opened app window via {} for {parsed}", browser.display());
    Ok(())
}

/// 主机名转成安全的目录名（保留字母数字与 . - _，其余替换为 -）
fn sanitize_component(value: &str) -> String {
    value
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '-' })
        .take(64)
        .collect()
}

#[cfg(target_os = "windows")]
fn find_chromium_browser() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    for base in ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"] {
        if let Some(root) = std::env::var_os(base) {
            let root = PathBuf::from(root);
            candidates.push(root.join(r"Microsoft\Edge\Application\msedge.exe"));
            candidates.push(root.join(r"Google\Chrome\Application\chrome.exe"));
            candidates.push(root.join(r"BraveSoftware\Brave-Browser\Application\brave.exe"));
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

#[cfg(target_os = "macos")]
fn find_chromium_browser() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
    .into_iter()
    .map(PathBuf::from)
    .collect();
    // 用户目录下的安装（无需管理员权限）
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home).join("Applications");
        candidates.push(home.join("Google Chrome.app/Contents/MacOS/Google Chrome"));
        candidates.push(home.join("Microsoft Edge.app/Contents/MacOS/Microsoft Edge"));
        candidates.push(home.join("Brave Browser.app/Contents/MacOS/Brave Browser"));
        candidates.push(home.join("Chromium.app/Contents/MacOS/Chromium"));
    }
    candidates.into_iter().find(|path| path.is_file())
}

#[cfg(target_os = "linux")]
fn find_chromium_browser() -> Option<PathBuf> {
    let names = [
        "microsoft-edge",
        "microsoft-edge-stable",
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        "brave-browser",
    ];
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn find_chromium_browser() -> Option<PathBuf> {
    None
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
            open_external,
            get_ui_theme,
            set_ui_theme,
            open_app_webview,
            open_app_window,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // 记录加载页开始显示的时刻，用于强制最小展示时长。
            let splash_start = std::time::Instant::now();

            // 启动屏底色：用上次应用里保存的主题铺底，避免深色用户先看到一帧白
            if let Some(theme) = read_ui_theme(&handle) {
                apply_window_theme(&handle, &theme);
            }

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
