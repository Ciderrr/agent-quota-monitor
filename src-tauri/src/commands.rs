// IPC 命令面（PROVIDER_INTERFACE §4）。凭证值经此直通凭据管理器后即弃。
use crate::credentials;
use crate::deepseek;
use crate::scheduler::{SharedRuntime, PROVIDER_IDS};
use crate::store::Store;
use crate::types::*;
use crate::zcode;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

fn metas() -> Vec<ProviderMetaDto> {
    vec![
        ProviderMetaDto {
            id: "codex".into(), name_key: "provider.codex.name".into(), short_name: "Codex".into(),
            connection_methods: vec!["browser_login".into(), "api_key".into()],
            local_enhancements: vec!["existing_runtime".into(), "process_activity".into()],
            endpoint_stability: "public_api".into(),
            official_usage_url: "https://chatgpt.com/codex/settings/usage".into(),
        },
        ProviderMetaDto {
            id: "zcode".into(), name_key: "provider.zcode.name".into(), short_name: "ZCode".into(),
            connection_methods: vec!["api_key".into()],
            local_enhancements: vec!["process_activity".into()],
            endpoint_stability: "public_api".into(),
            official_usage_url: zcode::USAGE_URL_ZAI.into(),
        },
        ProviderMetaDto {
            id: "mimo".into(), name_key: "provider.mimo.name".into(), short_name: "MiMo Token Plan".into(),
            connection_methods: vec!["web_account_session".into()],
            local_enhancements: vec![],
            endpoint_stability: "undocumented_first_party".into(),
            official_usage_url: "https://platform.xiaomimimo.com/#/console/plan-manage".into(),
        },
        ProviderMetaDto {
            id: "workbuddy".into(), name_key: "provider.workbuddy.name".into(), short_name: "WorkBuddy".into(),
            connection_methods: vec!["web_account_session".into()],
            local_enhancements: vec![],
            endpoint_stability: "undocumented_first_party".into(),
            official_usage_url: "https://www.workbuddy.cn/profile/plans-usage".into(),
        },
        ProviderMetaDto {
            id: "deepseek".into(), name_key: "provider.deepseek.name".into(), short_name: "DeepSeek".into(),
            connection_methods: vec!["api_key".into()],
            local_enhancements: vec![],
            endpoint_stability: "public_api".into(),
            official_usage_url: deepseek::USAGE_URL.into(),
        },
    ]
}

#[tauri::command]
pub fn list_providers() -> Vec<ProviderMetaDto> {
    metas()
}

/// v0.2 洞察（燃烧预测 + 余额趋势 + 切换建议）：调度器每 tick 重算并经
/// insights-updated 广播；本命令供窗口启动时拉取初始值
#[tauri::command]
pub fn get_insights(rt: State<SharedRuntime>) -> crate::predict::Insights {
    rt.lock().unwrap().insights.clone()
}

#[tauri::command]
pub fn get_snapshots(rt: State<SharedRuntime>) -> Vec<Snapshot> {
    let r = rt.lock().unwrap();
    PROVIDER_IDS
        .iter()
        .filter(|id| r.enabled.get(**id).copied().unwrap_or(true))
        .filter_map(|id| r.snapshots.get(*id).cloned())
        .collect()
}

#[tauri::command]
pub async fn refresh_now(
    app: AppHandle,
    rt: State<'_, SharedRuntime>,
    store: State<'_, Store>,
    id: Option<String>,
) -> Result<(), String> {
    // 会话型 Provider（MiMo/WorkBuddy）：调度器 tick 只回缓存，必须走登录窗同源读取。
    // 读取在后台执行（15–45s），命令立即返回；成败都经 snapshot-updated 反馈到 UI
    // （成功→数据刷新；失败→快照标 auth_required → 详情出现横幅 + 一键重登按钮）。
    match id.as_deref() {
        Some("mimo") => {
            let a2 = app.clone();
            let r2 = rt.inner().clone();
            let s2 = store.inner().clone();
            tauri::async_runtime::spawn(async move {
                let _ = session_read_mimo(a2, r2, s2).await;
            });
            Ok(())
        }
        Some("workbuddy") => {
            let a2 = app.clone();
            let r2 = rt.inner().clone();
            let s2 = store.inner().clone();
            tauri::async_runtime::spawn(async move {
                let _ = session_read_workbuddy(a2, r2, s2).await;
            });
            Ok(())
        }
        _ => {
            // HTTP 型与显隐：置到期并跑 tick
            let due_now = chrono::Utc::now().timestamp_millis() - 1;
            let is_all = id.is_none();
            {
                let mut r = rt.lock().unwrap();
                match id {
                    Some(id) => r.next_due_ms.insert(id, due_now),
                    None => {
                        for p in PROVIDER_IDS { r.next_due_ms.insert(p.to_string(), due_now); }
                        Some(0)
                    }
                };
            }
            let rt2 = rt.inner().clone();
            let store2 = app.state::<Store>().inner().clone();
            let app2 = app.clone();
            tokio::spawn(async move { crate::scheduler::tick(app2, &rt2, &store2).await; });
            // 「全部刷新」时：会话型也各触发一次登录窗读取（窗口存在才读；异步不阻塞返回）
            if is_all {
                let a2 = app.clone();
                let r2 = rt.inner().clone();
                let s2 = store.inner().clone();
                tauri::async_runtime::spawn(async move {
                    if a2.get_webview_window("mimo-login").is_some() {
                        let _ = session_read_mimo(a2.clone(), r2.clone(), s2.clone()).await;
                    }
                    if a2.get_webview_window("wb-login").is_some() {
                        let _ = session_read_workbuddy(a2.clone(), r2.clone(), s2.clone()).await;
                    }
                });
            }
            Ok(())
        }
    }
}

#[tauri::command]
pub fn set_provider_enabled(app: AppHandle, rt: State<SharedRuntime>, id: String, enabled: bool) -> Result<(), String> {
    if !PROVIDER_IDS.contains(&id.as_str()) { return Err("unknown provider".into()); }
    rt.lock().unwrap().enabled.insert(id.clone(), enabled);
    let _ = app.emit("providers-changed", json!({ "id": id, "enabled": enabled }));
    Ok(())
}

/// 凭证经 IPC 直通凭据管理器后即弃；随即做一次连通性抓取。
/// ZCode 记忆区域族（key 族决定主机）。
#[tauri::command]
pub async fn connect_with_credential(
    app: AppHandle, rt: State<'_, SharedRuntime>, store: State<'_, Store>,
    id: String, secret: String, family: Option<String>,
) -> Result<serde_json::Value, String> {
    match id.as_str() {
        "deepseek" => {
            credentials::set_credential("deepseek/api-key", &secret)?;
        }
        "zcode" => {
            credentials::set_credential("zcode/coding-plan-key", &secret)?;
            if let Some(f) = family {
                rt.lock().unwrap().kv_family = Some(f.clone());
                store.kv_set("zcode/family", &f);
            }
        }
        _ => return Err(format!("provider {id} does not support credential connection in Gate D")),
    }
    let snap = crate::scheduler::fetch_provider(&id, &rt, &store).await;
    let ok = snap.error_state.is_none();
    if ok {
        // 换新账号：清掉旧历史，避免混入
        store.purge_provider_history(&id);
        rt.lock().unwrap().snapshots.insert(id.clone(), snap.clone());
        store.insert_snapshot(&id, &serde_json::to_string(&snap).unwrap_or_default());
        if id == "deepseek" {
            if let Some(b) = snap.balances.first() {
                let fmt = |v: Option<f64>| v.map(|x| format!("{x:.2}"));
                store.insert_balance_sample("deepseek", &b.currency, fmt(b.total), fmt(b.granted), fmt(b.topped_up), b.available_flag);
            }
        }
        let _ = app.emit("snapshot-updated", json!({ "providerId": id }));
    } else {
        // 测试失败：回滚，不留下错误 Key
        match id.as_str() {
            "deepseek" => { let _ = credentials::delete_credential("deepseek/api-key"); }
            "zcode" => { let _ = credentials::delete_credential("zcode/coding-plan-key"); }
            _ => {}
        }
        rt.lock().unwrap().snapshots.insert(id.clone(), crate::scheduler::not_connected_snapshot(&id));
    }
    Ok(json!({ "ok": ok, "message": snap.error_state.map(|e| e.code) }))
}

#[tauri::command]
pub fn clear_credential(app: AppHandle, rt: State<SharedRuntime>, store: State<Store>, id: String) -> Result<(), String> {
    match id.as_str() {
        "deepseek" => credentials::delete_credential("deepseek/api-key")?,
        "zcode" => credentials::delete_credential("zcode/coding-plan-key")?,
        _ => return Err("unknown provider".into()),
    }
    store.purge_provider_history(&id);
    rt.lock().unwrap().snapshots.insert(id.clone(), crate::scheduler::not_connected_snapshot(&id));
    let _ = app.emit("snapshot-updated", json!({ "providerId": id }));
    Ok(())
}

/// Provider 显隐开关（主界面是否展示）
#[tauri::command]
pub fn list_providers_enabled(rt: State<SharedRuntime>) -> serde_json::Value {
    let r = rt.lock().unwrap();
    let mut m = serde_json::Map::new();
    for p in PROVIDER_IDS {
        m.insert(p.to_string(), serde_json::json!(r.enabled.get(p).copied().unwrap_or(true)));
    }
    serde_json::Value::Object(m)
}

/// 是否已配置凭证（只返回布尔，绝不返回凭证值）
#[tauri::command]
pub fn get_credential_status() -> serde_json::Value {
    let ds = credentials::get_credential("deepseek/api-key").ok().flatten().is_some();
    let zc = credentials::get_credential("zcode/coding-plan-key").ok().flatten().is_some();
    serde_json::json!({ "deepseek": ds, "zcode": zc })
}

/// 清除会话型 Provider 的 WebView2 会话（②1：此前 MiMo 是 no-op、WorkBuddy 无入口）。
/// 清 Cookie 与站点存储后快照如实回到「需要登录」。注意：应用所有 WebView2 窗口共享
/// 同一 profile，清除会同时使 MiMo 与 WorkBuddy 的本地会话失效（设置页如实标注）。
#[tauri::command]
pub fn clear_provider_session(
    app: AppHandle,
    rt: State<SharedRuntime>,
    store: State<Store>,
    id: String,
) -> Result<(), String> {
    let label = match id.as_str() {
        "mimo" => "mimo-login",
        "workbuddy" => "wb-login",
        _ => return Err("unknown session provider".into()),
    };
    if let Some(w) = app.get_webview_window(label) {
        // 先移出官方站点，避免清除过程中的跨源请求；再清本应用全部 WebView2 浏览数据
        let _ = w.eval("location.href = 'about:blank'");
        let _ = w.clear_all_browsing_data();
    }
    let snap = match id.as_str() {
        "mimo" => crate::mimo::login_required(),
        _ => crate::workbuddy::login_required(),
    };
    rt.lock().unwrap().snapshots.insert(id.clone(), snap.clone());
    store.insert_snapshot(&id, &serde_json::to_string(&snap).unwrap_or_default());
    let _ = app.emit("snapshot-updated", json!({ "providerId": id }));
    Ok(())
}

#[tauri::command]
pub fn get_history(store: State<Store>) -> Vec<HistorySeries> {
    let points = store.balance_series("deepseek", 30);
    let today = points.last().map(|p| p.1).unwrap_or(0.0);
    vec![HistorySeries {
        provider_id: "deepseek".into(),
        kind: "money".into(),
        unit_label_key: "history.balance".into(),
        today,
        points: points.into_iter().map(|(day, value)| HistoryPoint { day, value }).collect(),
        extra: vec![],
    }]
}

/// 额度百分比历史（真实数据：来自 snapshots 表历次抓取存档）。
/// 每个桶一条序列；降采样 ≤40 点，首点末点保留。
#[tauri::command]
pub fn get_quota_history(store: State<Store>, provider_id: String, days: Option<i64>) -> Vec<HistorySeries> {
    let days = days.unwrap_or(7).clamp(1, 30);
    let mut out = vec![];
    for (_bucket_id, title, pts) in store.quota_series(&provider_id, days) {
        if pts.is_empty() { continue; }
        let n = pts.len();
        let step = (((n as f64) / 40.0).ceil().max(1.0)) as usize;
        let sampled: Vec<(i64, f64)> = pts.iter().enumerate()
            .filter(|(i, _)| *i % step == 0 || *i + 1 == n)
            .map(|(_, p)| *p)
            .collect();
        let points = sampled.into_iter().map(|(ts, value)| {
            let st = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_millis(ts as u64);
            let day = chrono::DateTime::<chrono::Local>::from(st).format("%m/%d %H:%M").to_string();
            HistoryPoint { day, value }
        }).collect();
        out.push(HistorySeries {
            provider_id: provider_id.clone(),
            kind: "quota_percent".into(),
            unit_label_key: "history.quota".into(),
            today: pts.last().map(|(_, v)| *v).unwrap_or(0.0),
            points,
            extra: vec![HistoryExtra { label_key: "history.bucket".into(), value: title }],
        });
    }
    out
}

#[tauri::command]
pub fn get_settings(rt: State<SharedRuntime>) -> serde_json::Value {
    let r = rt.lock().unwrap();
    json!({
        "defaultView": r.default_view,
        "notifyEnabled": r.notify_enabled,
        "refreshIntervalMs": r.refresh_interval_ms,
        "glassStrength": r.glass_strength,
        "lang": r.lang,
        "theme": r.theme,
        "thresholds": r.thresholds,
    })
}

#[tauri::command]
pub fn set_settings(
    app: AppHandle,
    rt: State<SharedRuntime>,
    store: State<Store>,
    default_view: Option<String>,
    notify_enabled: Option<bool>,
    warn: Option<i64>,
    crit: Option<i64>,
    balance: Option<f64>,
    refresh_interval_ms: Option<i64>,
    glass_strength: Option<f64>,
    lang: Option<String>,
    theme: Option<String>,
) -> Result<(), String> {
    let snapshot_json;
    {
        let mut r = rt.lock().unwrap();
        if let Some(v) = default_view {
            if v != "collapsed" && v != "overview" { return Err("bad defaultView".into()); }
            r.default_view = v;
        }
        if let Some(v) = notify_enabled { r.notify_enabled = v; }
        if let Some(v) = warn { r.thresholds.warn = v; }
        if let Some(v) = crit { r.thresholds.crit = v; }
        if let Some(v) = balance { r.thresholds.balance = v; }
        if let Some(v) = refresh_interval_ms {
            r.refresh_interval_ms = v;
        }
        if let Some(v) = glass_strength {
            r.glass_strength = v.clamp(0.3, 1.4);
        }
        // 语言/主题：跨窗口持久化项（所有 WebView 窗口经 settings-changed 同步）
        if let Some(v) = lang {
            if v != "zh" && v != "en" { return Err("bad lang".into()); }
            r.lang = v;
        }
        if let Some(v) = theme {
            if v != "auto" && v != "light" && v != "dark" { return Err("bad theme".into()); }
            r.theme = v;
        }
        snapshot_json = json!({
            "defaultView": r.default_view,
            "notifyEnabled": r.notify_enabled,
            "refreshIntervalMs": r.refresh_interval_ms,
            "glassStrength": r.glass_strength,
            "lang": r.lang,
            "theme": r.theme,
            "thresholds": {
                "warn": r.thresholds.warn,
                "crit": r.thresholds.crit,
                "balance": r.thresholds.balance,
            },
        });
    }
    store.kv_set("settings", &snapshot_json.to_string());
    let _ = app.emit("settings-changed", &snapshot_json);
    Ok(())
}

/// 托盘菜单：查询窗口置顶状态
#[tauri::command]
pub fn get_ontop(app: AppHandle) -> Result<bool, String> {
    let w = app.get_webview_window("widget").ok_or("no widget window")?;
    Ok(w.is_always_on_top().unwrap_or(false))
}

/// 托盘菜单：切换窗口置顶（不关闭菜单，由菜单窗口自行保持）
#[tauri::command]
pub fn toggle_ontop(app: AppHandle) -> Result<bool, String> {
    let w = app.get_webview_window("widget").ok_or("no widget window")?;
    let cur = w.is_always_on_top().unwrap_or(false);
    w.set_always_on_top(!cur).map_err(|e| e.to_string())?;
    Ok(!cur)
}

/// 托盘菜单：全部刷新
#[tauri::command]
pub fn refresh_all(app: AppHandle, rt: State<SharedRuntime>, store: State<Store>) {
    {
        let mut r = rt.lock().unwrap();
        for p in PROVIDER_IDS {
            r.next_due_ms.insert(p.to_string(), 0);
        }
    }
    let a = app.clone();
    let rt = rt.inner().clone();
    let store = store.inner().clone();
    tauri::async_runtime::spawn(async move {
        crate::scheduler::tick(a.clone(), &rt, &store).await;
        let _ = a.emit("snapshot-updated", serde_json::json!({"providerId": "all"}));
    });
}

/// 显示配置里预声明的设置窗；section 可选 general|providers|...
#[tauri::command]
pub fn open_settings_window(app: AppHandle, section: Option<String>) -> Result<(), String> {
    let Some(w) = app.get_webview_window("settings") else {
        return Err("settings window missing (do not close(), only hide)".into());
    };
    let _ = w.center();
    let _ = w.show();
    let _ = w.set_focus();
    // show() 会经 tao 重算窗口样式、冲掉 TOOLWINDOW 标记 → 显示后必须重打（Alt+Tab 卫生）
    crate::instance::exclude_aux_window(&app, "settings");
    if let Some(sec) = section {
        let _ = app.emit("settings-section", sec);
    }
    Ok(())
}

/// 托盘菜单：打开设置
#[tauri::command]
pub fn open_settings(app: AppHandle) {
    let _ = open_settings_window(app, Some("providers".into()));
}

/// 关闭设置窗：只 hide，绝不 close()——close 会销毁预声明窗口，之后再也打不开
#[tauri::command]
pub fn close_settings_window(app: AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.set_always_on_top(false);
        let _ = w.hide();
    }
}

/// 显示托盘菜单窗（预声明窗口，可保持打开）
#[tauri::command]
pub fn show_tray_menu_at(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    use tauri::PhysicalPosition;
    let w = app.get_webview_window("tray-menu").ok_or("no tray-menu window")?;
    // x,y 为物理像素
    let _ = w.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    let _ = w.show();
    let _ = w.set_focus();
    crate::instance::exclude_aux_window(&app, "tray-menu");
    Ok(())
}

/// 隐藏托盘菜单窗
#[tauri::command]
pub fn close_tray_menu(app: AppHandle) {
    if let Some(w) = app.get_webview_window("tray-menu") {
        let _ = w.hide();
    }
}

/// Codex：确保 managed runtime 就绪（官方 npm 下载 + sha512）
#[tauri::command]
pub async fn codex_ensure_runtime() -> Result<serde_json::Value, String> {
    crate::codex::ensure_managed_codex()
        .await
        .map(|p| json!({ "ok": true, "path": p.to_string_lossy() }))
        .map_err(|(c, d)| format!("{c}: {}", d.unwrap_or_default()))
}

/// Codex：启动官方 ChatGPT 登录（Managed Runtime / 本机 CLI）
#[tauri::command]
pub async fn codex_login_chatgpt(app: AppHandle) -> Result<serde_json::Value, String> {
    crate::codex::login_chatgpt()
        .await
        .map(|url| {
            // CLI 未自动弹浏览器时，用系统浏览器打开登录 URL
            if !url.is_empty() {
                let _ = open_external(app, url.clone());
            }
            json!({ "ok": true, "loginUrl": url })
        })
        .map_err(|(c, d)| format!("{c}: {}", d.unwrap_or_default()))
}

/// Codex：只读抓取一次 rate limits（测试/刷新用），并写入快照
#[tauri::command]
pub async fn codex_read_rate_limits(
    app: AppHandle,
    rt: State<'_, SharedRuntime>,
    store: State<'_, Store>,
) -> Result<serde_json::Value, String> {
    let snap = crate::codex::fetch_via_app_server().await;
    {
        let mut r = rt.lock().unwrap();
        r.snapshots.insert("codex".to_string(), snap.clone());
    }
    store.insert_snapshot("codex", &serde_json::to_string(&snap).unwrap_or_default());
    let _ = app.emit("snapshot-updated", json!({ "providerId": "codex" }));
    Ok(serde_json::to_value(&snap).unwrap_or_default())
}

/// Codex：断开本软件监控（不清用户 ~/.codex；条目保留，状态回未登录）
#[tauri::command]
pub async fn codex_logout(
    app: AppHandle,
    rt: State<'_, SharedRuntime>,
    store: State<'_, Store>,
) -> Result<serde_json::Value, String> {
    crate::codex::logout_chatgpt()
        .await
        .map(|_| {
            let snap = crate::scheduler::not_connected_snapshot("codex")
                .with_error("login_expired".into(), Some("monitor disconnected".into()));
            {
                let mut r = rt.lock().unwrap();
                r.snapshots.insert("codex".to_string(), snap.clone());
            }
            store.insert_snapshot("codex", &serde_json::to_string(&snap).unwrap_or_default());
            let _ = app.emit("snapshot-updated", json!({ "providerId": "codex" }));
            json!({ "ok": true, "scope": "monitor-only" })
        })
        .map_err(|(c, d)| format!("{c}: {}", d.unwrap_or_default()))
}

/// Codex：隔离会话登录状态（只读元数据，不读内容、不 spawn 进程）
#[tauri::command]
pub fn codex_login_status() -> serde_json::Value {
    crate::codex::login_status()
}

/// MiMo：显示预声明登录窗（动态建窗在本机会白屏；配置窗可用）
#[tauri::command]
pub fn mimo_open_login(app: AppHandle) -> Result<(), String> {
    let w = app.get_webview_window("mimo-login").ok_or("no mimo-login window")?;
    let _ = w.show();
    let _ = w.set_focus();
    crate::instance::exclude_aux_window(&app, "mimo-login");
    // 注入只读 helper（登录页同源 fetch；不注入 IPC）
    let _ = w.eval(
        r#"
        window.__aqm_mimo_read = async function() {
          const [u, d] = await Promise.all([
            fetch('/api/v1/tokenPlan/usage', { credentials: 'include' }).then(r => r.json()),
            fetch('/api/v1/tokenPlan/detail', { credentials: 'include' }).then(r => r.json()),
          ]);
          const payload = { usage: u, detail: d };
          const body = JSON.stringify(payload);
          // 1) 自定义协议回传（不依赖远程 IPC）
          try {
            await fetch('aqm://store', { method: 'POST', body, mode: 'no-cors' });
          } catch (e1) {
            // 2) IPC 兜底
            try {
              if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
                await window.__TAURI_INTERNALS__.invoke('mimo_store_usage', { payload });
              }
            } catch (e2) {}
            // 3) 导航回传
            try {
              location.href = 'aqm://store?d=' + encodeURIComponent(body);
            } catch (e3) {}
          }
          return payload;
        };
        "#,
    );
    Ok(())
}

/// MiMo：登录窗把 usage/detail 交给 core（只存数值快照，不落 Cookie）
#[tauri::command]
pub fn mimo_store_usage(
    app: AppHandle,
    rt: State<SharedRuntime>,
    store: State<Store>,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let snap = store_mimo_payload(&app, &rt, &store, &payload);
    Ok(serde_json::to_value(&snap).unwrap_or_default())
}

/// 关闭 MiMo 登录窗（隐藏即可，配置窗可复用）
#[tauri::command]
pub fn mimo_close_login(app: AppHandle) {
    if let Some(w) = app.get_webview_window("mimo-login") {
        let _ = w.hide();
    }
}

/// 会话读取失败 → 如实把快照标为「需要登录」并持久化（仅当当前是 connected/degraded，
/// 避免覆盖首连流程）；否则重启后又会恢复成误导性的「已连接」旧快照。
fn mark_session_auth_required(app: &AppHandle, rt: &SharedRuntime, store: &Store, id: &str, detail: &str) {
    let snap = {
        let mut r = rt.lock().unwrap();
        match r.snapshots.get_mut(id) {
            Some(s) if s.connection_state == "connected" || s.connection_state == "degraded" => {
                s.connection_state = "auth_required".into();
                s.error_state = Some(ErrorState {
                    code: "login_expired".into(),
                    detail: Some(detail.to_string()),
                    occurred_at: crate::types::now_iso(),
                });
                Some(s.clone())
            }
            _ => None,
        }
    };
    if let Some(s) = snap {
        store.insert_snapshot(id, &serde_json::to_string(&s).unwrap_or_default());
        let _ = app.emit("snapshot-updated", json!({ "providerId": id }));
    }
}

/// 会话读取防重入 + 记账：刷新连点 / ConnectFlow 轮询 / 后台验证共用一把进程内标志。
/// 拿不到锁直接返回 busy（调用方继续等下一轮即可），绝不开第二个并行读取循环。
fn try_begin_session_read(rt: &SharedRuntime, id: &str) -> bool {
    let mut r = rt.lock().unwrap();
    if r.read_in_progress.get(id).copied().unwrap_or(false) {
        return false;
    }
    r.read_in_progress.insert(id.to_string(), true);
    r.last_session_read_ms.insert(id.to_string(), chrono::Utc::now().timestamp_millis());
    true
}

fn end_session_read(rt: &SharedRuntime, id: &str) {
    rt.lock().unwrap().read_in_progress.insert(id.to_string(), false);
}

/// MiMo：会话读取核心逻辑（命令包装与「全部刷新」共用）
pub async fn session_read_mimo(app: AppHandle, rt: SharedRuntime, store: Store) -> Result<serde_json::Value, String> {
    if !try_begin_session_read(&rt, crate::mimo::ID) {
        return Err("read in progress".into());
    }
    let res = session_read_mimo_inner(app, rt.clone(), store).await;
    end_session_read(&rt, crate::mimo::ID);
    res
}

async fn session_read_mimo_inner(app: AppHandle, rt: SharedRuntime, store: Store) -> Result<serde_json::Value, String> {
    let w = app
        .get_webview_window("mimo-login")
        .ok_or("mimo-login window not open")?;
    // 窗口可见 = 用户可能正在登录：绝不导航打断，读取失败也绝不标「登录已失效」
    let visible = w.is_visible().unwrap_or(false);
    // 隐藏窗可能停在 aqm:// 响应页（上次回传的落地页）→ 同源 fetch 会失败。
    // 仅当窗口隐藏时才导航回 Console；helper 在 console 域任意页面均可同源 fetch。
    if !visible {
        let on_site = w
            .url()
            .map(|u| u.host_str() == Some(crate::mimo::HOST))
            .unwrap_or(false);
        if !on_site {
            let _ = w.eval(&format!("location.href = '{}';", crate::mimo::USAGE_URL));
            tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
        }
    }
    let js = r#"(async () => {
      try {
        const [u, d] = await Promise.all([
          fetch('/api/v1/tokenPlan/usage', { credentials: 'include' }).then(r => r.json()),
          fetch('/api/v1/tokenPlan/detail', { credentials: 'include' }).then(r => r.json()),
        ]);
        const payload = { usage: u, detail: d };
        const body = JSON.stringify(payload);
        document.title = 'AQMOK';
        try {
          const t = (window.__TAURI__ && window.__TAURI__.invoke) || (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke);
          if (t) { await t('mimo_store_usage', { payload }); }
        } catch (e) {}
        try {
          if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.emit) {
            await window.__TAURI__.event.emit('mimo-payload', payload);
          }
        } catch (e) {}
        try {
          await fetch('aqm://store', { method: 'POST', body, mode: 'no-cors' });
        } catch (e) {}
        try {
          await fetch('http://aqm.localhost/store', { method: 'POST', body, mode: 'no-cors' });
        } catch (e) {}
        try {
          location.href = 'aqm://store?d=' + encodeURIComponent(body);
        } catch (e) {}
        return 'ok';
      } catch (e) {
        document.title = 'AQMERR:' + String(e).slice(0, 80);
        return 'fetch_err';
      }
    })();"#;
    let _ = w.eval(js).map_err(|e| e.to_string())?;

    // 等 mimo_store_usage / 协议回传 / 事件——刷新语义 = 强制真读：
    // 以 fetched_at 变化判定新数据到达（旧快照本就是 connected，不能当作新读成功）
    let old_fetched = {
        let r = rt.lock().unwrap();
        r.snapshots.get(crate::mimo::ID).map(|s| s.fetched_at.clone())
    };
    // IIFE 每 2s 重发（页面加载时序不可控）；AQMERR 出现即刻早退反馈，不再傻等 45s（④）
    let mut last_err = String::new();
    for i in 0..90 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if i % 4 == 1 {
            let _ = w.eval(js);
        }
        let snap = {
            let r = rt.lock().unwrap();
            r.snapshots.get(crate::mimo::ID).cloned()
        };
        if let Some(s) = snap {
            if s.connection_state == "connected" && Some(&s.fetched_at) != old_fetched.as_ref() {
                return Ok(serde_json::to_value(&s).unwrap_or_default());
            }
        }
        let title = w.title().unwrap_or_default();
        if title.starts_with("AQMERR") {
            last_err = title;
            break;
        }
    }
    if !last_err.is_empty() {
        if !visible {
            mark_session_auth_required(&app, &rt, &store, crate::mimo::ID, "MiMo 登录会话已失效，请重新登录");
        }
        return Err(last_err);
    }
    if !visible {
        mark_session_auth_required(&app, &rt, &store, crate::mimo::ID, "MiMo 读取超时，请确认已登录后重试");
    }
    Err("timeout waiting usage".into())
}

/// MiMo：IPC 命令包装
#[tauri::command]
pub async fn mimo_read_usage(
    app: AppHandle,
    rt: State<'_, SharedRuntime>,
    store: State<'_, Store>,
) -> Result<serde_json::Value, String> {
    session_read_mimo(app, rt.inner().clone(), store.inner().clone()).await
}

pub(crate) fn store_mimo_payload(
    app: &AppHandle,
    rt: &SharedRuntime,
    store: &Store,
    payload: &serde_json::Value,
) -> crate::types::Snapshot {
    let usage = payload.get("usage").cloned().unwrap_or(serde_json::Value::Null);
    let detail = payload.get("detail").cloned().unwrap_or(serde_json::Value::Null);
    // 防线：会话失效时官方接口可能返回 200 + 错误体（无 data.monthUsage）。
    // 绝不让空数据伪造成「剩余 100%」覆盖真实快照；窗口隐藏才如实标记（可见 = 登录中）。
    if usage.pointer("/data/monthUsage").is_none() {
        let visible = app
            .get_webview_window("mimo-login")
            .map(|w| w.is_visible().unwrap_or(false))
            .unwrap_or(false);
        if visible {
            let cur = rt.lock().unwrap().snapshots.get(crate::mimo::ID).cloned();
            return cur.unwrap_or_else(|| crate::mimo::login_required());
        }
        {
            let mut r = rt.lock().unwrap();
            match r.snapshots.get_mut(crate::mimo::ID) {
                Some(s) if s.connection_state == "connected" || s.connection_state == "degraded" => {
                    s.connection_state = "auth_required".into();
                    s.error_state = Some(ErrorState {
                        code: "login_expired".into(),
                        detail: Some("MiMo 返回无月度用量（会话可能已失效）".into()),
                        occurred_at: crate::types::now_iso(),
                    });
                }
                _ => {}
            }
        }
        let snap = rt.lock().unwrap().snapshots.get(crate::mimo::ID).cloned();
        let snap = snap.unwrap_or_else(|| crate::mimo::login_required());
        store.insert_snapshot(crate::mimo::ID, &serde_json::to_string(&snap).unwrap_or_default());
        let _ = app.emit("snapshot-updated", json!({ "providerId": "mimo" }));
        return snap;
    }
    let snap = crate::mimo::map_usage_detail(&usage, &detail);
    {
        let mut r = rt.lock().unwrap();
        r.snapshots.insert(crate::mimo::ID.to_string(), snap.clone());
    }
    store.insert_snapshot(crate::mimo::ID, &serde_json::to_string(&snap).unwrap_or_default());
    let _ = app.emit("snapshot-updated", json!({ "providerId": "mimo" }));
    snap
}

// ===== WorkBuddy（ADR-006）：预声明 wb-login 窗 + 同源读取 =====
// 回传通道：location.href = aqm://wb?d=短行（该站 CSP 拦一切跨源 fetch，顶层导航拦不住）。

const WB_PLANS_URL: &str = "https://www.workbuddy.cn/profile/plans-usage";

const WB_HELPER_JS: &str = r#"
window.__aqm_wb_read = async function() {
  const get = async (p) => {
    const h = { 'Content-Type': 'application/json' };
    let r = await fetch(p, { credentials: 'include', headers: h });
    let text = await r.text();
    // 网关按方法路由（billing 系为 POST）：GET 404/405 时自动降级 POST
    if (r.status === 404 || r.status === 405) {
      r = await fetch(p, { method: 'POST', credentials: 'include', headers: h, body: '{}' });
      text = await r.text();
    }
    try { return JSON.parse(text.replace(/^\uFEFF/, '')); }
    catch (e) { return { __bad: p, __status: r.status, __head: text.slice(0, 80) }; }
  };
  const [summary, paid, free] = await Promise.all([
    get('/billing/meter/get-user-resource-summary'),
    get('/billing/meter/get-user-resource-paid-packages'),
    get('/billing/meter/get-user-resource-free-packages'),
  ]);
  const bad = [summary, paid, free].find(x => x && x.__bad);
  if (bad || !summary.data || !summary.data.Packages) {
    location.hash = 'aqmerr=' + encodeURIComponent(JSON.stringify(bad || { s: 'no packages' }).slice(0, 110));
    return null;
  }
  const pkgs = ((summary.data && summary.data.Packages) || []).map(p => ({
    CycleTotalCapacity: p.CycleTotalCapacity,
    CycleRemainCapacity: p.CycleRemainCapacity,
    CycleUsedCapacity: p.CycleUsedCapacity,
  }));
  const plan = (summary.data.SubscriptionPackageName || '-');
  // 回传通道（最终方案）：location.hash —— 同文档变更不发请求，
  // 页面 CSP/监控 SDK/WebView2 均无法干扰；Rust 轮询 webview.url() 解析 fragment。
  const parts = [plan].concat(pkgs.map(p => [p.CycleTotalCapacity, p.CycleRemainCapacity, p.CycleUsedCapacity].join(';')));
  location.hash = 'aqmwb=' + encodeURIComponent(parts.join('|'));
  return parts.join('|');
};
"#;

/// WorkBuddy：显示预声明登录窗，导航到积分页并注入同源读取 helper（不注入任何凭证逻辑）
#[tauri::command]
pub fn workbuddy_open_login(app: AppHandle) -> Result<(), String> {
    let w = app
        .get_webview_window("wb-login")
        .ok_or("no wb-login window")?;
    let _ = w.show();
    let _ = w.set_focus();
    crate::instance::exclude_aux_window(&app, "wb-login");
    // 上一次读取会把窗口导航到 aqm://wb 响应页 → 先导航回积分页，等加载完成再注入 helper
    let _ = w.eval(&format!("location.href = '{}';", WB_PLANS_URL));
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(2500)).await;
        if let Some(w) = app2.get_webview_window("wb-login") {
            let _ = w.eval(WB_HELPER_JS);
        }
    });
    Ok(())
}

/// WorkBuddy：IPC 兜底回传（仅当远程 IPC 被授权时可用；行格式同 aqm://wb）
#[tauri::command]
pub fn workbuddy_store_line(
    app: AppHandle,
    rt: State<SharedRuntime>,
    store: State<Store>,
    line: String,
) -> Result<serde_json::Value, String> {
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
    if pkgs.is_empty() {
        return Err("bad line".into());
    }
    let snap = crate::workbuddy::map_title(&plan, &pkgs);
    {
        let mut r = rt.lock().unwrap();
        r.snapshots.insert(crate::workbuddy::ID.to_string(), snap.clone());
    }
    store.insert_snapshot(crate::workbuddy::ID, &serde_json::to_string(&snap).unwrap_or_default());
    let _ = app.emit("snapshot-updated", json!({ "providerId": "workbuddy" }));
    Ok(serde_json::to_value(&snap).unwrap_or_default())
}

/// WorkBuddy：会话读取核心逻辑（命令包装与「全部刷新」共用）。
/// 刷新语义 = 强制真读：以 fetched_at 变化判定新数据，绝无「已连接就回缓存」的快路径。
pub async fn session_read_workbuddy(
    app: AppHandle,
    rt: SharedRuntime,
    store: Store,
) -> Result<serde_json::Value, String> {
    if !try_begin_session_read(&rt, crate::workbuddy::ID) {
        return Err("read in progress".into());
    }
    let res = session_read_workbuddy_inner(app, rt.clone(), store).await;
    end_session_read(&rt, crate::workbuddy::ID);
    res
}

async fn session_read_workbuddy_inner(
    app: AppHandle,
    rt: SharedRuntime,
    store: Store,
) -> Result<serde_json::Value, String> {
    let w = app
        .get_webview_window("wb-login")
        .ok_or("wb-login window not open")?;
    // ②2 修复（用户实测：登录被无限刷新打断）：窗口可见 = 用户正在登录，
    // **绝不导航**——helper 在 workbuddy.cn 任意页面都能同源 fetch billing 接口；
    // 且读取失败也绝不标「登录已失效」（登录中的失败是正常过程）。
    // 仅隐藏窗（后台读取/手动刷新）才先导航回积分页，摆脱 aqm 响应页残留。
    let visible = w.is_visible().unwrap_or(false);
    if !visible {
        let _ = w.eval(&format!("location.href = '{}';", WB_PLANS_URL));
    }
    let old_fetched = {
        let r = rt.lock().unwrap();
        r.snapshots.get(crate::workbuddy::ID).map(|s| s.fetched_at.clone())
    };
    for i in 0..60 {
        if i >= 2 && i % 4 == 2 {
            // 页面加载后注入 helper 并触发（__aqm_wb_busy 防重入）
            let js = format!(
                "{}\n(function(){{ if (!window.__aqm_wb_busy) {{ window.__aqm_wb_busy = true; window.__aqm_wb_read().finally(function() {{ window.__aqm_wb_busy = false; }}); }} }})();",
                WB_HELPER_JS
            );
            let _ = w.eval(&js);
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let snap = {
            let r = rt.lock().unwrap();
            r.snapshots.get(crate::workbuddy::ID).cloned()
        };
        if let Some(s) = snap {
            if s.connection_state == "connected" && Some(&s.fetched_at) != old_fetched.as_ref() {
                let _ = w.eval("location.hash = '';"); // 清残留，防下次误读
                return Ok(serde_json::to_value(&s).unwrap_or_default());
            }
        }
        // hash 通道：webview.url() 的 fragment 携带数据
        if let Ok(u) = w.url() {
            if let Some(frag) = u.fragment() {
                if let Some(rest) = frag.strip_prefix("aqmwb=") {
                    if let Some(line) = crate::percent_decode(rest) {
                        if let Some(snap) = parse_wb_line(&line) {
                            {
                                let mut r = rt.lock().unwrap();
                                r.snapshots.insert(crate::workbuddy::ID.to_string(), snap.clone());
                            }
                            store.insert_snapshot(crate::workbuddy::ID, &serde_json::to_string(&snap).unwrap_or_default());
                            let _ = app.emit("snapshot-updated", json!({ "providerId": "workbuddy" }));
                            let _ = w.eval("location.hash = '';"); // 用后即清，防下次误读旧值
                            return Ok(serde_json::to_value(&snap).unwrap_or_default());
                        }
                    }
                } else if let Some(rest) = frag.strip_prefix("aqmerr=") {
                    if let Some(msg) = crate::percent_decode(rest) {
                        let _ = w.eval("location.hash = '';");
                        // 可见 = 登录中：失败是正常过程，不打扰、不标记（②2）
                        if !visible {
                            mark_session_auth_required(&app, &rt, &store, crate::workbuddy::ID, "WorkBuddy 登录会话已失效，请重新登录");
                        }
                        return Err(format!("wb read: {msg}"));
                    }
                }
            }
        }
    }
    if !visible {
        mark_session_auth_required(&app, &rt, &store, crate::workbuddy::ID, "WorkBuddy 读取超时，请确认已登录后重试");
    }
    Err("timeout waiting usage".into())
}

/// WorkBuddy：IPC 命令包装
#[tauri::command]
pub async fn workbuddy_read_usage(
    app: AppHandle,
    rt: State<'_, SharedRuntime>,
    store: State<'_, Store>,
) -> Result<serde_json::Value, String> {
    session_read_workbuddy(app, rt.inner().clone(), store.inner().clone()).await
}

/// 解析 title/hash 通道的短行：套餐名|总量;剩余;已用|...
fn parse_wb_line(line: &str) -> Option<crate::types::Snapshot> {
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
    if pkgs.is_empty() {
        None
    } else {
        Some(crate::workbuddy::map_title(&plan, &pkgs))
    }
}

/// WorkBuddy：登录窗把三个接口的 JSON 交给 core（只存数值快照，不落 Cookie）
#[tauri::command]
pub fn workbuddy_store_usage(
    app: AppHandle,
    rt: State<SharedRuntime>,
    store: State<Store>,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let snap = store_workbuddy_payload(&app, &rt, &store, &payload);
    Ok(serde_json::to_value(&snap).unwrap_or_default())
}

/// 关闭 WorkBuddy 登录窗（隐藏即可，配置窗可复用）
#[tauri::command]
pub fn workbuddy_close_login(app: AppHandle) {
    if let Some(w) = app.get_webview_window("wb-login") {
        let _ = w.hide();
    }
}

pub(crate) fn store_workbuddy_payload(
    app: &AppHandle,
    rt: &SharedRuntime,
    store: &Store,
    payload: &serde_json::Value,
) -> crate::types::Snapshot {
    let summary = payload.get("summary").cloned().unwrap_or(serde_json::Value::Null);
    let paid = payload.get("paid").cloned().unwrap_or(serde_json::Value::Null);
    let free = payload.get("free").cloned().unwrap_or(serde_json::Value::Null);
    let mut accounts: Vec<serde_json::Value> = Vec::new();
    for part in [&paid, &free] {
        if let Some(list) = part.pointer("/data/Accounts").and_then(|v| v.as_array()) {
            accounts.extend(list.iter().cloned());
        }
    }
    let accounts_val = serde_json::Value::Array(accounts);
    let snap = crate::workbuddy::map_summary(&summary, &accounts_val);
    {
        let mut r = rt.lock().unwrap();
        r.snapshots.insert(crate::workbuddy::ID.to_string(), snap.clone());
    }
    store.insert_snapshot(crate::workbuddy::ID, &serde_json::to_string(&snap).unwrap_or_default());
    let _ = app.emit("snapshot-updated", json!({ "providerId": "workbuddy" }));
    snap
}

/// 托盘菜单：退出应用。
/// 优雅退出（v0.2.1）：先逐个销毁窗口（向 shell 发出正常的窗口销毁通知），再退出进程。
/// 直接 ExitProcess 的强拆会让 Windows 11 的 Alt+Tab 切换器缓存残留「幽灵条目」
/// （用户实测：退出后条目仍在、空白缩略图、无法激活）。
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    for label in ["settings", "tray-menu", "mimo-login", "wb-login", "widget"] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.destroy();
        }
    }
    app.exit(0);
}

/// 打开官方用量页：仅允许 Provider 元数据里的白名单域名（UI 传入值会被校验拒绝）
#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let allowed_suffixes = [
        "chatgpt.com", "platform.deepseek.com", "api.deepseek.com",
        "console.z.ai", "open.bigmodel.cn", "api.z.ai", "platform.xiaomimimo.com",
        "www.workbuddy.cn", "github.com",
    ];
    let u = url::Url::parse(&url).map_err(|_| "bad url".to_string())?;
    if u.scheme() != "https" {
        return Err("non-https refused".into());
    }
    let host = u.host_str().unwrap_or("");
    if !allowed_suffixes.iter().any(|s| host.eq_ignore_ascii_case(s)) {
        return Err(format!("host not allowed: {host}"));
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// 显式开始拖动**调用方**窗口（浮窗/设置/托盘共用）
#[tauri::command]
pub fn start_window_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

/// 视图层级变化时调整浮窗尺寸（逻辑像素）。
/// 改尺寸时保持**右边缘**不动（浮窗右上角锚定，避免整窗向右漂移）。
#[tauri::command]
pub fn set_widget_size(window: tauri::WebviewWindow, w: f64, h: f64) -> Result<(), String> {
    use tauri::{LogicalSize, PhysicalPosition};
    let scale = window.scale_factor().unwrap_or(1.0);
    let old_w = window.outer_size().map(|s| s.width as f64).unwrap_or(0.0);
    let old_pos = window.outer_position().ok();
    window
        .set_size(LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    if let (Some(pos), true) = (old_pos, old_w > 0.0) {
        let new_w_phys = w * scale;
        let new_x = pos.x + (old_w - new_w_phys).round() as i32;
        let _ = window.set_position(PhysicalPosition::new(new_x, pos.y));
    }
    Ok(())
}
