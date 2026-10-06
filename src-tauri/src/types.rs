// DTO 定义 —— 与 src/types/provider.ts 的 TS 镜像同形（Gate D 阶段手工同步；
// Phase 3 引入 ts-rs/specta 生成以杜绝漂移）。
use serde::{Deserialize, Serialize};

/// 迁移默认账号：旧数据/单账号路径恒用它（凭据仍读旧槽位，零迁移）
pub const MAIN_ACCOUNT: &str = "main";

/// 运行态/存储键："{provider_id}/{account_id}"。provider_id 不含 '/'，可 rsplit 还原。
pub fn instance_key(provider_id: &str, account_id: &str) -> String {
    format!("{provider_id}/{account_id}")
}

/// 同 Provider 的一个账号实例（v0.4 多账号）。P1 阶段 enabled 暂不消费
/// （总闸仍是 Provider 级），账号级开关随 P3 设置页启用。
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AccountInstance {
    pub provider_id: String,
    pub account_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub enabled: bool,
}

impl AccountInstance {
    pub fn key(&self) -> String {
        instance_key(&self.provider_id, &self.account_id)
    }
}

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label_raw: Option<String>,
    pub period_type: PeriodType,
    pub unit: Unit,
    // Option 字段缺失即缺数据：序列化成 null 会被前端 `!== undefined` 误当成有效值，
    // 渲染出无意义的 "0/0"（用户实测），故跳过 null 字段
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
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
    /// 所属账号实例；None = 旧持久化数据，按 main 处理
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
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
            account_id: None,
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

    pub fn with_account(mut self, account: &str) -> Self {
        self.account_id = Some(account.to_string());
        self
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
