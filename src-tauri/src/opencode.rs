// opencode 适配器 v0.3：**日志/DB 型 Local Enhancement Layer**。
// 数据源：~/.local/share/opencode/opencode.db（SQLite，只读打开）session 表的
// 数值列（tokens_input/output/reasoning、cost、time_created/updated）。
// 红线对照：只聚合用量数字，**绝不读取 session 标题、prompt 或任何对话内容**；
// 绝不触碰 account/credential 表（opencode 自身的登录凭据）。
// 本机实测（v0.3 调研）：time_created 为 epoch 毫秒整数；tokens 列为整数。
use crate::types::*;
use std::path::PathBuf;

pub const ID: &str = "opencode";
pub const USAGE_URL: &str = "https://opencode.ai/docs";

fn db_path() -> Option<PathBuf> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
    let p = PathBuf::from(home).join(".local").join("share").join("opencode").join("opencode.db");
    p.is_file().then_some(p)
}

pub fn fetch() -> Snapshot {
    let Some(path) = db_path() else {
        return Snapshot::not_configured(ID, USAGE_URL, "local_logs")
            .with_error("not_configured".into(), Some("未检测到 opencode 本地数据".into()));
    };
    let Ok(conn) = rusqlite::Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) else {
        return Snapshot::not_configured(ID, USAGE_URL, "local_logs")
            .with_error("temporarily_unavailable".into(), Some("opencode 数据库无法只读打开（可能被占用）".into()));
    };
    let now = chrono::Utc::now().timestamp_millis();
    let q = |since_ms: i64| -> Option<(f64, f64)> {
        conn.query_row(
            "SELECT COALESCE(SUM(tokens_input + tokens_output + tokens_reasoning), 0), \
                    COALESCE(SUM(cost), 0) \
             FROM session WHERE time_updated >= ?1",
            [since_ms],
            |r| Ok((r.get::<_, f64>(0)?, r.get::<_, f64>(1)?)),
        )
        .ok()
    };
    let Some((tokens_today, _)) = q(now - 86_400_000) else {
        return Snapshot::not_configured(ID, USAGE_URL, "local_logs")
            .with_error("temporarily_unavailable".into(), Some("用量查询失败".into()));
    };
    let Some((tokens_7d, _cost_7d)) = q(now - 7 * 86_400_000) else {
        return Snapshot::not_configured(ID, USAGE_URL, "local_logs")
            .with_error("temporarily_unavailable".into(), Some("用量查询失败".into()));
    };
    if tokens_7d <= 0.0 {
        return Snapshot::not_configured(ID, USAGE_URL, "local_logs")
            .with_error("not_configured".into(), Some("近 7 天无 opencode 用量记录".into()));
    }
    let stale = {
        let last: Option<i64> = conn
            .query_row("SELECT MAX(time_updated) FROM session", [], |r| r.get(0))
            .ok();
        last.map(|l| now - l > 24 * 3_600_000).unwrap_or(true)
    };

    Snapshot {
        provider_id: ID.into(),
        account_label: Some("opencode".into()),
        plan_label: None,
        quota_buckets: vec![
            QuotaBucket {
                id: "opencode/1d-tokens".into(),
                label_key: "period.daily".into(),
                label_raw: None,
                period_type: PeriodType::Daily,
                unit: Unit::Tokens,
                total: None, // 自有配额由各模型供应商决定——只展示消耗量
                used: Some(tokens_today),
                remaining: None,
                remaining_percent: None,
                reset_at: None,
                source: "derived".into(),
                confidence: "medium".into(),
            },
            QuotaBucket {
                id: "opencode/7d-tokens".into(),
                label_key: "bucket.weekly".into(),
                label_raw: None,
                period_type: PeriodType::Weekly,
                unit: Unit::Tokens,
                total: None,
                used: Some(tokens_7d),
                remaining: None,
                remaining_percent: None,
                reset_at: None,
                source: "derived".into(),
                confidence: "medium".into(),
            },
        ],
        balances: vec![],
        reset_opportunities: vec![],
        connection_state: "connected".into(),
        error_state: None,
        fetched_at: now_iso(),
        stale,
        endpoint_stability: "local_logs".into(),
        installation: "installed".into(),
        usage_url: USAGE_URL.into(),
    }
}
