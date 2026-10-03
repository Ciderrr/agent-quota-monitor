// Agent Quota Monitor —— Tauri 2 壳（Gate D）。
// Local First：无云后端、无遥测；凭证只进 Windows Credential Manager。
pub mod activity;
pub mod commands;
pub mod codex;
pub mod credentials;
pub mod deepseek;
pub mod http;
pub mod mimo;
pub mod scheduler;
pub mod store;
pub mod types;
pub mod winproc;
pub mod workbuddy;
pub mod zcode;

use scheduler::{Runtime, SharedRuntime, Thresholds};
use std::collections::HashMap;
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent}, Emitter, Manager,
};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 二次启动 → 显示已存在的浮窗
            if let Some(w) = app.get_webview_window("widget") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        // aqm:// 回传通道：登录页 fetch/导航到此，不依赖远程 IPC
        .register_uri_scheme_protocol("aqm", |ctx, request| {
            use tauri::http::{header::CONTENT_TYPE, Response};
            let app = ctx.app_handle();
            let mut log = String::new();
            log.push_str(&format!("method={} uri={}\n", request.method(), request.uri()));
            let mut payload: Option<serde_json::Value> = None;
            // POST body
            if *request.method() == tauri::http::Method::POST && !request.body().is_empty() {
                log.push_str(&format!("body_len={}\n", request.body().len()));
                if let Ok(v) = serde_json::from_slice::<serde_json::Value>(request.body()) {
                    payload = Some(v);
                } else {
                    // 可能是表单/文本
                    let s = String::from_utf8_lossy(request.body()).to_string();
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                        payload = Some(v);
                    }
                }
            }
            // GET query
            if payload.is_none() {
                let uri = request.uri().to_string();
                for key in ["d=", "p="] {
                    if let Some(idx) = uri.find(key) {
                        let raw = &uri[idx + key.len()..];
                        let raw = raw.split('&').next().unwrap_or(raw);
                        if let Some(json) = percent_decode(raw) {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
                                payload = Some(v);
                                break;
                            }
                        }
                    }
                }
            }
            let _ = std::fs::create_dir_all(
                dirs_data().join("AgentQuotaMonitor").join("logs"),
            );
            let log_path = dirs_data()
                .join("AgentQuotaMonitor")
                .join("logs")
                .join("aqm-proto.log");
            log.push_str(&format!(
                "payload_ok={}\n---\n",
                payload.is_some()
            ));
            let _ = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .and_then(|mut f| std::io::Write::write_all(&mut f, log.as_bytes()));

            // WorkBuddy 分支：aqm://wb（导航 ?d= 或 POST body 均可）
            // 行格式：套餐名|总量;剩余;已用|...
            let uri_str = request.uri().to_string();
            if uri_str.contains("wb?") || uri_str.contains("/wb") {
                let mut handled = false;
                let mut line: Option<String> = None;
                // POST body 优先
                if *request.method() == tauri::http::Method::POST && !request.body().is_empty() {
                    let s = String::from_utf8_lossy(request.body()).to_string();
                    if s.contains('|') { line = Some(s); }
                }
                if line.is_none() {
                    if let Some(idx) = uri_str.find("d=") {
                        let raw = &uri_str[idx + 2..];
                        let raw = raw.split('&').next().unwrap_or(raw);
                        if let Some(decoded) = percent_decode(raw) {
                            if decoded.contains('|') { line = Some(decoded); }
                        }
                    }
                }
                if let Some(line) = line {
                    let mut parts = line.split('|');
                    let plan = parts.next().unwrap_or("").trim().to_string();
                    let mut pkgs: Vec<(f64, f64, f64)> = vec![];
                    for p in parts {
                        let mut it = p.split(';');
                        let t = it.next().and_then(|x| x.trim().parse::<f64>().ok());
                        let r2 = it.next().and_then(|x| x.trim().parse::<f64>().ok());
                        let u = it.next().and_then(|x| x.trim().parse::<f64>().ok());
                        if let (Some(t), Some(r2), Some(u)) = (t, r2, u) {
                            pkgs.push((t, r2, u));
                        }
                    }
                    if !pkgs.is_empty() {
                        let snap = crate::workbuddy::map_title(&plan, &pkgs);
                        {
                            let rt = app.state::<SharedRuntime>();
                            let mut r = rt.lock().unwrap();
                            r.snapshots.insert("workbuddy".to_string(), snap.clone());
                        }
                        {
                            let store = app.state::<store::Store>();
                            store.insert_snapshot("workbuddy", &serde_json::to_string(&snap).unwrap_or_default());
                        }
                        let _ = app.emit("snapshot-updated", serde_json::json!({ "providerId": "workbuddy" }));
                        handled = true;
                    }
                }
                let body_text = if handled { "已保存积分，可关闭本窗口。" } else { "积分读取失败（见诊断），请重试。" };
                return Response::builder()
                    .status(200)
                    .header(CONTENT_TYPE, "text/html; charset=utf-8")
                    .body(
                        format!(
                            "<html><body style=\"font:14px sans-serif;padding:24px\">{}</body></html>",
                            body_text
                        )
                        .into_bytes(),
                    )
                    .unwrap();
            }
            if let Some(p) = payload {
                let rt = app.state::<SharedRuntime>();
                let store = app.state::<store::Store>();
                let _ = commands::store_mimo_payload(app, &rt, &store, &p);
                return Response::builder()
                    .status(200)
                    .header(CONTENT_TYPE, "text/html; charset=utf-8")
                    .body(
                        "<html><body style=\"font:14px sans-serif;padding:24px\">已保存额度，可关闭本窗口。</body></html>"
                            .as_bytes()
                            .to_vec(),
                    )
                    .unwrap();
            }
            Response::builder()
                .status(200)
                .header(CONTENT_TYPE, "text/html; charset=utf-8")
                .body(
                    "<html><body style=\"font:14px sans-serif;padding:24px\">aqm recv (no payload)</body></html>"
                        .as_bytes()
                        .to_vec(),
                )
                .unwrap()
        })
        .on_window_event(|window, event| {
            // 预声明窗（红线）：用户点 X = 隐藏而非销毁，之后可重新打开
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label();
                if matches!(label, "settings" | "tray-menu" | "mimo-login" | "wb-login") {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            // 存储
            let store = store::Store::open().map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)))?;
            let settings_json = store.kv_get("settings");
            let (default_view, notify_enabled, thresholds, refresh_interval_ms, glass_strength) = settings_json
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .map(|v| {
                    (
                        v.get("defaultView").and_then(|x| x.as_str()).unwrap_or("collapsed").to_string(),
                        v.get("notifyEnabled").and_then(|x| x.as_bool()).unwrap_or(true),
                        serde_json::from_value::<Thresholds>(
                            v.get("thresholds").cloned().unwrap_or(serde_json::json!({})),
                        ).unwrap_or_default(),
                        v.get("refreshIntervalMs").and_then(|x| x.as_i64()).unwrap_or(0),
                        v.get("glassStrength").and_then(|x| x.as_f64()).unwrap_or(1.0),
                    )
                })
                .unwrap_or_else(|| ("collapsed".into(), true, Thresholds::default(), 0i64, 1.0f64));

            let mut enabled: HashMap<String, bool> = HashMap::new();
            for p in scheduler::PROVIDER_IDS { enabled.insert(p.to_string(), true); }
            let mut next_due_ms: HashMap<String, i64> = HashMap::new();
            for p in scheduler::PROVIDER_IDS { next_due_ms.insert(p.to_string(), 0); } // 启动即拉取
            let kv_family = store.kv_get("zcode/family");

            app.manage(store.clone());
            // 启动恢复上次快照（避免重启后全部变「需要登录」）
            let mut boot_snaps: HashMap<String, crate::types::Snapshot> = HashMap::new();
            let mut boot_unparsed = 0usize;
            for (id, payload) in store.load_latest_snapshots() {
                match serde_json::from_str::<crate::types::Snapshot>(&payload) {
                    Ok(s) => { boot_snaps.insert(id, s); }
                    Err(_) => { boot_unparsed += 1; }
                }
            }
            eprintln!("[aqm] boot: restored {} snapshots from sqlite (unparsed {boot_unparsed})", boot_snaps.len());
            // Key 型 Provider 凭据已不存在时：启动即如实回「未配置」，不用旧快照假装已连接
            for (id, slot) in [("deepseek", "deepseek/api-key"), ("zcode", "zcode/coding-plan-key")] {
                let has = crate::credentials::get_credential(slot).map(|v| v.is_some()).unwrap_or(false);
                if !has {
                    boot_snaps.insert(id.to_string(), scheduler::not_connected_snapshot(id));
                }
            }

            app.manage::<SharedRuntime>(std::sync::Arc::new(std::sync::Mutex::new(Runtime {
                snapshots: boot_snaps,
                enabled,
                next_due_ms,
                fail_count: HashMap::new(),
                default_view,
                thresholds,
                notify_enabled,
                refresh_interval_ms,
                glass_strength,
                kv_family,
                last_fetch_ms: HashMap::new(),
                last_session_read_ms: HashMap::new(),
                read_in_progress: HashMap::new(),
            })));

            // 浮窗：右上角定位。不铺 Mica/Acrylic，webview 背景全透明——
            // 可视边界就是前端圆角玻璃本身。
            let win = app.get_webview_window("widget").expect("widget window");
            position_top_right(&win);
            let _ = win.set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)));

            // 托盘：左键呼出浮窗；右键在主 WebView 内弹出菜单（可保持打开）
            // 托盘图标：显式用生成的 PNG（256px 足够托盘渲染，避免 1024px 原图撑大 exe）
            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon-256.png"))
                .unwrap_or_else(|_| app.default_window_icon().unwrap().clone());
            let _tray = TrayIconBuilder::with_id("main-tray")
                .show_menu_on_left_click(false)
                .icon(tray_icon)
                .on_tray_icon_event(|tray, event| {
                    let app = tray.app_handle();
                    match event {
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                        | TrayIconEvent::DoubleClick {
                            button: MouseButton::Left,
                            ..
                        } => {
                            if let Some(w) = app.get_webview_window("tray-menu") {
                                let _ = w.hide();
                            }
                            if let Some(w) = app.get_webview_window("widget") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        TrayIconEvent::Click {
                            button: MouseButton::Right,
                            button_state: MouseButtonState::Up,
                            rect,
                            ..
                        } => {
                            let scale = app
                                .get_webview_window("widget")
                                .and_then(|w| w.scale_factor().ok())
                                .unwrap_or(1.0);
                            let pos: tauri::PhysicalPosition<f64> = rect.position.to_physical(scale);
                            let size: tauri::PhysicalSize<f64> = rect.size.to_physical(scale);
                            // 物理像素：菜单右缘对齐托盘，向上弹出
                            let x = pos.x + size.width - 200.0 * scale;
                            let y = pos.y - 176.0 * scale - 8.0;
                            let _ = commands::show_tray_menu_at(app.clone(), x, y);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // MiMo：登录页 emit('mimo-payload') 兜底
            {
                use tauri::Listener;
                let rt = app.state::<SharedRuntime>().inner().clone();
                let store = app.state::<store::Store>().inner().clone();
                let app2 = app.handle().clone();
                let _ = app.handle().listen("mimo-payload", move |event| {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(event.payload()) {
                        let _ = commands::store_mimo_payload(&app2, &rt, &store, &v);
                    }
                });
            }

            // 调度循环：30s 节拍（事件驱动 tick，非忙等）。
            // 单次 tick 放独立任务执行：即使 panic 也只丢一轮，绝不杀死调度循环。
            let rt = app.state::<SharedRuntime>().inner().clone();
            let _st = app.state::<store::Store>().inner().clone();
            let a = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let h = tauri::async_runtime::spawn({
                        let a = a.clone(); let rt = rt.clone(); let st = store.clone();
                        async move { scheduler::tick(a, &rt, &st).await }
                    });
                    if let Err(e) = h.await {
                        eprintln!("[aqm] scheduler tick panicked: {e}");
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_providers,
            commands::get_snapshots,
            commands::refresh_now,
            commands::set_provider_enabled,
            commands::connect_with_credential,
            commands::clear_credential,
            commands::get_history,
            commands::get_quota_history,
            commands::get_settings,
            commands::set_settings,
            commands::open_external,
            commands::set_widget_size,
            commands::get_ontop,
            commands::toggle_ontop,
            commands::refresh_all,
            commands::open_settings,
            commands::open_settings_window,
            commands::start_window_drag,
            commands::codex_ensure_runtime,
            commands::codex_login_chatgpt,
            commands::codex_read_rate_limits,
            commands::codex_logout,
            commands::codex_login_status,
            commands::mimo_open_login,
            commands::mimo_read_usage,
            commands::mimo_store_usage,
            commands::mimo_close_login,
            commands::workbuddy_open_login,
            commands::workbuddy_read_usage,
            commands::workbuddy_store_usage,
            commands::workbuddy_close_login,
            commands::workbuddy_store_line,
            commands::close_tray_menu,
            commands::close_settings_window,
            commands::get_credential_status,
            commands::list_providers_enabled,
            commands::clear_provider_session,
            commands::quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running agent quota monitor");
}

fn position_top_right(win: &tauri::WebviewWindow) {
    use tauri::PhysicalPosition;
    if let Ok(Some(m)) = win.current_monitor() {
        let mw = m.size().width as i32;
        let ww = win.outer_size().map(|s| s.width).unwrap_or(300) as i32;
        // 主显示器右上角（物理像素，24px 边距近似）
        let _ = win.set_position(PhysicalPosition::new(mw - ww - 24, 24));
    }
}

fn dirs_data() -> std::path::PathBuf {
    std::env::var("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
}

pub(crate) fn percent_decode(s: &str) -> Option<String> {
    let s = s.split('#').next().unwrap_or(s);
    let mut out = Vec::with_capacity(s.len());
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = std::str::from_utf8(&b[i + 1..i + 3]).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}
