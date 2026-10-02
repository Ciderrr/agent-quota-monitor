// ZCode / GLM Coding Plan 适配器（Gate E 提前实现最小面）：
// GET {base}/api/monitor/usage/quota/limit，Authorization 为裸 key（无 Bearer 前缀）。
// limits[] 字段级结构未运行时验证（docs/provider-discovery/zcode.md §8）：
// 未知 type/unit 一律 PeriodType::Custom(raw)，标签用通用“额度”，不猜测语义。
use crate::http;
use crate::types::*;

pub const ALLOWED_ZAI: &[&str] = &["api.z.ai"];
pub const ALLOWED_BM: &[&str] = &["open.bigmodel.cn"];
pub const ID: &str = "zcode";
pub const USAGE_URL_ZAI: &str = "https://console.z.ai";
pub const USAGE_URL_BM: &str = "https://open.bigmodel.cn/usercenter/glm-coding/usage";

#[derive(serde::Deserialize)]
struct Envelope {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    msg: String,
    #[serde(default)]
    data: serde_json::Value,
}

pub async fn fetch(key: &str, family: &str) -> Snapshot {
    match fetch_inner(key, family).await {
        Ok(s) => s,
        Err((code, detail)) => Snapshot::not_configured(ID, USAGE_URL_ZAI, "public_api").with_error(code, detail),
    }
}

async fn fetch_inner(key: &str, family: &str) -> Result<Snapshot, (String, Option<String>)> {
    let (base, usage_url, allowed): (&str, &str, &[&str]) = if family == "zai" {
        ("https://api.z.ai", USAGE_URL_ZAI, ALLOWED_ZAI)
    } else {
        ("https://open.bigmodel.cn", USAGE_URL_BM, ALLOWED_BM)
    };
    let url = format!("{base}/api/monitor/usage/quota/limit");
    http::assert_allowed(&url, allowed).map_err(|e| ("network_unavailable".to_string(), Some(e)))?;

    let resp = http::client()
        .get(&url)
        .header("Authorization", key) // 裸 key，无 Bearer 前缀（官方插件同源行为）
        .send()
        .await
        .map_err(|e| ("network_unavailable".to_string(), Some(http::redact(&e.to_string()))))?;

    let status = resp.status().as_u16();
    let env: Envelope = resp
        .json()
        .await
        .map_err(|e| ("provider_changed".into(), Some(http::redact(&e.to_string()))))?;

    // HTTP 200 也可能携带错误信封（运行时已复现）——必须检查 body code
    if status == 401 || env.code == 401 {
        return Err(("auth_required".into(), Some(format!("HTTP {status} · code {}", env.code))));
    }
    if env.code != 0 {
        return Err(("unknown".into(), Some(format!("code {} · {}", env.code, http::redact(&env.msg)))));
    }

    let level = env.data.get("level").and_then(|v| v.as_str()).map(|s| s.to_string());
    let mut buckets = vec![];
    if let Some(limits) = env.data.get("limits").and_then(|v| v.as_array()) {
        for (i, l) in limits.iter().enumerate() {
            let ltype = l.get("type").and_then(|v| v.as_str()).unwrap_or("UNKNOWN").to_string();
            let unit = l.get("unit").and_then(|v| v.as_i64()).unwrap_or(-1);
            // Gate A.1 规则：type/unit 语义确认前一律 Custom(raw)，绝不猜测 5h/weekly
            buckets.push(QuotaBucket {
                id: format!("zcode/limit-{i}"),
                label_key: "quota.quota".into(),
                label_raw: None,
                period_type: PeriodType::Custom { raw: format!("{ltype}#unit{unit}") },
                unit: Unit::Percent,
                total: None,
                used: None,
                remaining: l.get("remaining").and_then(|v| v.as_f64()),
                remaining_percent: l.get("percentage").and_then(|v| v.as_f64()).map(|p| 100.0 - p),
                reset_at: l.get("nextResetTime").and_then(epoch_to_iso),
                source: "official".into(),
                confidence: "medium".into(),
            });
        }
    }

    Ok(Snapshot {
        provider_id: ID.into(),
        account_label: None,
        plan_label: level,
        quota_buckets: buckets,
        balances: vec![],
        reset_opportunities: vec![],
        connection_state: "connected".into(),
        error_state: None,
        fetched_at: now_iso(),
        stale: false,
        endpoint_stability: "public_api".into(),
        installation: "not_installed".into(),
        usage_url: usage_url.into(),
    })
}

fn epoch_to_iso(v: &serde_json::Value) -> Option<String> {
    let n = v.as_f64()?;
    // 兼容 epoch 秒与毫秒（zai-rs 同款容错）
    let secs = if n > 1e11 { n / 1000.0 } else { n };
    chrono::DateTime::from_timestamp(secs as i64, 0).map(|d| d.to_rfc3339())
}
