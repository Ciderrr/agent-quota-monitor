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

pub const PROVIDER_IDS: [&str; 9] = [
    "codex", "zcode", "mimo", "deepseek", "workbuddy", "claude", "opencode", "kimi", "minimax",
];
/// 默认启用集（v0.3 起）：最多同时显示 4 家（用户红线）。新装用户默认这 4 家；
/// 后续启停经设置页持久化到 kv。新扩容 Provider（claude/opencode/kimi/minimax）默认关闭。
pub const DEFAULT_ENABLED: [&str; 4] = ["codex", "mimo", "deepseek", "workbuddy"];
/// 主界面卡片显示上限的默认值（用户红线 v0.3；v0.4 起用户可配 1–8，kv settings.maxVisible）
pub const MAX_VISIBLE: usize = 4;
/// 卡片上限的合法范围（用户拍板：1–8 张可配）
pub const MAX_VISIBLE_RANGE: (usize, usize) = (1, 8);

pub struct Runtime {
    pub snapshots: HashMap<String, Snapshot>,
    pub enabled: HashMap<String, bool>,
    /// 账号实例目录（v0.4）：每个 Provider 至少一条 main；多账号条目持久化在 kv accounts/list。
    /// 运行态 HashMap 的键一律用实例键（"{provider}/{account}"），不再是裸 provider_id。
    pub accounts: Vec<crate::types::AccountInstance>,
    pub next_due_ms: HashMap<String, i64>,
    pub fail_count: HashMap<String, u32>,
    pub default_view: String,
    pub thresholds: Thresholds,
    pub notify_enabled: bool,
    /// 智能刷新基准间隔（ms）；0 = smart（默认 5min）
    pub refresh_interval_ms: i64,
    /// 玻璃不透明度 0.3–1.0
    pub glass_strength: f64,
    /// 主界面卡片显示上限（1–8，用户可配；默认 4 = MAX_VISIBLE）
    pub max_visible: usize,
    /// ZCode 区域族（zai | bigmodel），由连接时记忆
    pub kv_family: Option<String>,
    /// 每 Provider 最近一次完成抓取的时间（ms）；活动边沿补刷的 30s 判据
    pub last_fetch_ms: HashMap<String, i64>,
    /// 界面语言（zh | en）：跨窗口同步的持久化项（settings-changed 广播）
    pub lang: String,
    /// 主题（auto | light | dark）
    pub theme: String,
    /// 会话型 Provider 最近一次真实会话读取（ms）；后台验证 30min 判据
    pub last_session_read_ms: HashMap<String, i64>,
    /// v0.2 洞察（燃烧预测 + 余额趋势 + 切换建议）：每 tick 重算，变化才广播
    pub insights: crate::predict::Insights,
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
    // 默认全 0 = 不提示：pct/余额 < 0 永不成立，通知天然静默。
    // 打扰权交给用户——只有主动设置阈值后才开始提醒（用户裁定）。
    fn default() -> Self {
        Self { warn: 0, crit: 0, balance: 0.0 }
    }
}

pub type SharedRuntime = std::sync::Arc<Mutex<Runtime>>;

/// 实例键快捷构造（单账号路径：main）
pub fn ik(provider_id: &str) -> String {
    crate::types::instance_key(provider_id, crate::types::MAIN_ACCOUNT)
}

/// 某 Provider 的全部实例键（实例目录空则视为单 main）；用于按 Provider 触发刷新等场景。
/// 传入已锁定的 Runtime，避免重复加锁。
pub fn instance_keys_in(r: &Runtime, provider_id: &str) -> Vec<String> {
    let keys: Vec<String> = r
        .accounts
        .iter()
        .filter(|a| a.provider_id == provider_id && a.enabled)
        .map(|a| a.key())
        .collect();
    if keys.is_empty() { vec![ik(provider_id)] } else { keys }
}

pub fn instance_keys_for(rt: &SharedRuntime, provider_id: &str) -> Vec<String> {
    let r = rt.lock().unwrap();
    instance_keys_in(&r, provider_id)
}

/// 从实例键还原 provider_id（"{provider}/{account}" 的 '/' 前段；裸 id 原样返回）
pub fn provider_of_key(key: &str) -> &str {
    key.split_once('/').map(|(p, _)| p).unwrap_or(key)
}

/// 从实例键还原 account_id（无 '/' 视为 main）
pub fn account_of_key(key: &str) -> String {
    key.split_once('/')
        .map(|(_, a)| a.to_string())
        .unwrap_or_else(|| crate::types::MAIN_ACCOUNT.to_string())
}

/// 会话型登录窗 label：main 复用预声明窗（红线：动态建窗仅用于非 main 账号），
/// 其他账号运行动态创建 `{provider}-login-{account}`。
pub fn login_window_label(provider_id: &str, account: &str) -> String {
    match (provider_id, account == crate::types::MAIN_ACCOUNT) {
        ("mimo", true) => "mimo-login".into(),
        ("workbuddy", true) => "wb-login".into(),
        _ => format!("{provider_id}-login-{account}"),
    }
}

/// 会话型 Provider 的登录窗预声明 label（main 专用）
pub fn predesigned_login_label(provider_id: &str) -> &'static str {
    match provider_id {
        "mimo" => "mimo-login",
        "workbuddy" => "wb-login",
        _ => "",
    }
}

// ===== 账号实例目录（持久化 kv accounts/list；v0.4 P2）=====

pub const MAX_ACCOUNTS_PER_PROVIDER: usize = 3;
pub const MAX_ACCOUNTS_TOTAL: usize = 12;

pub fn load_accounts(store: &crate::store::Store) -> Vec<crate::types::AccountInstance> {
    store
        .kv_get("accounts/list")
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_default()
}

fn save_accounts(store: &crate::store::Store, accounts: &[crate::types::AccountInstance]) {
    store.kv_set("accounts/list", &serde_json::to_string(accounts).unwrap_or_default());
}

/// 生成 8 位 hex 账号 ID（单机低频场景，时间戳异或进程号足够抗碰撞）
fn new_account_id() -> String {
    let n = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
        ^ (std::process::id() as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    format!("{n:08x}")
}

pub fn add_account(
    rt: &SharedRuntime,
    store: &crate::store::Store,
    provider_id: &str,
    label: Option<String>,
) -> Result<crate::types::AccountInstance, String> {
    if !PROVIDER_IDS.contains(&provider_id) {
        return Err("unknown provider".into());
    }
    let mut r = rt.lock().unwrap();
    let per = r.accounts.iter().filter(|a| a.provider_id == provider_id).count();
    if per + 1 > MAX_ACCOUNTS_PER_PROVIDER {
        return Err(format!("cap_provider:{MAX_ACCOUNTS_PER_PROVIDER}"));
    }
    if r.accounts.len() + 1 > MAX_ACCOUNTS_TOTAL {
        return Err(format!("cap_total:{MAX_ACCOUNTS_TOTAL}"));
    }
    let inst = crate::types::AccountInstance {
        provider_id: provider_id.into(),
        account_id: new_account_id(),
        label,
        enabled: true,
    };
    r.accounts.push(inst.clone());
    let all = r.accounts.clone();
    drop(r);
    save_accounts(store, &all);
    Ok(inst)
}

pub fn remove_account(
    rt: &SharedRuntime,
    store: &crate::store::Store,
    provider_id: &str,
    account_id: &str,
) -> Result<(), String> {
    if account_id == crate::types::MAIN_ACCOUNT {
        return Err("cannot remove main".into());
    }
    let removed = {
        let mut r = rt.lock().unwrap();
        let before = r.accounts.len();
        r.accounts.retain(|a| !(a.provider_id == provider_id && a.account_id == account_id));
        if r.accounts.len() == before {
            return Err("no such account".into());
        }
        let all = r.accounts.clone();
        // 清运行态（快照/节奏/防重入），登录窗由调用方隐藏销毁
        let key = crate::types::instance_key(provider_id, account_id);
        r.snapshots.remove(&key);
        r.next_due_ms.remove(&key);
        r.fail_count.remove(&key);
        r.last_fetch_ms.remove(&key);
        r.read_in_progress.remove(&key);
        r.last_session_read_ms.remove(&key);
        all
    };
    save_accounts(store, &removed);
    // 历史一并清除（用户拍板：隐私优先）
    store.purge_account_history(provider_id, account_id);
    // 非会话型还可能挂凭据（API Key 型多账号预铺），有则删
    for slot in ["api-key", "coding-plan-key"] {
        let _ = crate::credentials::delete_credential(&format!("{provider_id}/{account_id}/{slot}"));
    }
    Ok(())
}

pub fn rename_account(
    rt: &SharedRuntime,
    store: &crate::store::Store,
    provider_id: &str,
    account_id: &str,
    label: &str,
) -> Result<(), String> {
    let mut r = rt.lock().unwrap();
    let inst = r
        .accounts
        .iter_mut()
        .find(|a| a.provider_id == provider_id && a.account_id == account_id)
        .ok_or("no such account")?;
    inst.label = if label.is_empty() { None } else { Some(label.to_string()) };
    let all = r.accounts.clone();
    drop(r);
    save_accounts(store, &all);
    Ok(())
}

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
        "claude" => (crate::claude::USAGE_URL, "local_logs"),
        "opencode" => (crate::opencode::USAGE_URL, "local_logs"),
        "kimi" => (crate::kimi::USAGE_URL, "public_api"),
        "minimax" => (crate::minimax::USAGE_URL, "public_api"),
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
    // (provider_id, instance_key) 对：实例目录空则每 Provider 视为单 main
    let due: Vec<(String, String)> = {
        let r = rt.lock().unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        let mut out = Vec::new();
        for id in PROVIDER_IDS {
            if !r.enabled.get(id).copied().unwrap_or(true) {
                continue;
            }
            for k in instance_keys_in(&r, id) {
                if r.next_due_ms.get(&k).copied().unwrap_or(0) <= now || force_due.contains(&id.to_string()) {
                    out.push((id.to_string(), k));
                }
            }
        }
        out
    };

    for (id, inst) in due {
        let snapshot = fetch_provider(&inst, rt, store).await;
        let is_err = snapshot.error_state.is_some();
        let connected = snapshot.connection_state == "connected";

        // 退避 / 下次到期
        {
            let mut r = rt.lock().unwrap();
            let fails = if is_err { r.fail_count.get(&inst).copied().unwrap_or(0) + 1 } else { 0 };
            r.fail_count.insert(inst.clone(), fails);
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
            r.last_fetch_ms.insert(inst.clone(), now_ms);
            let jitter = rand_jitter();
            r.next_due_ms.insert(inst.clone(), now_ms + interval + jitter);
            r.snapshots.insert(inst.clone(), snapshot.clone());
        }

        // 持久化：余额样本（DeepSeek Balance history）
        if connected && id == deepseek::ID {
            if let Some(b) = snapshot.balances.first() {
                let fmt = |v: Option<f64>| v.map(|x| format!("{x:.2}"));
                store.insert_balance_sample(
                    &id, &account_of_key(&inst), &b.currency,
                    fmt(b.total), fmt(b.granted), fmt(b.topped_up), b.available_flag,
                );
            }
        }
        store.insert_snapshot(&id, &account_of_key(&inst), &serde_json::to_string(&snapshot).unwrap_or_default());

        // 通知（余额阈值；notification_state 去重）
        if connected && id == deepseek::ID {
            maybe_notify_balance(app.clone(), rt, store, &snapshot, &inst);
        }
        // 额度阈值通知（warn/crit 两级，Windows 系统通知；PRODUCT_SPEC 承诺项）
        if connected {
            maybe_notify_quota(app.clone(), rt, store, &snapshot, &inst);
        }

        let _ = app.emit("snapshot-updated", json!({ "providerId": id, "instanceKey": inst }));
        eprintln!(
            "[aqm] tick {inst}: {} {}",
            snapshot.connection_state,
            snapshot.error_state.as_ref().map(|e| e.code.clone()).unwrap_or_default(),
        );
    }

    // 会话型 Provider 后台验证（②0/④）：每 30 分钟对**隐藏的**登录窗做一次真实会话读取，    // 会话失效 → 立即标 auth_required 并广播，用户无需手动刷新才发现。
    // 窗口可见（用户正在登录）时绝不触发，杜绝打断登录流程（②2）。
    // last_session_read_ms 由 session_read 本体在开始时记账（含手动/ConnectFlow 触发）。
    for id in ["mimo", "workbuddy"] {
        // 每 Provider 遍历全部账号实例（main + 目录实例）：各自独立 30min 判据与防重入
        let insts: Vec<String> = {
            let r = rt.lock().unwrap();
            if !r.enabled.get(id).copied().unwrap_or(true) { continue; }
            let mut v = vec![ik(id)];
            for a in r.accounts.iter().filter(|a| a.provider_id == *id && a.enabled) {
                v.push(a.key());
            }
            v
        };
        for inst in insts {
            {
                let r = rt.lock().unwrap();
                if r.read_in_progress.get(&inst).copied().unwrap_or(false) { continue; }
                let last = r.last_session_read_ms.get(&inst).copied().unwrap_or(0);
                if chrono::Utc::now().timestamp_millis() - last < 30 * 60 * 1000 { continue; }
            }
            let label = login_window_label(id, &account_of_key(&inst));
            let win_hidden = app
                .get_webview_window(&label)
                .map(|w| !w.is_visible().unwrap_or(true))
                .unwrap_or(false);
            if !win_hidden { continue; }
            let a2 = app.clone();
            let r2 = rt.clone();
            let s2 = store.clone();
            let id2 = id.to_string();
            let acc2 = account_of_key(&inst);
            tauri::async_runtime::spawn(async move {
                let res = if id2 == "mimo" {
                    crate::commands::session_read_mimo(a2.clone(), r2.clone(), s2.clone(), Some(acc2)).await
                } else {
                    crate::commands::session_read_workbuddy(a2.clone(), r2.clone(), s2.clone(), Some(acc2)).await
                };
                if let Err(e) = res {
                    eprintln!("[aqm] session verify {inst}: {e}");
                }
            });
        }
    }

    // v0.2 洞察：燃烧预测 + 余额趋势 + 切换建议——每 tick 重算，变化才广播
    let ins = compute_insights(rt, store);
    let changed = {
        let mut r = rt.lock().unwrap();
        if r.insights != ins {
            r.insights = ins.clone();
            true
        } else {
            false
        }
    };
    if changed {
        maybe_notify_burn(&app, rt, store, &ins);
        let _ = app.emit("insights-updated", &ins);
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
    let inst = ik(id);
    let existing = rt.lock().unwrap().snapshots.get(&inst).cloned();
    if let Some(s) = existing {
        if s.connection_state == "connected" || s.connection_state == "degraded" {
            return with_age_stale(s);
        }
    }
    let stored = store
        .load_latest_snapshots()
        .into_iter()
        .find(|(pid, acc, _)| pid == id && acc == crate::types::MAIN_ACCOUNT)
        .and_then(|(_, _, json)| serde_json::from_str::<Snapshot>(&json).ok());
    match stored {
        Some(s) if s.connection_state == "connected" || s.connection_state == "degraded" => with_age_stale(s),
        _ => login_required,
    }
}

/// 按账号实例取凭据：main 直接读旧槽（单账号零迁移）；其他账号读 "{provider}/{account}/{slot}"，
/// 未命中回退旧槽。凭据内容本身绝不落日志/落盘（红线）。
fn credential_for(provider: &str, account: &str, slot: &str) -> Result<Option<String>, String> {
    if account == crate::types::MAIN_ACCOUNT {
        return crate::credentials::get_credential(&format!("{provider}/{slot}"));
    }
    let nested = crate::credentials::get_credential(&format!("{provider}/{account}/{slot}"))?;
    if nested.is_some() {
        return Ok(nested);
    }
    crate::credentials::get_credential(&format!("{provider}/{slot}"))
}

pub async fn fetch_provider(inst: &str, rt: &SharedRuntime, store: &crate::store::Store) -> Snapshot {
    let id = provider_of_key(inst);
    let account = account_of_key(inst);
    // Codex 连接模式（连接页卡片选择，v0.3.1）：managed=强制托管组件 + 隔离登录
    let codex_prefer_managed = store.kv_get("codex/mode").as_deref() == Some("managed");
    match id {
        deepseek::ID => {
            let key = credential_for(id, &account, "api-key");
            match key {
                Ok(Some(k)) => deepseek::fetch(&k).await,
                Ok(None) => not_connected_snapshot(id),
                Err(_) => not_connected_snapshot(id).with_error("unknown".into(), Some("credential store error".into())),
            }
        }
        zcode::ID => {
            let cred = credential_for(id, &account, "coding-plan-key");
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
        crate::codex::ID => {
            // 断开标记（本机模式下 logout 无法靠清隔离目录断开——用户登录仍在）。
            // 用专属错误码而非 login_expired：否则设置页会误报"令牌失效"并给出错误的修复指引。
            if store.kv_get("codex/disconnected").as_deref() == Some("1") {
                not_connected_snapshot(crate::codex::ID)
                    .with_error("disconnected".into(), Some("已在设置中断开监控，连接以恢复".into()))
            } else {
                crate::codex::fetch_via_app_server_ctx(codex_prefer_managed).await
            }
        }
        crate::mimo::ID => {
            crate::scheduler::session_cached_snapshot(crate::mimo::ID, rt, store, crate::mimo::login_required())
        }
        crate::workbuddy::ID => {
            crate::scheduler::session_cached_snapshot(crate::workbuddy::ID, rt, store, crate::workbuddy::login_required())
        }
        // v0.3 扩容：日志型（本机数据，无网络）+ API Key 型
        crate::claude::ID => crate::claude::fetch(),
        crate::opencode::ID => crate::opencode::fetch(),
        crate::kimi::ID => {
            let key = credential_for(id, &account, "api-key");
            match key {
                Ok(Some(k)) => crate::kimi::fetch(&k).await,
                _ => not_connected_snapshot(crate::kimi::ID),
            }
        }
        crate::minimax::ID => {
            let key = credential_for(id, &account, "api-key");
            match key {
                Ok(Some(k)) => crate::minimax::fetch(&k).await,
                _ => not_connected_snapshot(crate::minimax::ID),
            }
        }
        other => not_connected_snapshot(other),
    }
}

fn maybe_notify_balance(app: tauri::AppHandle, rt: &SharedRuntime, store: &crate::store::Store, s: &Snapshot, inst: &str) {
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
    let rule_key = format!("balance<{threshold}:{}::{}", b.currency, inst);
    let already = store.kv_get(&format!("notif::{rule_key}")).is_some();

    if total < threshold && !already {
        store.kv_set(&format!("notif::{rule_key}"), &now_iso());
        let _ = app.notification().builder().title("DeepSeek 余额不足").body(format!("当前余额 {sym}{total:.2}（阈值 {sym}{threshold:.0}）")).show();
    } else if total >= threshold && already {
        store.kv_set(&format!("notif::{rule_key}"), ""); // 恢复后允许下次再次提醒
    }
}

fn provider_display(id: &str) -> &'static str {
    match id {
        "codex" => "Codex",
        "mimo" => "MiMo Token Plan",
        "workbuddy" => "WorkBuddy",
        "deepseek" => "DeepSeek",
        "zcode" => "ZCode·GLM",
        _ => "Provider",
    }
}

/// v0.2 洞察计算：桶级燃烧预测（近 24h 样本）+ DeepSeek 余额趋势 + 切换建议。
/// 全部基于既有快照历史，零新数据源；纯计算，失败安静降级为空洞察。
/// v0.4：快照按实例存取，预测序列按 (provider, account) 提取；predictions 数组可含多账号条目。
pub fn compute_insights(rt: &SharedRuntime, store: &crate::store::Store) -> crate::predict::Insights {
    use crate::predict::*;
    let mut ins = Insights::default();
    let now = chrono::Utc::now().timestamp_millis();
    let snaps: Vec<Snapshot> = rt.lock().unwrap().snapshots.values().cloned().collect();
    for s in &snaps {
        if s.connection_state != "connected" && s.connection_state != "degraded" {
            continue;
        }
        let acc = s.account_id.clone().unwrap_or_else(|| crate::types::MAIN_ACCOUNT.to_string());
        // 桶级燃烧预测：每个桶一条序列，fit 内部处理重置截断
        let series = store.quota_series(&s.provider_id, &acc, 1);
        let mut preds = Vec::new();
        for (bucket_id, title, pts) in &series {
            let Some(fit) = fit_burn(pts) else { continue };
            let Some(conf) = confidence_of(&fit) else { continue };
            let reset_ms = s
                .quota_buckets
                .iter()
                .find(|b| &b.id == bucket_id)
                .and_then(|b| b.reset_at.as_deref())
                .and_then(iso_to_ms);
            if let Some(p) = build_bucket_prediction(&s.provider_id, &acc, bucket_id, title.clone(), &fit, conf, reset_ms, now) {
                preds.push(p);
            }
        }
        if !preds.is_empty() {
            ins.predictions.entry(s.provider_id.clone()).or_default().extend(preds);
        }
        // DeepSeek 余额趋势（¥/小时斜率 → 日均消耗 → 可支撑天数）
        // P1 仅 main 实例参与：balance map 的键仍是 provider_id，多实例语义随 P3 UI 一起扩展
        if s.provider_id == crate::deepseek::ID && acc == crate::types::MAIN_ACCOUNT {
            let raw = store.balance_series_raw(&s.provider_id, &acc, 14);
            if let Some(fit) = fit_burn(&raw) {
                if let Some(conf) = confidence_of(&fit) {
                    if fit.slope_per_hour < -0.005 {
                        let daily = -fit.slope_per_hour * 24.0;
                        if let Some(b) = s.balances.first() {
                            if let Some(total) = b.total {
                                if daily > 0.01 {
                                    ins.balance.insert(
                                        s.provider_id.clone(),
                                        BalancePrediction {
                                            provider_id: s.provider_id.clone(),
                                            daily_burn: daily,
                                            currency: b.currency.clone(),
                                            days_left: total / daily,
                                            confidence: conf.into(),
                                        },
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    // 切换建议：代表桶剩余 < 告警阈值 → 其他已连接 Provider 按余量降序取前 3
    let warn = rt.lock().unwrap().thresholds.warn as f64;
    struct Rep {
        id: String,
        name: String,
        pct: Option<f64>,
        reset_at: Option<String>,
        connected: bool,
    }
    // v0.4：快照按实例一条，代表账号按 Provider 聚合取剩余最低者（切换建议看最坏情况）
    let mut best: std::collections::HashMap<String, Rep> = std::collections::HashMap::new();
    for s in &snaps {
        let connected = s.connection_state == "connected" || s.connection_state == "degraded";
        if !connected {
            continue;
        }
        let rep = representative_bucket(&s.quota_buckets);
        let r = Rep {
            id: s.provider_id.clone(),
            name: provider_display(&s.provider_id).to_string(),
            pct: rep.as_ref().and_then(|b| b.remaining_percent),
            reset_at: rep.and_then(|b| b.reset_at.clone()),
            connected,
        };
        match best.get_mut(&s.provider_id) {
            Some(existing) => {
                let better = match (r.pct, existing.pct) {
                    (Some(a), Some(b)) => a < b,
                    (Some(_), None) => true,
                    _ => false,
                };
                if better {
                    *existing = r;
                }
            }
            None => {
                best.insert(s.provider_id.clone(), r);
            }
        }
    }
    let reps: Vec<Rep> = best.into_values().collect();
    for r in &reps {
        let Some(p) = r.pct else { continue };
        if !r.connected || p >= warn {
            continue;
        }
        let mut alts: Vec<Alternative> = reps
            .iter()
            .filter(|o| o.id != r.id && o.connected && o.pct.is_some())
            .map(|o| Alternative {
                provider_id: o.id.clone(),
                name: o.name.clone(),
                remaining_pct: o.pct,
                reset_at: o.reset_at.clone(),
            })
            .collect();
        alts.sort_by(|a, b| {
            b.remaining_pct
                .partial_cmp(&a.remaining_pct)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        alts.truncate(3);
        if !alts.is_empty() {
            ins.alternatives.insert(r.id.clone(), alts);
        }
    }
    ins
}

/// 燃烧型通知：预测耗尽 ≤ 60 分钟时弹一次（去重），回升 > 120 分钟自动复位
fn maybe_notify_burn(app: &tauri::AppHandle, rt: &SharedRuntime, store: &crate::store::Store, ins: &crate::predict::Insights) {
    let enabled = { rt.lock().unwrap().notify_enabled };
    if !enabled {
        return;
    }
    let now = chrono::Utc::now().timestamp_millis();
    for (pid, preds) in &ins.predictions {
        for p in preds {
            let Some(ex) = crate::predict::iso_to_ms(&p.exhaust_at) else { continue };
            let mins = (ex - now) as f64 / 60_000.0;
            let key = format!("notif::burn::{}::{}::{}", pid, p.account_id.as_deref().unwrap_or(crate::types::MAIN_ACCOUNT), p.bucket_id);
            if mins <= 60.0 {
                if store.kv_get(&key).is_none() {
                    store.kv_set(&key, "1");
                    let m = mins.round() as i64;
                    let human = if m >= 60 { format!("{}小时{}分", m / 60, m % 60) } else { format!("{m}分钟") };
                    let _ = app.notification().builder().title("额度即将耗尽").body(format!(
                        "{} · {}：按当前速度约 {}后耗尽",
                        provider_display(pid), p.label, human
                    )).show();
                }
            } else if mins > 120.0 && store.kv_get(&key).is_some() {
                store.kv_set(&key, "");
            }
        }
    }
}

/// 通知正文里的桶显示名：必须具体到「哪个限额」（用户反馈：多限额 Provider 要能区分
/// 是 5h 还是周限额触发的告警，"codex/primary" 这种内部 id 对用户无意义）。
fn bucket_display(b: &QuotaBucket) -> String {
    if b.id.ends_with("/all") {
        return "积分包合计".into();
    }
    let period = match &b.period_type {
        PeriodType::Rolling { window_mins } => {
            let m = *window_mins;
            if m > 0 && m % 1440 == 0 {
                format!("{}天限额", m / 1440)
            } else if m > 0 && m % 60 == 0 {
                format!("{}小时限额", m / 60)
            } else {
                format!("{m}分钟限额")
            }
        }
        PeriodType::Weekly => "周限额".into(),
        PeriodType::Monthly => "月度限额".into(),
        PeriodType::Daily => "日限额".into(),
        PeriodType::BillingCycle => "账期限额".into(),
        PeriodType::Custom { raw } => raw.clone(),
    };
    match b.label_raw.as_deref() {
        Some(raw) if !raw.is_empty() && raw != period => format!("{raw} · {period}"),
        _ => period,
    }
}

/// 额度阈值通知（warn/crit 两级，Windows 系统通知）。
/// 与 UI 同一套代表桶语义：reserve 类桶不参与告警（reserve 剩 0% 是常态，用户实测反馈）；
/// 存在聚合桶（*/all）时只看聚合桶。同桶同级只提醒一次，缓解（crit→warn）不打扰，
/// 回升到 warn 以上自动复位，下次跌破可再次提醒。
fn maybe_notify_quota(app: tauri::AppHandle, rt: &SharedRuntime, store: &crate::store::Store, s: &Snapshot, inst: &str) {
    let (warn, crit, enabled) = {
        let r = rt.lock().unwrap();
        (r.thresholds.warn, r.thresholds.crit, r.notify_enabled)
    };
    if !enabled {
        return;
    }
    let mut cands: Vec<&QuotaBucket> = s
        .quota_buckets
        .iter()
        .filter(|b| b.remaining_percent.is_some())
        .filter(|b| {
            let t = format!("{} {}", b.id, b.label_raw.clone().unwrap_or_default()).to_lowercase();
            !t.contains("reserve")
        })
        .collect();
    if cands.is_empty() {
        return;
    }
    if let Some(pos) = cands.iter().position(|b| b.id.ends_with("/all")) {
        let agg = cands[pos];
        cands.clear();
        cands.push(agg);
    }
    for b in cands {
        let Some(pct) = b.remaining_percent else { continue };
        let level = if (pct as i64) < crit { "crit" } else if (pct as i64) < warn { "warn" } else { "ok" };
        let key = format!("notif::quota::{}::{}", inst, b.id);
        let already = store.kv_get(&key).unwrap_or_default();
        if level == "ok" {
            if !already.is_empty() {
                store.kv_set(&key, ""); // 回升复位
            }
            continue;
        }
        if already == level {
            continue; // 同桶同级去重
        }
        if already == "crit" && level == "warn" {
            store.kv_set(&key, "warn"); // 缓解不重复打扰
            continue;
        }
        store.kv_set(&key, level);
        let title = if level == "crit" { "额度即将耗尽" } else { "额度偏低" };
        let body = format!("{} · {}：剩余 {:.0}%", provider_display(&s.provider_id), bucket_display(b), pct);
        eprintln!("[aqm] notify quota {} {} ({}%): {}", s.provider_id, level, pct, b.id);
        let _ = app.notification().builder().title(title).body(body).show();
    }
}

fn rand_jitter() -> i64 {
    // ±10% 抖动，避免固定节拍（REFRESH_STRATEGY §1）
    let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().subsec_nanos() as i64;
    (n % 30_000) - 15_000
}
