// DeepSeek 适配器（Gate D 垂直切片）：官方余额 API，仅余额 + 余额历史；
// 禁止用两次余额差值推算消费（docs/provider-discovery/deepseek.md 产品规格修正）。
use crate::http;
use crate::types::*;

pub const ALLOWED: &[&str] = &["api.deepseek.com"];
pub const ID: &str = "deepseek";
pub const USAGE_URL: &str = "https://platform.deepseek.com/usage";

#[derive(serde::Deserialize)]
struct BalanceResp {
    #[serde(default)]
    is_available: bool,
    #[serde(default)]
    balance_infos: Vec<BalanceInfo>,
}

#[derive(serde::Deserialize)]
struct BalanceInfo {
    currency: String,
    #[serde(default)]
    total_balance: String,
    #[serde(default)]
    granted_balance: String,
    #[serde(default)]
    topped_up_balance: String,
}

pub async fn fetch(key: &str) -> Snapshot {
    match fetch_inner(key).await {
        Ok(s) => s,
        Err((code, detail)) => Snapshot::not_configured(ID, USAGE_URL, "public_api").with_error(code, detail),
    }
}

async fn fetch_inner(key: &str) -> Result<Snapshot, (String, Option<String>)> {
    let url = "https://api.deepseek.com/user/balance";
    http::assert_allowed(url, ALLOWED).map_err(|e| ("network_unavailable".to_string(), Some(e)))?;

    let resp = http::client()
        .get(url)
        .bearer_auth(key)
        .send()
        .await
        .map_err(|e| ("network_unavailable".to_string(), Some(http::redact(&e.to_string()))))?;

    let status = resp.status().as_u16();
    match status {
        200 => {}
        401 => return Err(("auth_required".into(), Some("HTTP 401".into()))),
        429 => return Err(("rate_limited".into(), Some("HTTP 429".into()))),
        500 | 503 => return Err(("temporarily_unavailable".into(), Some(format!("HTTP {status}")))),
        s => return Err(("unknown".into(), Some(format!("HTTP {s}")))),
    }

    let body: BalanceResp = resp
        .json()
        .await
        .map_err(|e| ("provider_changed".into(), Some(http::redact(&e.to_string()))))?;

    let balances: Vec<BalanceDto> = body
        .balance_infos
        .iter()
        .map(|b| BalanceDto {
            id: "deepseek/main".into(),
            currency: b.currency.clone(),
            total: b.total_balance.parse::<f64>().ok(),
            granted: b.granted_balance.parse::<f64>().ok(),
            topped_up: b.topped_up_balance.parse::<f64>().ok(),
            available_flag: Some(body.is_available),
            source: "official".into(),
        })
        .collect();

    Ok(Snapshot {
        provider_id: ID.into(),
        account_id: None,
        account_label: Some("DeepSeek API".into()),
        plan_label: None,
        quota_buckets: vec![],
        balances,
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
