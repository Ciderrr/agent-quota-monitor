// 调度器（REFRESH_STRATEGY）：事件驱动 tick 循环 + 每 Provider 独立退避。
// 基线不依赖本地 Agent；失败退避 30s→1m→2m→5m→10m（封顶），成功清零。
use crate::deepseek;
use crate::types::*;
use crate::zcode;
use serde_json::json;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

pub const PROVIDER_IDS: [&str; 5] = ["codex", "zcode", "mimo", "deepseek", "workbuddy"];

pub struct Runtime {
    pub snapshots: HashMap<String, Snapshot>,
    pub enabled: HashMap<String, bool>,
    pub next_due_ms: HashMap<String, i64>,
    pub fail_count: HashMap<String, u32>,
    pub default_view: String,
    pub thresholds: Thresholds,
    pub notify_enabled: bool,
    /// 智能刷新基准间隔（ms）；0 = smart（默认 5min）
    pub refresh_interval_ms: i64,
    /// 玻璃不透明度 0.3–1.0
    pub glass_strength: f64,
    /// ZCode 区域族（zai | bigmodel），由连接时记忆
    pub kv_family: Option<String>,
    /// 每 Provider 最近一次完成抓取的时间（ms）；活动边沿补刷的 30s 判据
    pub last_fetch_ms: HashMap<String, i64>,
    /// 会话型 Provider 最近一次真实会话读取（ms）；后台验证 30min 判据
    pub last_session_read_ms: HashMap<String, i64>,
    /// 会话读取进行中标志（防重入：刷新连点 / ConnectFlow 轮询 / 后台验证互相排队）
    pub read_in_progress: HashMap<String, bool>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Thresholds {
    pub warn: i64,
    pub crit: i64,
    pub balance: f64,
}

impl Default for Thresholds {
    fn default() -> Self {
        Self { warn: 20, crit: 10, balance: 30.0 }
    }
}

pub type SharedRuntime = std::sync::Arc<Mutex<Runtime>>;

fn default_interval_ms(id: &str) -> i64 {
    match id {
        "deepseek" | "zcode" => 300_000,
        _ => 300_000,
    }
}

pub fn not_connected_snapshot(id: &str) -> Snapshot {
    let (url, stab) = match id {
        "codex" => ("https://chatgpt.com/codex/settings/usage", "public_api"),
        "zcode" => (zcode::USAGE_URL_ZAI, "public_api"),
        "mimo" => ("https://platform.xiaomimimo.com/#/console/plan-manage", "undocumented_first_party"),
        "workbuddy" => ("https://www.workbuddy.cn/profile/plans-usage", "undocumented_first_party"),
        _ => ("https://platform.deepseek.com/usage", "public_api"),
    };
    Snapshot::not_configured(id, url, stab)
}

pub async fn tick(app: tauri::AppHandle, rt: &SharedRuntime, store: &crate::store::Store) {
    // 活动检测（Local Enhancement，仅 Smart 模式加速刷新；探测失败按 Idle）
    let activity: HashMap<String, (bool, bool)> = PROVIDER_IDS
        .iter()
        .map(|id| (id.to_string(), crate::activity::poll(id)))
        .collect();
    let mut force_due: Vec<String> = Vec::new();
    {
        let r = rt.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        for id in PROVIDER_IDS {
            let (is_active, edge) = activity[id];
            let last = r.last_fetch_ms.get(id).copied().unwrap_or(0);
            // Idle→Active 边沿：距上次刷新 >30s 则补一次（REFRESH_STRATEGY §2）
            if edge && is_active && now - last > 30_000 {
                force_due.push(id.to_string());
            }
        }
    }
    let due: Vec<String> = {
        let r = rt.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        PROVIDER_IDS
            .iter()
            .filter(|id| r.enabled.get(**id).copied().unwrap_or(true))
            .filter(|id| {
                r.next_due_ms.get(**id).copied().unwrap_or(0) <= now || force_due.contains(&id.to_string())
            })
            .map(|id| id.to_string())
            .collect()
    };

    for id in due {
        let snapshot = fetch_provider(&id, rt, store).await;
        let is_err = snapshot.error_state.is_some();
        let connected = snapshot.connection_state == "connected";

        // 退避 / 下次到期
        {
            let mut r = rt.lock().unwrap();
            let fails = if is_err { r.fail_count.get(&id).copied().unwrap_or(0) + 1 } else { 0 };
            r.fail_count.insert(id.clone(), fails);
            let backoff = [30_000i64, 60_000, 120_000, 300_000, 600_000]
                .get(fails.saturating_sub(1) as usize)
                .copied()
                .unwrap_or(600_000);
            let interval = if is_err {
                backoff
            } else if r.refresh_interval_ms > 0 {
                // 用户固定档：保持固定（比规范更保守——固定档不做活动加速）
                r.refresh_interval_ms
            } else {
                // Smart：codex/zcode 活跃时加速到 45s；DeepSeek/MiMo 不加速
                let is_active = activity.get(&id).copied().unwrap_or((false, false)).0;
                let accelerated = matches!(id.as_str(), "codex" | "zcode") && is_active;
                if accelerated { 45_000 } else { default_interval_ms(&id) }
            };
            let now_ms = chrono::Utc::now().timestamp_millis();
            r.last_fetch_ms.insert(id.clone(), now_ms);
            let jitter = rand_jitter();
            r.next_due_ms.insert(id.clone(), now_ms + interval + jitter);
            r.snapshots.insert(id.clone(), snapshot.clone());
        }

        // 持久化：余额样本（DeepSeek Balance history）
        if connected && id == deepseek::ID {
            if let Some(b) = snapshot.balances.first() {
                let fmt = |v: Option<f64>| v.map(|x| format!("{x:.2}"));
                store.insert_balance_sample(
                    &id, &b.currency,
                    fmt(b.total), fmt(b.granted), fmt(b.topped_up), b.available_flag,
                );
            }
        }
        store.insert_snapshot(&id, &serde_json::to_string(&snapshot).unwrap_or_default());

        // 通知（余额阈值；notification_state 去重）
        if connected && id == deepseek::ID {
            maybe_notify_balance(app.clone(), rt, store, &snapshot);
        }

        let _ = app.emit("snapshot-updated", json!({ "providerId": id }));
        eprintln!(
            "[aqm] tick {id}: {} {}",
            snapshot.connection_state,
            snapshot.error_state.as_ref().map(|e| e.code.clone()).unwrap_or_default(),
        );
    }

    // 会话型 Provider 后台验证（②0/④）：每 30 分钟对**隐藏的**登录窗做一次真实会话读取，
    // 会话失效 → 立即标 auth_required 并广播，用户无需手动刷新才发现。
    // 窗口可见（用户正在登录）时绝不触发，杜绝打断登录流程（②2）。
    // last_session_read_ms 由 session_read 本体在开始时记账（含手动/ConnectFlow 触发）。
    for id in ["mimo", "workbuddy"] {
        {
            let r = rt.lock().unwrap();
            if !r.enabled.get(id).copied().unwrap_or(true) { continue; }
            if r.read_in_progress.get(id).copied().unwrap_or(false) { continue; }
            let last = r.last_session_read_ms.get(id).copied().unwrap_or(0);
            if chrono::Utc::now().timestamp_millis() - last < 30 * 60 * 1000 { continue; }
        }
        let label = if id == "mimo" { "mimo-login" } else { "wb-login" };
        let win_hidden = app
            .get_webview_window(label)
            .map(|w| !w.is_visible().unwrap_or(true))
            .unwrap_or(false);
        if !win_hidden { continue; }
        let a2 = app.clone();
        let r2 = rt.clone();
        let s2 = store.clone();
        let id2 = id.to_string();
        tauri::async_runtime::spawn(async move {
            let res = if id2 == "mimo" {
                crate::commands::session_read_mimo(a2.clone(), r2.clone(), s2.clone()).await
            } else {
                crate::commands::session_read_workbuddy(a2.clone(), r2.clone(), s2.clone()).await
            };
            if let Err(e) = res {
                eprintln!("[aqm] session verify {id2}: {e}");
            }
        });
    }
}

/// 会话型快照的年龄标记：会话数据没有主动外呼，快照超过 30 分钟即标 stale，
/// UI 显示「数据可能过期」，不再让旧积分看起来像实时数据（用户实测反馈 ②0）。
fn with_age_stale(mut s: Snapshot) -> Snapshot {
    if let Ok(t) = chrono::DateTime::parse_from_rfc3339(&s.fetched_at) {
        let age_ms = chrono::Utc::now().timestamp_millis() - t.timestamp_millis();
        if age_ms > 30 * 60 * 1000 {
            s.stale = true;
        }
    }
    s
}

/// 会话型 Provider（MiMo/WorkBuddy）的取数：优先内存快照，其次 SQLite 最近成功快照，否则回登录态。
/// 会话数据只能由预声明登录窗同源读取，调度器 tick 不主动外呼。
pub fn session_cached_snapshot(
    id: &str,
    rt: &SharedRuntime,
    store: &crate::store::Store,
    login_required: Snapshot,
) -> Snapshot {
    let existing = rt.lock().unwrap().snapshots.get(id).cloned();
    if let Some(s) = existing {
        if s.connection_state == "connected" || s.connection_state == "degraded" {
            return with_age_stale(s);
        }
    }
    let stored = store
        .load_latest_snapshots()
        .into_iter()
        .find(|(pid, _)| pid == id)
        .and_then(|(_, json)| serde_json::from_str::<Snapshot>(&json).ok());
    match stored {
        Some(s) if s.connection_state == "connected" || s.connection_state == "degraded" => with_age_stale(s),
        _ => login_required,
    }
}

pub async fn fetch_provider(id: &str, rt: &SharedRuntime, store: &crate::store::Store) -> Snapshot {
    match id {
        deepseek::ID => {
            let key = crate::credentials::get_credential("deepseek/api-key");
            match key {
                Ok(Some(k)) => deepseek::fetch(&k).await,
                Ok(None) => not_connected_snapshot(id),
                Err(_) => not_connected_snapshot(id).with_error("unknown".into(), Some("credential store error".into())),
            }
        }
        zcode::ID => {
            let cred = crate::credentials::get_credential("zcode/coding-plan-key");
            let family = {
                let r = rt.lock().unwrap();
                r.kv_family.clone().unwrap_or_else(|| "zai".into())
            };
            match cred {
                Ok(Some(k)) => zcode::fetch(&k, &family).await,
                _ => not_connected_snapshot(id),
            }
        }
        // Codex：官方 app-server；MiMo/WorkBuddy：会话读取结果写入后保留，不因重启降级为「需要登录」
        crate::codex::ID => crate::codex::fetch_via_app_server().await,
        crate::mimo::ID => {
            crate::scheduler::session_cached_snapshot(crate::mimo::ID, rt, store, crate::mimo::login_required())
        }
        crate::workbuddy::ID => {
            crate::scheduler::session_cached_snapshot(crate::workbuddy::ID, rt, store, crate::workbuddy::login_required())
        }
        other => not_connected_snapshot(other),
    }
}

fn maybe_notify_balance(app: tauri::AppHandle, rt: &SharedRuntime, store: &crate::store::Store, s: &Snapshot) {
    let Some(b) = s.balances.first() else { return };
    let Some(total) = b.total else { return };
    let (threshold, enabled) = {
        let r = rt.lock().unwrap();
        (r.thresholds.balance, r.notify_enabled)
    };
    if !enabled {
        return;
    }
    let sym = if b.currency == "CNY" { "¥" } else { "$" };
    let rule_key = format!("balance<{threshold}:{}", b.currency);
    let already = store.kv_get(&format!("notif::{rule_key}")).is_some();

    if total < threshold && !already {
        store.kv_set(&format!("notif::{rule_key}"), &now_iso());
        let _ = app.notification().builder().title("DeepSeek 余额不足").body(format!("当前余额 {sym}{total:.2}（阈值 {sym}{threshold:.0}）")).show();
    } else if total >= threshold && already {
        store.kv_set(&format!("notif::{rule_key}"), ""); // 恢复后允许下次再次提醒
    }
}

fn rand_jitter() -> i64 {
    // ±10% 抖动，避免固定节拍（REFRESH_STRATEGY §1）
    let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().subsec_nanos() as i64;
    (n % 30_000) - 15_000
}
