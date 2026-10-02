// DTO 定义 —— 与 src/types/provider.ts 的 TS 镜像同形（Gate D 阶段手工同步；
// Phase 3 引入 ts-rs/specta 生成以杜绝漂移）。
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum PeriodType {
    Rolling { window_mins: u32 },
    Daily,
    Weekly,
    Monthly,
    BillingCycle,
    Custom { raw: String },
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum Unit {
    Requests,
    Tokens,
    Credits,
    Money { currency: String },
    Percent,
    McpCalls,
    Custom { raw: String },
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QuotaBucket {
    pub id: String,
    pub label_key: String,
    pub label_raw: Option<String>,
    pub period_type: PeriodType,
    pub unit: Unit,
    pub total: Option<f64>,
    pub used: Option<f64>,
    pub remaining: Option<f64>,
    pub remaining_percent: Option<f64>,
    pub reset_at: Option<String>,
    pub source: String,
    pub confidence: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BalanceDto {
    pub id: String,
    pub currency: String,
    pub total: Option<f64>,
    pub granted: Option<f64>,
    pub topped_up: Option<f64>,
    pub available_flag: Option<bool>,
    pub source: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResetItem {
    pub expires_at: Option<String>,
    pub title_raw: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResetOpportunity {
    pub id: String,
    pub count: u32,
    pub items: Vec<ResetItem>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ErrorState {
    pub code: String,
    pub detail: Option<String>,
    pub occurred_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub provider_id: String,
    pub account_label: Option<String>,
    pub plan_label: Option<String>,
    pub quota_buckets: Vec<QuotaBucket>,
    pub balances: Vec<BalanceDto>,
    pub reset_opportunities: Vec<ResetOpportunity>,
    pub connection_state: String,
    pub error_state: Option<ErrorState>,
    pub fetched_at: String,
    pub stale: bool,
    pub endpoint_stability: String,
    pub installation: String,
    pub usage_url: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderMetaDto {
    pub id: String,
    pub name_key: String,
    pub short_name: String,
    pub connection_methods: Vec<String>,
    pub local_enhancements: Vec<String>,
    pub endpoint_stability: String,
    pub official_usage_url: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPoint {
    pub day: String,
    pub value: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistorySeries {
    pub provider_id: String,
    pub kind: String,
    pub unit_label_key: String,
    pub today: f64,
    pub points: Vec<HistoryPoint>,
    pub extra: Vec<HistoryExtra>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryExtra {
    pub label_key: String,
    pub value: String,
}

impl Snapshot {
    pub fn not_configured(provider_id: &str, usage_url: &str, endpoint_stability: &str) -> Self {
        Self {
            provider_id: provider_id.into(),
            account_label: None,
            plan_label: None,
            quota_buckets: vec![],
            balances: vec![],
            reset_opportunities: vec![],
            connection_state: "not_connected".into(),
            error_state: Some(ErrorState {
                code: "not_configured".into(),
                detail: None,
                occurred_at: now_iso(),
            }),
            fetched_at: now_iso(),
            stale: false,
            endpoint_stability: endpoint_stability.into(),
            installation: "not_installed".into(),
            usage_url: usage_url.into(),
        }
    }

    pub fn with_error(mut self, code: String, detail: Option<String>) -> Self {
        self.connection_state = match code.as_str() {
            "auth_required" | "login_expired" => "auth_required".to_string(),
            "network_unavailable" | "temporarily_unavailable" | "provider_changed" => "disconnected".to_string(),
            "rate_limited" => "degraded".to_string(),
            _ => self.connection_state.clone(),
        };
        self.error_state = Some(ErrorState { code, detail, occurred_at: now_iso() });
        self
    }
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}
