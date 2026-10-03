// WorkBuddy 适配器（ADR-006 / fixture 2026-09-30 已确认 schema）。
// 数据源：官方站点同源 GET /billing/meter/get-user-resource-summary（+ paid/free 包明细补 PackageName）。
// 量纲：CapacityUnit=credits；Total/Remain/Used 为字符串数字（含小数），remaining_percent = Remain/Total。
// 会话 Cookie 只存在于隔离 WebView2 profile（native 层），React 零接触。
use crate::types::*;
use serde_json::Value;

pub const ID: &str = "workbuddy";
pub const USAGE_URL: &str = "https://www.workbuddy.cn/profile/plans-usage";
pub const HOST: &str = "www.workbuddy.cn";

fn num(v: Option<&Value>) -> Option<f64> {
    // 容量是字符串数字（"497.91000001"），兼容数值型
    match v {
        Some(Value::String(s)) => s.parse::<f64>().ok(),
        Some(Value::Number(n)) => n.as_f64(),
        _ => None,
    }
}

/// ②3 聚合桶：多积分包合计（列表视图优先展示它，明细视图仍逐包展示）。
/// 置于 buckets 首位；id 固定 `<id>/all` 供前端识别。
fn with_aggregate(mut buckets: Vec<QuotaBucket>) -> Vec<QuotaBucket> {
    let sum_t: f64 = buckets.iter().filter_map(|b| b.total).sum();
    let sum_r: f64 = buckets.iter().filter_map(|b| b.remaining).sum();
    let sum_u: f64 = buckets.iter().filter_map(|b| b.used).sum();
    let pct = if sum_t > 0.0 { (sum_r / sum_t * 10000.0).round() / 100.0 } else { 0.0 };
    let agg = QuotaBucket {
        id: format!("{ID}/all"),
        label_key: "quota.credits_all".into(),
        label_raw: None,
        period_type: PeriodType::Custom { raw: "cycle".into() },
        unit: Unit::Credits,
        total: Some(sum_t),
        used: Some(sum_u),
        remaining: Some(sum_r),
        remaining_percent: Some(pct),
        reset_at: None,
        source: "official".into(),
        confidence: "high".into(),
    };
    buckets.insert(0, agg);
    buckets
}

/// summary + paid/free 明细的 Accounts 合并数组 → Snapshot
pub fn map_summary(summary: &Value, accounts: &Value) -> Snapshot {
    let mut buckets = vec![];

    // PackageCode → PackageName（来自 paid/free 明细；summary 里只有 code）
    let mut name_by_code: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    if let Some(list) = accounts.as_array() {
        for acc in list {
            if let (Some(code), Some(name)) = (
                acc.get("PackageCode").and_then(|v| v.as_str()),
                acc.get("PackageName").and_then(|v| v.as_str()),
            ) {
                name_by_code
                    .entry(code.to_string())
                    .or_insert_with(|| name.to_string());
            }
        }
    }

    if let Some(packages) = summary.pointer("/data/Packages").and_then(|v| v.as_array()) {
        for p in packages {
            let code = p.get("PackageCode").and_then(|v| v.as_str()).unwrap_or("unknown");
            let total = num(p.get("CycleTotalCapacity")).unwrap_or(0.0);
            let remain = num(p.get("CycleRemainCapacity")).unwrap_or(0.0);
            let used = num(p.get("CycleUsedCapacity")).unwrap_or(0.0);
            let pct = if total > 0.0 { (remain / total * 10000.0).round() / 100.0 } else { 0.0 };
            let label = name_by_code.get(code).cloned().unwrap_or_else(|| code.to_string());
            buckets.push(QuotaBucket {
                id: format!("workbuddy/{code}"),
                label_key: "quota.credits".into(),
                label_raw: Some(label),
                period_type: PeriodType::Custom { raw: "cycle".into() },
                unit: Unit::Credits,
                total: Some(total),
                used: Some(used),
                remaining: Some(remain),
                remaining_percent: Some(pct),
                reset_at: None,
                source: "official".into(),
                confidence: "high".into(),
            });
        }
    }

    let plan = summary
        .pointer("/data/SubscriptionPackageName")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Snapshot {
        provider_id: ID.into(),
        account_label: Some("WorkBuddy".into()),
        plan_label: plan,
        quota_buckets: with_aggregate(buckets),
        balances: vec![],
        reset_opportunities: vec![],
        connection_state: "connected".into(),
        error_state: None,
        fetched_at: now_iso(),
        stale: false,
        endpoint_stability: "undocumented_first_party".into(),
        installation: "not_installed".into(),
        usage_url: USAGE_URL.into(),
    }
}

/// 未登录 / 会话失效
pub fn login_required() -> Snapshot {
    Snapshot::not_configured(ID, USAGE_URL, "undocumented_first_party")
        .with_error("auth_required".into(), Some("login required".into()))
}

/// 从 title 通道的短行格式解析（AQMOK|套餐名|总量;剩余;已用|...）。
/// 每个积分包一个桶；窗口标题有截断风险，故只传数字与套餐名。
pub fn map_title(plan: &str, pkgs: &[(f64, f64, f64)]) -> Snapshot {
    let mut buckets = vec![];
    for (i, (total, remain, used)) in pkgs.iter().enumerate() {
        let pct = if *total > 0.0 { (remain / total * 10000.0).round() / 100.0 } else { 0.0 };
        buckets.push(QuotaBucket {
            id: format!("{ID}/pkg-{i}"),
            label_key: "quota.credits".into(),
            label_raw: Some(format!("积分包 {}", i + 1)),
            period_type: PeriodType::Custom { raw: "cycle".into() },
            unit: Unit::Credits,
            total: Some(*total),
            used: Some(*used),
            remaining: Some(*remain),
            remaining_percent: Some(pct),
            reset_at: None,
            source: "official".into(),
            confidence: "high".into(),
        });
    }
    Snapshot {
        provider_id: ID.into(),
        account_label: Some("WorkBuddy".into()),
        plan_label: (!plan.is_empty() && plan != "-").then(|| plan.to_string()),
        quota_buckets: with_aggregate(buckets),
        balances: vec![],
        reset_opportunities: vec![],
        connection_state: "connected".into(),
        error_state: None,
        fetched_at: now_iso(),
        stale: false,
        endpoint_stability: "undocumented_first_party".into(),
        installation: "not_installed".into(),
        usage_url: USAGE_URL.into(),
    }
}
