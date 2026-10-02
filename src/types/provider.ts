// ProviderSnapshot 类型镜像（DATA_MODEL.md 的 TS 面）。
// ⚠️ 本文件下半部分的 PROVIDERS 常量是 **Mock 核心元数据**：正式实现中由 Rust core
// 经 `list_providers` IPC 提供（含 officialUsageUrl），届时本文件仅保留类型定义。
// 因此 Provider 隔离审计（无域名/鉴权逻辑）针对 **UI 组件层**（widget/connect/settings/i18n），
// types/provider.ts 属于 core 边界替身，不在组件层断言范围内。

export type Source = "official" | "derived" | "estimated" | "manual";

export type PeriodType =
  | { kind: "rolling"; windowMins: number }
  | { kind: "daily" | "weekly" | "monthly" | "billing_cycle" }
  | { kind: "custom"; raw: string };

export type Unit =
  | { kind: "requests" | "tokens" | "credits" | "percent" | "mcp_calls" }
  | { kind: "money"; currency: string }
  | { kind: "custom"; raw: string };

export interface QuotaBucket {
  id: string;
  labelKey: string; // i18n key
  labelRaw?: string; // Provider 官方名称（不翻译）
  periodType: PeriodType;
  unit: Unit;
  total?: number;
  used?: number;
  remaining?: number;
  remainingPercent?: number; // 0..=100
  resetAt?: string; // ISO
  source: Source;
  confidence: "high" | "medium" | "low";
}

export interface Balance {
  id: string;
  currency: string;
  total?: number;
  granted?: number;
  toppedUp?: number;
  availableFlag?: boolean;
  source: Source;
}

export interface ResetOpportunity {
  id: string;
  count: number;
  items: { expiresAt?: string; titleRaw?: string }[];
}

export type ConnectionState =
  | "connected"
  | "degraded"
  | "not_connected"
  | "auth_required"
  | "unsupported"
  | "disconnected";

export type ErrorCode =
  | "not_configured"
  | "auth_required"
  | "login_expired"
  | "unsupported"
  | "rate_limited"
  | "temporarily_unavailable"
  | "network_unavailable"
  | "provider_changed"
  | "unknown";

export interface ErrorState {
  code: ErrorCode;
  detail?: string;
  occurredAt: string;
}

export type InstallationState = "installed" | "not_installed" | "unknown";

export interface ProviderSnapshot {
  providerId: string;
  accountLabel?: string;
  planLabel?: string;
  quotaBuckets: QuotaBucket[];
  balances: Balance[];
  resetOpportunities: ResetOpportunity[];
  connectionState: ConnectionState;
  errorState?: ErrorState;
  fetchedAt: string;
  stale?: boolean;
  /** EndpointStability ≠ DataQuality（ADR-005）：数据 Official 的同时接口可以是 Undocumented */
  endpointStability?: "public_api" | "undocumented_first_party" | "reverse_engineered";
  installation?: InstallationState;
  usageUrl: string; // 官方用量页（Open Usage Page）
}

export type ConnectionMethod = "browser_login" | "api_key" | "web_account_session";

export interface ProviderMeta {
  id: string;
  nameKey: string;
  shortName: string; // Collapsed 行显示名
  connectionMethods: ConnectionMethod[];
  localEnhancements: string[];
  endpointStability: ProviderSnapshot["endpointStability"];
  officialUsageUrl: string;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "codex",
    nameKey: "provider.codex.name",
    shortName: "Codex",
    connectionMethods: ["browser_login", "api_key"],
    localEnhancements: ["existing_runtime", "process_activity"],
    endpointStability: "public_api",
    officialUsageUrl: "https://chatgpt.com/codex/settings/usage",
  },
  {
    id: "zcode",
    nameKey: "provider.zcode.name",
    shortName: "ZCode",
    connectionMethods: ["api_key"],
    localEnhancements: ["process_activity"],
    endpointStability: "public_api",
    officialUsageUrl: "https://console.z.ai",
  },
  {
    id: "mimo",
    nameKey: "provider.mimo.name",
    shortName: "MiMo Token Plan",
    connectionMethods: ["web_account_session"],
    localEnhancements: [],
    endpointStability: "undocumented_first_party",
    officialUsageUrl: "https://platform.xiaomimimo.com/#/console/plan-manage",
  },
  {
    id: "workbuddy",
    nameKey: "provider.workbuddy.name",
    shortName: "WorkBuddy",
    connectionMethods: ["web_account_session"],
    localEnhancements: [],
    endpointStability: "undocumented_first_party",
    officialUsageUrl: "https://www.workbuddy.cn/profile/plans-usage",
  },
  {
    id: "deepseek",
    nameKey: "provider.deepseek.name",
    shortName: "DeepSeek",
    connectionMethods: ["api_key"],
    localEnhancements: [],
    endpointStability: "public_api",
    officialUsageUrl: "https://platform.deepseek.com/usage",
  },
];

export function metaOf(id: string): ProviderMeta {
  return PROVIDERS.find((p) => p.id === id)!;
}
