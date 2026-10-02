# DATA_MODEL.md — 统一 Provider 数据模型

> 版本 0.1（Phase 0 / Gate B 评审稿）· 2026-09-28
> 设计目标：**不绑定任何一家 Provider 的套餐结构**。任何 Provider 的任何额度形态都必须能装进这套模型；未知形态必须能无损透传，而不是被模型丢弃。

---

## 1. 设计原则

1. **开放枚举 + 原始值保留**：所有"类型"字段（周期类型、单位、指标种类）都是封闭常用值 + `Custom(原始字符串)` 兜底。Provider 新出的字段组合显示为未知但可见，绝不崩溃、绝不丢弃。
2. **可选优于默认 0**：Provider 不提供的数值一律 `None`。UI 对 `None` 显示"暂无数据"，**绝不显示 0%**（0% 是"耗尽"，语义完全不同）。
3. **每个数据点带来源**：`Source ∈ {Official, Derived, Estimated}` 与整体 `ConnectionState`/`ErrorState` 并存；Estimated 永远不许伪装成 Official。
4. **精度分级**：金钱与积分用十进制（序列化为字符串）；百分比用 0–100 浮点；Estimated 数值 UI 层四舍五入到整数。
5. **快照自包含**：`ProviderSnapshot` 是某一时刻某 Provider 的完整事实，UI 渲染不需要任何 Provider 知识。
6. **凭证零进入**：数据模型中不存在任何凭证字段；账户标识只允许 `account_label`（脱敏，如邮箱打码）与 `credential_id`（凭据管理器条目名）。

---

## 2. 核心类型（Rust 权威定义 / TS 镜像）

### 2.1 ProviderSnapshot

```rust
pub struct ProviderSnapshot {
    pub schema_version: u32,              // 从 1 开始；跨版本迁移依据
    pub provider_id: ProviderId,          // "codex" | "zcode" | "mimo-token-plan" | "mimo-desktop" | "deepseek" | 未来…
    pub account_label: Option<String>,    // 脱敏账户标识（如 "z***@gmail.com"、账户序号）
    pub quota_buckets: Vec<QuotaBucket>,  // 额度桶（可为空：如纯余额型 Provider）
    pub balances: Vec<Balance>,           // 余额（金钱/赠送额）
    pub usage_metrics: Vec<UsageMetric>,  // 历史窗口用量指标（今日/7天/30天）
    pub reset_opportunities: Vec<ResetOpportunity>, // Reset ×N（只监控，永不消费）
    pub connection_state: ConnectionState,
    pub error_state: Option<ErrorState>,  // connection_state 非 Connected 时通常存在
    pub fetched_at: DateTime<Utc>,        // 数据抓取时间（stale 判定基准）
    pub provider_note: Option<I18nKey>,   // 可选的 Provider 级提示（如"重置仅监控"）
}
```

TS 镜像（`src/types/provider.ts`，由 Rust 类型经 ts-rs / specta 生成，**禁止手写漂移**）：

```ts
interface ProviderSnapshot {
  schemaVersion: number;
  providerId: string;
  accountLabel: string | null;
  quotaBuckets: QuotaBucket[];
  balances: Balance[];
  usageMetrics: UsageMetric[];
  resetOpportunities: ResetOpportunity[];
  connectionState: ConnectionState;
  errorState: ErrorState | null;
  fetchedAt: string; // ISO 8601
  providerNote: string | null; // i18n key
}
```

### 2.2 QuotaBucket — 额度桶

```rust
pub struct QuotaBucket {
    pub id: String,               // Provider 内稳定 ID，如 "codex/primary" "zcode/5h-pool" "deepseek/main"
    pub label_key: String,        // i18n 键（如 "quota.rolling_5h"）；Provider 官方套餐名放 label_raw
    pub label_raw: Option<String>,// Provider 官方名称（不翻译，如 "GLM Pro"、"Spark"）
    pub period_type: PeriodType,
    pub unit: Unit,
    pub total: Option<Decimal>,
    pub used: Option<Decimal>,
    pub remaining: Option<Decimal>,
    pub remaining_percent: Option<f64>,   // 0..=100；可由 used/total Derived
    pub window_started_at: Option<DateTime<Utc>>, // 滚动窗口起点（如 5h 池的消耗锚点）
    pub reset_at: Option<DateTime<Utc>>,
    pub source: Source,           // 桶级数据来源
    pub confidence: Confidence,   // High | Medium | Low
}
```

### 2.3 PeriodType — 周期类型（核心反僵化设计）

```rust
pub enum PeriodType {
    Rolling  { window_secs: u32 },  // 5h 滚动 => 18000；不预设只有 5h
    Daily,
    Weekly,
    Monthly,
    BillingCycle,                    // 账期（起止由 reset_at/window_started_at 表达）
    Custom { raw: String },          // 未知/未来类型：原始字符串透传（如 "quarterly"、"per_prompt"）
}
```

- UI 渲染规则：`Rolling` → "滚动 N 小时"；`Daily/Weekly/Monthly` → i18n 标准词；`BillingCycle` → "本账期"；`Custom` → 显示原始字符串（首字母大写），归入"其他"分组。
- 新增已知类型（如季度、年度）的流程：先加枚举 + i18n + UI 分支，属于**框架演进**，不要求 Provider 改动。

### 2.4 Unit — 单位

```rust
pub enum Unit {
    Requests,
    Tokens,
    Credits,                 // Provider 自定义积分（不可跨 Provider 加总）
    Money { currency: String }, // ISO 4217
    Percent,                 // 仅百分比可得时（如 Codex used_percent）
    McpCalls,
    Custom { raw: String },
}
```

**跨 Provider 加总规则**（History 用）：只有 `unit` 与 `metric_kind` 完全一致才可求和。`Credits` 不同 Provider 语义不同，永不跨 Provider 合计。不存在"统一 Token"伪造换算。

### 2.5 Balance / UsageMetric / ResetOpportunity

> **Gate A.1 概念边界**：付费 Credits / balance（余额概念，如 Codex `credits.balance`、DeepSeek 余额）与 Rate Limit Reset Credits（重置机会，如 Codex `rateLimitResetCredits.availableCount`）是**两个独立数据概念**：前者映射 `balances[]`，后者映射 `resetOpportunities[]`。禁止在文档/代码/UI 中把二者混同（不得再写 "Credits = banked rate-limit resets"）。

```rust
pub struct Balance {
    pub id: String,
    pub currency: String,          // ISO 4217
    pub total: Option<Decimal>,
    pub granted: Option<Decimal>,  // 赠金（可能随过期下降，非消耗）
    pub topped_up: Option<Decimal>,
    pub available_flag: Option<bool>, // 如 DeepSeek is_available
    pub source: Source,
}

pub struct UsageMetric {
    pub id: String,
    pub kind: MetricKind,   // Tokens | Credits | Money | Requests | McpCalls | QuotaPercent | Custom(raw)
    pub unit: Unit,
    pub window: MetricWindow, // Today | Days7 | Days30 | BillingCycle | Custom{raw}
    pub value: Decimal,
    pub source: Source,
}

pub struct ResetOpportunity {
    pub id: String,
    pub count: u32,                          // "Reset ×N" 的 N
    pub items: Vec<ResetCreditItem>,         // 明细（可空）
    pub policy: MonitorOnly,                 // 零大小标记类型；编译期表达"只监控"
}

pub struct ResetCreditItem {
    pub expires_at: Option<DateTime<Utc>>,
    pub title_raw: Option<String>,   // Provider 原文
    pub status_raw: Option<String>,
}
```

`MonitorOnly` 设计意图：消费 Reset 的能力在**类型层面不存在**——适配器无法表达"调用消费端点"，代码评审一目了然（开源可审计）。

### 2.6 ConnectionState / InstallationState / ErrorState / Source / Confidence

```rust
pub enum ConnectionState {
    Connected,     // 正常
    Degraded,      // 部分桶缺失/部分数据 stale
    NotConnected,  // 未连接（含未配置；Legacy 名 NotConfigured 等同）
    AuthRequired,  // 需要登录/凭证失效待重配
    Unsupported,   // 暂不支持
    Disconnected,  // 曾配置但无法连接（网络/服务端）
}

/// PORTABLE_FIRST §4：本机 Agent 安装/运行状态是独立维度，与 ConnectionState 严格分离
pub enum InstallationState {
    Installed { running: bool },
    NotInstalled,
    Unknown,
}
```

Portable 规则：任何 `NotInstalled` 不得导致 `Unsupported`——连接能力只由 Remote Account Layer（connectionMethods）决定。

pub struct ErrorState {
    pub code: ErrorCode,
    pub detail: Option<String>,  // 已脱敏的人读细节（如 "HTTP 401"）；严禁含凭证
    pub occurred_at: DateTime<Utc>,
    pub retry_after: Option<Duration>,
}

pub enum ErrorCode {
    NotConfigured, AuthenticationRequired, LoginExpired, Unsupported,
    RateLimited, TemporarilyUnavailable, NetworkUnavailable,
    ProviderChanged, Unknown,
}

pub enum Source { Official, Derived, Estimated }
pub enum Confidence { High, Medium, Low }
```

ErrorCode 与 UI 文案一一对应（见 UI_SPEC §i18n）：

| ErrorCode | 中文 | English |
|---|---|---|
| NotConfigured | 未配置 | Not configured |
| AuthenticationRequired | 需要登录 | Authentication required |
| LoginExpired | 登录已失效 | Login expired |
| Unsupported | 暂不支持 | Unsupported |
| RateLimited | 请求频率受限 | Rate limited |
| TemporarilyUnavailable | 暂时无法连接 | Temporarily unavailable |
| NetworkUnavailable | 网络不可用 | Network unavailable |
| ProviderChanged | Provider 接口可能已变化 | Provider may have changed |
| Unknown | 未知错误 | Unknown error |

**Stale 语义**：stale 不是 ErrorState，而是由 `fetched_at` 相对当前时间与该 Provider 当前调度间隔推导（超过 2×间隔即 stale）。stale 时：数值保留显示 + "Xm 前"角标 + 降低不透明度；**绝不静默冒充实时**。失败但有缓存 → 继续显示缓存值 + stale + 错误角标（如 `67% · 18m 前 · 登录已失效`）。

---

## 3. 本地持久化（SQLite）

位置：`%APPDATA%\AgentQuotaMonitor\quota.db`（rusqlite bundled，WAL 模式）。**任何表都不存凭证。**

```sql
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);

-- 原始快照（脱敏 JSON；保留 7 天，用于诊断与回放）
CREATE TABLE snapshots (
  provider_id TEXT NOT NULL,
  fetched_at  INTEGER NOT NULL,            -- unix ms
  schema_ver  INTEGER NOT NULL,
  payload     TEXT NOT NULL,
  PRIMARY KEY (provider_id, fetched_at)
);

-- 额度桶时间序列（保留 90 天原始 → 之后并入 metric_daily）
CREATE TABLE quota_samples (
  provider_id TEXT NOT NULL,
  bucket_id   TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  remaining_percent REAL,
  used  TEXT, total TEXT,                  -- decimal as text
  unit  TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (provider_id, bucket_id, ts)
);

-- 余额时间序列
CREATE TABLE balance_samples (
  provider_id TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  currency TEXT NOT NULL,
  total TEXT, granted TEXT, topped_up TEXT, -- decimal as text
  available_flag INTEGER,
  PRIMARY KEY (provider_id, ts, currency)
);

-- 日聚合（Today / 7 Days / 30 Days 的数据底座；永久保留）
CREATE TABLE metric_daily (
  provider_id TEXT NOT NULL,
  day    TEXT NOT NULL,                    -- YYYY-MM-DD（本地时区）
  metric_kind TEXT NOT NULL,               // tokens | credits | money | requests | mcp_calls | quota_percent
  unit   TEXT NOT NULL,
  sum TEXT, max TEXT, last TEXT,           -- decimal as text
  PRIMARY KEY (provider_id, day, metric_kind, unit)
);

-- 通知去重状态
CREATE TABLE notification_state (
  provider_id TEXT NOT NULL,
  rule_key TEXT NOT NULL,                  -- 如 "quota<20" "quota<10" "balance<50:CNY"
  last_fired_at INTEGER,
  last_value TEXT,
  PRIMARY KEY (provider_id, rule_key)
);

-- 非敏感 KV（窗口位置、展开状态、主题缓存等）
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE INDEX idx_quota_samples_ts ON quota_samples(provider_id, ts);
CREATE INDEX idx_balance_samples_ts ON balance_samples(provider_id, ts);
```

**保留策略**：`snapshots` 7 天；`quota_samples`/`balance_samples` 原始 90 天，90 天前的并入 `metric_daily` 后删除；`metric_daily` 永久（体积极小）。清理在每日首次成功刷新后执行一次。

---

## 4. 派生与估算规则（Derived / Estimated 边界）

| 场景 | 结果 | 标注 |
|---|---|---|
| `used`/`total` 齐全，缺 percent | `remaining_percent = 100×(total−used)/total` | Derived |
| 仅有 `used_percent`（Codex） | `remaining_percent = 100 − used_percent`；total/remaining 保持 None | Derived |
| ZCode 本机消耗记录近似池消耗（备用通道） | 数值 | Estimated（仅当主通道失效时显示，标注"本机估算"） |
| DeepSeek `is_available=false` | 状态"余额不可用"，不重算 total | Official |
| **两次余额快照差值 → "Today/Monthly spend / Token usage"** | **禁止生成**（差值受充值/赠金过期/退款干扰，属伪数据）；只允许展示 **Balance history / 余额变化** 时间序列 | 规则红线（Gate A.1） |
| 用户手动输入的剩余比例/用量（MiMo Token Plan） | 原样展示 | Manual + Estimated（整数显示） |

规则：**Estimated 数值禁止显示小数**；Derived 与 Official 可按单位精度显示。

---

## 5. 版本与演进

- `schema_version` 随快照持久化；`schema_migrations` 管理库表迁移（只增不破坏，旧数据可丢弃聚合重算）。
- 新 Provider 接入 checklist（数据模型视角）：为每个官方字段找到归属（bucket/balance/metric/reset）或声明丢弃；未知字段进 `Custom`；在 discovery 文档登记映射表。
- 模型评审红线：不允许出现只有某一 Provider 才能解释的字段名；Provider 特异概念一律进 `label_raw` / `Custom` / `provider_note`。
