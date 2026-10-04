// Kimi (Moonshot) 适配器 v0.3：双路由（端点来源：BurnRate，Apache-2.0，已运行时验证）。
// - API Key（充值型）：GET https://api.moonshot.cn/v1/users/me/balance → data.available_balance
// - Coding Plan（订阅型）：POST https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages
//   凭据为 kimi.com 控制台 token（JWT，自带 device/session/traffic claims）。
// 凭据只经凭据管理器；日志零明文（SECURITY §1）。
use crate::http;
use crate::types::*;
use serde_json::{json, Value};

pub const ID: &str = "kimi";
pub const USAGE_URL: &str = "https://www.kimi.com/code/console";
const BALANCE_URL: &str = "https://api.moonshot.cn/v1/users/me/balance";
const CODING_USAGE_URL: &str = "https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages";
const CODING_SCOPE: &str = "FEATURE_CODING";

pub async fn fetch(secret: &str) -> Snapshot {
    match fetch_inner(secret).await {
        Ok(s) => s,
        Err((code, detail)) => Snapshot::not_configured(ID, USAGE_URL, "public_api").with_error(code, detail),
    }
}

async fn fetch_inner(secret: &str) -> Result<Snapshot, (String, Option<String>)> {
    // 控制台 token（JWT 形态，含点分三段）走 Coding Plan 用量；否则视为 API Key 走余额
    if secret.matches('.').count() >= 2 {
        fetch_coding(secret).await
    } else {
        fetch_balance(secret).await
    }
}

async fn fetch_balance(key: &str) -> Result<Snapshot, (String, Option<String>)> {
    http::assert_allowed(BALANCE_URL, &["api.moonshot.cn"])
        .map_err(|e| ("network_unavailable".to_string(), Some(e)))?;
    let resp = http::client()
        .get(BALANCE_URL)
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
    let balance = payload
        .pointer("/data/available_balance")
        .and_then(|v| v.as_f64())
        .or_else(|| payload.get("available_balance").and_then(|v| v.as_f64()))
        .ok_or_else(|| ("provider_changed".into(), Some("missing available_balance".into())))?;
    let currency = payload
        .pointer("/data/currency")
        .and_then(|v| v.as_str())
        .unwrap_or("CNY")
        .to_string();
    Ok(snapshot_from(
        vec![QuotaBucket {
            id: "kimi/balance".into(),
            label_key: "balance.main".into(),
            label_raw: None,
            period_type: PeriodType::Custom { raw: "balance".into() },
            unit: Unit::Money { currency: currency.clone() },
            total: None,
            used: None,
            remaining: Some(balance),
            remaining_percent: None,
            reset_at: None,
            source: "official".into(),
            confidence: "high".into(),
        }],
        Some(format!("余额 {}", balance)),
    ))
}

async fn fetch_coding(token: &str) -> Result<Snapshot, (String, Option<String>)> {
    http::assert_allowed(CODING_USAGE_URL, &["www.kimi.com"])
        .map_err(|e| ("network_unavailable".to_string(), Some(e)))?;
    let resp = http::client()
        .post(CODING_USAGE_URL)
        .bearer_auth(token.trim())
        .header("Content-Type", "application/json")
        .header("Origin", "https://www.kimi.com")
        .header("Referer", "https://www.kimi.com/code/console")
        .json(&json!({ "scope": [CODING_SCOPE] }))
        .send()
        .await
        .map_err(|e| ("network_unavailable".into(), Some(http::redact(&e.to_string()))))?;
    let status = resp.status().as_u16();
    let payload: Value = resp
        .json()
        .await
        .map_err(|e| ("provider_changed".into(), Some(http::redact(&e.to_string()))))?;
    if matches!(status, 401 | 403) {
        return Err(("auth_required".into(), Some(format!("HTTP {status}"))));
    }
    let usage = payload
        .get("usages")
        .and_then(|v| v.as_array())
        .and_then(|a| {
            a.iter()
                .find(|u| u.get("scope").and_then(|v| v.as_str()) == Some(CODING_SCOPE))
                .or_else(|| a.first())
        })
        .ok_or_else(|| ("provider_changed".into(), Some("missing usages".into())))?;
    let detail = usage
        .get("detail")
        .ok_or_else(|| ("provider_changed".into(), Some("missing detail".into())))?;
    let total = detail.get("limit").and_then(num).unwrap_or(0.0);
    let remaining = detail.get("remaining").and_then(num).unwrap_or(0.0);
    let pct = if total > 0.0 { (remaining / total * 10000.0).round() / 100.0 } else { 0.0 };
    let reset_at = detail
        .get("resetTime")
        .and_then(num)
        .and_then(|n| chrono::DateTime::from_timestamp((n as i64) / 1000, 0))
        .map(|d| d.to_rfc3339());
    Ok(snapshot_from(
        vec![QuotaBucket {
            id: "kimi/coding-weekly".into(),
            label_key: "bucket.weekly".into(),
            label_raw: None,
            period_type: PeriodType::Weekly,
            unit: Unit::Percent,
            total: Some(total),
            used: Some(total - remaining),
            remaining: Some(remaining),
            remaining_percent: Some(pct),
            reset_at,
            source: "official".into(),
            confidence: "high".into(),
        }],
        None,
    ))
}

fn snapshot_from(buckets: Vec<QuotaBucket>, plan: Option<String>) -> Snapshot {
    Snapshot {
        provider_id: ID.into(),
        account_label: Some("Kimi".into()),
        plan_label: plan,
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
    }
}

fn num(v: &Value) -> Option<f64> {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}
