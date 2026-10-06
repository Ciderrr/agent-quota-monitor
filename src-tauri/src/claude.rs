// Claude Code 适配器 v0.3：**日志型 Local Enhancement Layer**（ADR-006 会话路线的替代实现）。
// 数据源：~/.claude/projects/**/*.jsonl 中 assistant 消息的 usage 字段
//（input/output/cache_creation/cache_read tokens + timestamp）。
// 红线对照：只读取用量聚合所需字段，**绝不读取/存储 prompt 与对话内容**；
// 绝不触碰 ~/.claude 的登录凭据（.credentials.json）——OAuth 复用有 refresh-token
// 冲突先例（CodexBar issue #1161），列为后续可选路线。
// 诚实边界：Claude Pro/Max 的官方上限未公开，本适配器输出的是**消耗量**
//（当前 5h 窗口 / 近 7 天的 token 总量），不是官方剩余百分比。
use crate::types::*;
use std::path::PathBuf;

pub const ID: &str = "claude";
pub const USAGE_URL: &str = "https://claude.ai/settings/usage";

fn claude_dir() -> Option<PathBuf> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
    let dir = PathBuf::from(home).join(".claude").join("projects");
    dir.is_dir().then_some(dir)
}

fn walk_jsonl(dir: &PathBuf, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for ent in rd.flatten() {
        let p = ent.path();
        if p.is_dir() {
            walk_jsonl(&p, out);
        } else if p.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            out.push(p);
        }
    }
}

/// 单条 assistant 消息的用量（token 数）
struct UsageEntry {
    ts_ms: i64,
    tokens: f64,
}

fn parse_file(path: &PathBuf, out: &mut Vec<UsageEntry>) {
    let Ok(content) = std::fs::read_to_string(path) else { return };
    for line in content.lines() {
        // 快速预筛：只处理含 usage 的行，避免完整 JSON 解析大文件
        if !line.contains("\"usage\"") || !line.contains("\"timestamp\"") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        let Some(usage) = v.get("message").and_then(|m| m.get("usage")).or_else(|| v.get("usage")) else {
            continue;
        };
        let sum = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]
            .iter()
            .filter_map(|k| usage.get(*k).and_then(|x| x.as_f64()))
            .sum::<f64>();
        if sum <= 0.0 {
            continue;
        }
        let Some(ts) = v.get("timestamp").and_then(|x| x.as_str()).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()) else {
            continue;
        };
        out.push(UsageEntry { ts_ms: ts.timestamp_millis(), tokens: sum });
    }
}

pub fn fetch() -> Snapshot {
    fetch_inner()
}

fn fetch_inner() -> Snapshot {
    let Some(dir) = claude_dir() else {
        return Snapshot::not_configured(ID, USAGE_URL, "local_logs")
            .with_error("not_configured".into(), Some("未检测到 Claude Code 本地数据（~/.claude）".into()));
    };
    let mut files = Vec::new();
    walk_jsonl(&dir, &mut files);
    if files.is_empty() {
        return Snapshot::not_configured(ID, USAGE_URL, "local_logs")
            .with_error("not_configured".into(), Some("未检测到 Claude Code 会话记录".into()));
    }
    let mut entries: Vec<UsageEntry> = Vec::new();
    for f in &files {
        parse_file(f, &mut entries);
    }
    if entries.is_empty() {
        return Snapshot::not_configured(ID, USAGE_URL, "local_logs")
            .with_error("not_configured".into(), Some("会话记录中无用量数据".into()));
    }
    entries.sort_by_key(|e| e.ts_ms);
    let now = chrono::Utc::now().timestamp_millis();
    let window_5h: f64 = entries.iter().filter(|e| e.ts_ms >= now - 5 * 3_600_000).map(|e| e.tokens).sum();
    let window_7d: f64 = entries.iter().filter(|e| e.ts_ms >= now - 7 * 86_400_000).map(|e| e.tokens).sum();
    // 最新活动时间：超过 24h 无活动 → 标 stale（诚实表达“数据不再增长”）
    let last_activity = entries.last().map(|e| e.ts_ms).unwrap_or(0);
    let stale = now - last_activity > 24 * 3_600_000;

    Snapshot {
        provider_id: ID.into(),
        account_id: None,
        account_label: Some("Claude Code".into()),
        plan_label: None,
        quota_buckets: vec![
            QuotaBucket {
                id: "claude/5h-tokens".into(),
                label_key: "bucket.5h".into(),
                label_raw: None,
                period_type: PeriodType::Rolling { window_mins: 300 },
                unit: Unit::Tokens,
                total: None, // 官方上限未公开——绝不猜测
                used: Some(window_5h),
                remaining: None,
                remaining_percent: None,
                reset_at: None,
                source: "derived".into(),
                confidence: "medium".into(),
            },
            QuotaBucket {
                id: "claude/7d-tokens".into(),
                label_key: "bucket.weekly".into(),
                label_raw: None,
                period_type: PeriodType::Weekly,
                unit: Unit::Tokens,
                total: None,
                used: Some(window_7d),
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
