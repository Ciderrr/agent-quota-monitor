// MiniMax Coding Plan 适配器 v0.3（端点来源：BurnRate，Apache-2.0，已运行时验证）。
// GET https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains（Bearer API Key）
// ⚠️ 坑：model_remains[].current_interval_usage_count 语义是「剩余」而非「已用」
//（OpenClaw 文档与 BurnRate 的 (total - usage_count) 用法互证）——绝不按字段名猜测。
use crate::http;
use crate::types::*;
use serde_json::Value;

pub const ID: &str = "minimax";
pub const USAGE_URL: &str = "https://platform.minimaxi.com";
const QUOTA_URL: &str = "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains";

pub async fn fetch(key: &str) -> Snapshot {
    match fetch_inner(key).await {
        Ok(s) => s,
        Err((code, detail)) => Snapshot::not_configured(ID, USAGE_URL, "public_api").with_error(code, detail),
    }
}

async fn fetch_inner(key: &str) -> Result<Snapshot, (String, Option<String>)> {
    http::assert_allowed(QUOTA_URL, &["api.minimaxi.com"])
        .map_err(|e| ("network_unavailable".to_string(), Some(e)))?;
    let resp = http::client()
        .get(QUOTA_URL)
        .bearer_auth(key.trim())
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| ("network_unavailable".into(), Some(http::redact(&e.to_string()))))?;
    let status = resp.status().as_u16();
    let payload: Value = resp
        .json()
        .await
        .map_err(|e| ("provider_changed".into(), Some(http::redact(&e.to_string()))))?;
    if status == 401 {
        return Err(("auth_required".into(), Some(format!("HTTP {status}"))));
    }
    if payload.pointer("/base_resp/status_code").and_then(|v| v.as_i64()) != Some(0) {
        return Err(("provider_changed".into(), Some("base_resp != 0".into())));
    }
    let entries = payload
        .get("model_remains")
        .and_then(|v| v.as_array())
        .ok_or_else(|| ("provider_changed".into(), Some("missing model_remains".into())))?;

    let mut buckets = Vec::new();
    for e in entries {
        let model = e.get("model_name").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
        let total = e.get("current_interval_total_count").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let remaining = e.get("current_interval_usage_count").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let pct = if total > 0.0 { (remaining / total * 10000.0).round() / 100.0 } else { 0.0 };
        let reset_at = [
            e.get("end_time"),
            e.get("current_interval_end_time"),
            e.get("nextResetTime"),
            e.get("next_reset_time"),
        ]
        .into_iter()
        .find_map(|v| {
            let n = v?.as_f64()?;
            let secs = if n > 1e11 { n / 1000.0 } else { n };
            chrono::DateTime::from_timestamp(secs as i64, 0).map(|d| d.to_rfc3339())
        });
        buckets.push(QuotaBucket {
            id: format!("minimax/{model}"),
            label_key: "quota.quota".into(),
            label_raw: Some(model),
            period_type: PeriodType::Custom { raw: "interval".into() },
            unit: Unit::Requests,
            total: Some(total),
            used: Some((total - remaining).max(0.0)),
            remaining: Some(remaining),
            remaining_percent: Some(pct),
            reset_at,
            source: "official".into(),
            confidence: "high".into(),
        });
    }
    if buckets.is_empty() {
        return Err(("provider_changed".into(), Some("empty model_remains".into())));
    }

    Ok(Snapshot {
        provider_id: ID.into(),
        account_label: Some("MiniMax".into()),
        plan_label: None,
        quota_buckets: buckets,
        balances: vec![],
        reset_opportunities: vec![],
        connection_state: "connected".into(),
        error_state: None,
        fetched_at: now_iso(),
        stale: false,
        endpoint_stability: "public_api".into(),
        installation: "not_installed".into(),
        usage_url: USAGE_URL.into(),
    })
}
