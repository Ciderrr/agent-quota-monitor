// MiMo Token Plan 适配器（ADR-005 / fixture 2026-09-28 已确认 schema）。
// 数据源：官方 Console 同源 GET /api/v1/tokenPlan/usage + /tokenPlan/detail。
// percent 量纲：0–1（fixture 实测 0.4519）；remaining_percent = (1-percent)*100。
// 会话 Cookie 只存在于隔离 WebView2 profile（native 层），React 零接触。
use crate::types::*;

pub const ID: &str = "mimo";
pub const USAGE_URL: &str = "https://platform.xiaomimimo.com/#/console/plan-manage";
pub const HOST: &str = "platform.xiaomimimo.com";

/// 将 usage/detail 的 JSON 映射为 Snapshot（fixture 同源结构）
pub fn map_usage_detail(usage: &serde_json::Value, detail: &serde_json::Value) -> Snapshot {
    let mut buckets = vec![];

    let month = usage.pointer("/data/monthUsage");
    let percent = month
        .and_then(|m| m.get("percent"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    // 0–1 → 剩余百分比 0–100
    let remaining_percent = ((1.0 - percent).clamp(0.0, 1.0) * 100.0 * 100.0).round() / 100.0;

    let items = month.and_then(|m| m.get("items")).and_then(|v| v.as_array());
    if let Some(items) = items {
        for (i, it) in items.iter().enumerate() {
            let used = it.get("used").and_then(|v| v.as_f64());
            let limit = it.get("limit").and_then(|v| v.as_f64());
            let ip = it.get("percent").and_then(|v| v.as_f64()).unwrap_or(percent);
            buckets.push(QuotaBucket {
                id: format!("mimo/month-{i}"),
                label_key: "period.monthly".into(),
                label_raw: None,
                period_type: PeriodType::Monthly,
                unit: Unit::Percent,
                total: limit,
                used,
                remaining: match (limit, used) {
                    (Some(l), Some(u)) => Some(l - u),
                    _ => None,
                },
                remaining_percent: Some(((1.0 - ip).clamp(0.0, 1.0) * 10000.0).round() / 100.0),
                reset_at: None,
                source: "official".into(),
                confidence: "high".into(),
            });
        }
    } else {
        // 无明细时至少给月度总量桶
        buckets.push(QuotaBucket {
            id: "mimo/month".into(),
            label_key: "period.monthly".into(),
            label_raw: None,
            period_type: PeriodType::Monthly,
            unit: Unit::Percent,
            total: None,
            used: None,
            remaining: None,
            remaining_percent: Some(remaining_percent),
            reset_at: None,
            source: "official".into(),
            confidence: "high".into(),
        });
    }

    let plan = detail
        .pointer("/data/planCode")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let period_end = detail.pointer("/data/currentPeriodEnd").and_then(|v| v.as_str());
    let expired = detail
        .pointer("/data/expired")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    // 周期结束时间（"2026-10-23 23:59:59" → ISO）
    let reset_at = period_end.map(|s| {
        let s2 = s.replace(' ', "T");
        if s2.contains('+') || s2.ends_with('Z') {
            s2
        } else {
            format!("{s2}+08:00")
        }
    });
    if let Some(b) = buckets.first_mut() {
        b.reset_at = reset_at.clone();
    }

    let mut snap = Snapshot {
        provider_id: ID.into(),
        account_id: None,
        account_label: Some("MiMo Token Plan".into()),
        plan_label: plan,
        quota_buckets: buckets,
        balances: vec![],
        reset_opportunities: vec![],
        connection_state: "connected".into(),
        error_state: None,
        fetched_at: now_iso(),
        stale: false,
        endpoint_stability: "undocumented_first_party".into(),
        installation: "not_installed".into(),
        usage_url: USAGE_URL.into(),
    };
    if expired {
        snap.connection_state = "degraded".into();
        snap.error_state = Some(ErrorState {
            code: "login_expired".into(),
            detail: Some("plan expired".into()),
            occurred_at: now_iso(),
        });
    }
    snap
}

/// 未登录 / 会话失效
pub fn login_required() -> Snapshot {
    Snapshot::not_configured(ID, USAGE_URL, "undocumented_first_party")
        .with_error("auth_required".into(), Some("login required".into()))
}
