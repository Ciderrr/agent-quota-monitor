import type { QuotaBucket, Balance } from "../types/provider";

export type Level = "normal" | "warn" | "crit";
export function levelOf(remainingPercent: number | undefined): Level {
  if (remainingPercent === undefined) return "normal";
  if (remainingPercent < 10) return "crit";
  if (remainingPercent < 20) return "warn";
  return "normal";
}

export function timeUntil(iso: string | undefined, lang: "zh" | "en"): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return lang === "zh" ? "已到期" : "expired";
  const m = Math.round(ms / 60000);
  const h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d >= 1) return lang === "zh" ? (h % 24 > 0 ? `${d}天${h % 24}小时` : `${d}天`) : (h % 24 > 0 ? `${d}d ${h % 24}h` : `${d}d`);
  if (h >= 1) return lang === "zh" ? `${h}小时${m % 60}分` : `${h}h ${m % 60}m`;
  return lang === "zh" ? `${m}分钟` : `${m}m`;
}

export function updatedAgo(iso: string, lang: "zh" | "en"): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return lang === "zh" ? "刚刚更新" : "Updated just now";
  const label = lang === "zh" ? `${m}分钟前更新` : `Updated ${m}m ago`;
  return label;
}

export function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.trunc(n));
}

/**
 * ③ 代表桶选择（用户实测反馈）：显示优先级与「谁最危急」是两回事——
 * gpt-reserve 剩 0% 是常态，绝不能因为 0% 就顶到折叠卡首页。
 * 规则：聚合桶（id 以 /all 结尾，多积分包合计）最优先；其次 5h 滚动窗 > 月度 > 周/账期 > 其他；
 * reserve 类永远垫底（仅当别无选择才显示）。同优先级内取剩余最少。
 */
const RESERVE_RE = /reserve/i;

export function isReserveBucket(b: QuotaBucket): boolean {
  return RESERVE_RE.test(b.id) || (!!b.labelRaw && RESERVE_RE.test(b.labelRaw));
}

export function isAggregateBucket(b: QuotaBucket): boolean {
  return b.id.endsWith("/all");
}

function bucketPriority(b: QuotaBucket): number {
  if (isAggregateBucket(b)) return -1;
  if (isReserveBucket(b)) return 90;
  switch (b.periodType.kind) {
    case "rolling": return 0;
    case "monthly": return 10;
    case "daily": return 15;
    case "weekly":
    case "billing_cycle": return 20;
    default: return b.unit.kind === "credits" ? 80 : 50;
  }
}

export function pickPrimaryBucket(buckets: QuotaBucket[]): QuotaBucket | undefined {
  const cands = buckets.filter((b) => b.remainingPercent !== undefined);
  if (cands.length === 0) return undefined;
  const agg = cands.find(isAggregateBucket);
  if (agg) return agg;
  // reserve 类只在别无选择时才有机会成为代表桶
  const normal = cands.filter((b) => !isReserveBucket(b));
  const pool = normal.length > 0 ? normal : cands;
  return pool.reduce((a, b) => {
    const pa = bucketPriority(a);
    const pb = bucketPriority(b);
    if (pa !== pb) return pa < pb ? a : b;
    return a.remainingPercent! <= b.remainingPercent! ? a : b;
  });
}

/** Collapsed 主数值 */
export function primaryValue(s: { quotaBuckets: QuotaBucket[]; balances: Balance[] }): { text: string; percent?: number; isMoney?: boolean } {
  const primary = pickPrimaryBucket(s.quotaBuckets);
  if (primary?.remainingPercent !== undefined) {
    return { text: `${Math.round(primary.remainingPercent)}%`, percent: primary.remainingPercent };
  }
  const bal = s.balances[0];
  if (bal && bal.total !== undefined) {
    const sym = bal.currency === "CNY" ? "¥" : bal.currency === "USD" ? "$" : "";
    const n = bal.total ?? 0;
    return { text: `${sym}${n.toFixed(2)}`, isMoney: true };
  }
  return { text: "" };
}

/** Collapsed 副标题：主桶标签 + 倒计时 */
export function primarySub(s: { quotaBuckets: QuotaBucket[]; balances: Balance[] }, t: (k: any, p?: any) => string, lang: "zh" | "en"): string {
  const primary = pickPrimaryBucket(s.quotaBuckets);
  if (primary?.remainingPercent !== undefined) {
    const label = bucketLabel(primary, t);
    const reset = primary.resetAt ? timeUntil(primary.resetAt, lang) : "";
    return reset ? `${label} · ${t("reset.in", { time: reset })}` : label;
  }
  if (s.balances[0]) return t("balance.main");
  return "";
}

export function bucketLabel(b: QuotaBucket, t: (k: any, p?: any) => string): string {
  if (b.labelRaw) return b.labelRaw;
  return t(b.labelKey);
}

export function money(v: number | null | undefined, currency: string): string {
  const n = v ?? 0;
  const sym = currency === "CNY" ? "¥" : currency === "USD" ? "$" : `${currency} `;
  return `${sym}${n.toFixed(2)}`;
}
