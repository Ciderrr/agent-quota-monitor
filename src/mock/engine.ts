// Mock Provider Engine（Gate C 专用）—— 实现 PlatformBridge 同款数据面；
// release 构建剔除。所有数据为演示用 Mock，不代表真实账户。
import type { ProviderSnapshot, ProviderMeta } from "../types/provider";
import { PROVIDERS } from "../types/provider";

export type Scenario =
  | "default" // 四家全部正常
  | "issues" // 过期 / stale / 未配置 混合态
  | "low" // Codex 低额度
  | "empty"; // 全部未启用

export interface HistoryPoint { day: string; value: number }
export interface HistorySeries {
  providerId: string;
  kind: "quota_percent" | "tokens" | "credits" | "money";
  unitLabelKey: string;
  today: number;
  points: HistoryPoint[]; // 30 天
  extra?: { labelKey: string; value: string }[];
}

const MINS = 60_000, HOURS = 60 * MINS, DAYS = 24 * HOURS;

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function base(id: string): ProviderSnapshot {
  const meta = PROVIDERS.find((p) => p.id === id)!;
  return {
    providerId: id,
    quotaBuckets: [],
    balances: [],
    resetOpportunities: [],
    connectionState: "connected",
    fetchedAt: iso(-38_000),
    endpointStability: meta.endpointStability,
    installation: "not_installed",
    usageUrl: meta.officialUsageUrl,
  };
}

function codexSnap(used5h: number, usedWeekly: number, usedReserve: number): ProviderSnapshot {
  const s = base("codex");
  s.accountLabel = "••••@outlook.com";
  s.planLabel = "Plus";
  s.quotaBuckets = [
    { id: "codex/primary", labelKey: "period.rolling_5h", periodType: { kind: "rolling", windowMins: 300 }, unit: { kind: "percent" },
      remainingPercent: 100 - used5h, resetAt: iso(3 * HOURS + 12 * MINS), source: "official", confidence: "high" },
    { id: "codex/secondary", labelKey: "period.weekly", periodType: { kind: "weekly" }, unit: { kind: "percent" },
      remainingPercent: 100 - usedWeekly, resetAt: iso(4 * DAYS + 2 * HOURS), source: "official", confidence: "high" },
    { id: "codex/base_model_inference", labelRaw: "GPT Reserve", labelKey: "quota.custom", periodType: { kind: "weekly" }, unit: { kind: "percent" },
      remainingPercent: 100 - usedReserve, resetAt: iso(6 * DAYS), source: "official", confidence: "high" },
  ];
  s.resetOpportunities = [
    { id: "codex/resets", count: 2, items: [
      { expiresAt: iso(30 * DAYS), titleRaw: "Full reset (Weekly + 5 hr)" },
      { expiresAt: iso(19 * DAYS), titleRaw: "Full reset (Weekly + 5 hr)" },
    ] },
  ];
  return s;
}

function zcodeSnap(): ProviderSnapshot {
  const s = base("zcode");
  s.accountLabel = "GLM Coding Plan · Pro";
  s.planLabel = "GLM Pro";
  s.quotaBuckets = [
    { id: "zcode/5h-pool", labelKey: "period.rolling_5h", periodType: { kind: "rolling", windowMins: 300 }, unit: { kind: "percent" },
      remainingPercent: 81, resetAt: iso(2 * HOURS + 41 * MINS), source: "official", confidence: "high" },
    { id: "zcode/weekly-pool", labelKey: "period.weekly", periodType: { kind: "weekly" }, unit: { kind: "percent" },
      remainingPercent: 64, resetAt: iso(5 * DAYS), source: "official", confidence: "high" },
  ];
  return s;
}

function mimoSnap(): ProviderSnapshot {
  const s = base("mimo");
  s.accountLabel = "MiMo Account";
  // 对齐用户真实账户：Standard 月度套餐，本期至 2026-10-23（Gate C 反馈修正）；
  // 剩余比例仍为 Mock 值，待 harness 登录态 fixture 后替换为真实读取。
  s.planLabel = "Standard";
  s.quotaBuckets = [
    { id: "mimo/monthly-credits", labelKey: "period.monthly", periodType: { kind: "monthly" }, unit: { kind: "credits" },
      total: 11_000_000_000, used: 3_630_000_000, remaining: 7_370_000_000, remainingPercent: 67,
      resetAt: "2026-10-23T00:00:00", source: "official", confidence: "high" },
  ];
  return s;
}

function deepseekSnap(): ProviderSnapshot {
  const s = base("deepseek");
  s.accountLabel = "DeepSeek API";
  s.balances = [
    { id: "deepseek/main", currency: "CNY", total: 53.27, granted: 3.27, toppedUp: 50.0, availableFlag: true, source: "official" },
  ];
  return s;
}

function withError(s: ProviderSnapshot, code: ProviderSnapshot["errorState"] extends undefined ? never : NonNullable<ProviderSnapshot["errorState"]>): ProviderSnapshot {
  return { ...s, errorState: code };
}

export function buildScenario(scenario: Scenario): Record<string, ProviderSnapshot> {
  const map: Record<string, ProviderSnapshot> = {};
  if (scenario === "low") {
    map["codex"] = codexSnap(92, 60, 30);
    map["zcode"] = zcodeSnap();
    map["mimo"] = mimoSnap();
    map["deepseek"] = deepseekSnap();
  } else if (scenario === "issues") {
    const codex = codexSnap(28, 57, 6);
    codex.connectionState = "auth_required";
    codex.errorState = { code: "login_expired", detail: "HTTP 401", occurredAt: iso(-17 * MINS) };
    map["codex"] = codex;
    const zcode = zcodeSnap();
    zcode.stale = true;
    zcode.fetchedAt = iso(-18 * MINS);
    zcode.connectionState = "degraded";
    zcode.errorState = { code: "temporarily_unavailable", detail: "HTTP 503", occurredAt: iso(-1 * MINS) };
    map["zcode"] = zcode;
    map["mimo"] = mimoSnap();
    const ds = base("deepseek");
    ds.connectionState = "not_connected";
    ds.errorState = { code: "not_configured", occurredAt: iso(0) };
    map["deepseek"] = ds;
  } else if (scenario === "empty") {
    for (const p of PROVIDERS) {
      const s = base(p.id);
      s.connectionState = "not_connected";
      s.errorState = { code: "not_configured", occurredAt: iso(0) };
      map[p.id] = s;
    }
  } else {
    map["codex"] = codexSnap(10, 24, 6);
    map["zcode"] = zcodeSnap();
    map["mimo"] = mimoSnap();
    map["deepseek"] = deepseekSnap();
  }
  return map;
}

export function buildHistory(): HistorySeries[] {
  // 各序列终点与 today 值严格一致（History 不得自相矛盾）
  const days = (n: number, gen: (i: number) => number): HistoryPoint[] =>
    Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.now() - (29 - i) * DAYS);
      return { day: `${d.getMonth() + 1}/${d.getDate()}`, value: gen(i) };
    }).slice(-n);
  const endingAt = (today: number, step: number, wig: number) => (i: number) =>
    Math.max(0, today - (29 - i) * step + ((i * 37) % 11) * wig);
  return [
    { providerId: "codex", kind: "quota_percent", unitLabelKey: "history.quota_percent", today: 34,
      points: days(30, endingAt(34, 1.1, 0.8)), extra: [{ labelKey: "history.window", value: "5h + weekly" }] },
    { providerId: "zcode", kind: "tokens", unitLabelKey: "history.tokens", today: 1_284_500,
      points: days(30, endingAt(1_284_500, 38_000, 60_000)) },
    { providerId: "mimo", kind: "credits", unitLabelKey: "history.credits", today: 412_300_000,
      points: days(30, endingAt(412_300_000, 11_000_000, 18_000_000)) },
    { providerId: "deepseek", kind: "money", unitLabelKey: "history.balance", today: 53.27,
      points: days(30, endingAt(53.27, 1.2, 0.35)) },
  ];
}

type Listener = () => void;

class MockEngine {
  scenario: Scenario = "default";
  disabled = new Set<string>();
  /** 默认视图（Portable-first 设置项；正式实现持久化到设置库） */
  defaultView: "collapsed" | "overview" = "collapsed";
  private snaps = buildScenario("default");
  private history = buildHistory();
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() { this.listeners.forEach((f) => f()); }

  setDefaultView(v: "collapsed" | "overview") { this.defaultView = v; this.emit(); }

  getSnapshots(): ProviderSnapshot[] {
    return PROVIDERS.filter((p) => !this.disabled.has(p.id)).map((p) => this.snaps[p.id]).filter(Boolean);
  }
  getSnapshot(id: string): ProviderSnapshot | undefined { return this.snaps[id]; }
  getHistory(): HistorySeries[] { return this.history; }
  isEnabled(id: string): boolean { return !this.disabled.has(id); }

  setScenario(s: Scenario) { this.scenario = s; this.snaps = buildScenario(s); this.emit(); }
  setEnabled(id: string, on: boolean) { on ? this.disabled.delete(id) : this.disabled.add(id); this.emit(); }
  refreshNow(id?: string) {
    const targets = id ? [this.snaps[id]] : Object.values(this.snaps);
    targets.forEach((s) => { if (s) { s.fetchedAt = iso(0); s.stale = false; } });
    this.emit();
  }
  /** Connect 流程的 Mock 完成：把 provider 变成 connected */
  markConnected(id: string) {
    this.snaps[id] = buildScenario("default")[id];
    this.disabled.delete(id);
    this.emit();
  }
}

export const engine = new MockEngine();
