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

/** Collapsed 主数值 */
export function primaryValue(s: { quotaBuckets: QuotaBucket[]; balances: Balance[] }): { text: string; percent?: number; isMoney?: boolean } {
  const pctBuckets = s.quotaBuckets.filter((b) => b.remainingPercent !== undefined);
  if (pctBuckets.length > 0) {
    const worst = pctBuckets.reduce((a, b) => (a.remainingPercent! <= b.remainingPercent! ? a : b));
    return { text: `${Math.round(worst.remainingPercent!)}%`, percent: worst.remainingPercent };
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
  const pctBuckets = s.quotaBuckets.filter((b) => b.remainingPercent !== undefined);
  if (pctBuckets.length > 0) {
    const worst = pctBuckets.reduce((a, b) => (a.remainingPercent! <= b.remainingPercent! ? a : b));
    const label = bucketLabel(worst, t);
    const reset = worst.resetAt ? timeUntil(worst.resetAt, lang) : "";
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
