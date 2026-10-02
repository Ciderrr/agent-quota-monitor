import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { bridge, isTauri } from "../bridge/bridge";
import type { HistorySeries } from "../mock/engine";
import { metaOf } from "../types/provider";
import { useI18n } from "../i18n";
import { compact, money } from "../ui/format";

type Range = "today" | "7d" | "30d";

export function HistoryPanel({ providerId }: { providerId?: string }) {
  const { t } = useI18n();
  const [series, setSeries] = useState<HistorySeries[]>([]);
  const [range, setRange] = useState<Range>("7d");
  // 额度型 Provider（非 DeepSeek）：用真实壳的 snapshots 存档渲染
  const isQuota = providerId != null && providerId !== "deepseek";

  useEffect(() => {
    if (isQuota && isTauri) {
      const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
      invoke<HistorySeries[]>("get_quota_history", { providerId, days })
        .then((list) => setSeries(list.filter((s) => s.points.length > 0)))
        .catch(() => setSeries([]));
      return;
    }
    bridge.getHistory()
      .then((all) => {
        const list = providerId ? all.filter((s) => s.providerId === providerId) : all;
        setSeries(list);
      })
      .catch(() => setSeries([]));
  }, [providerId, isQuota, range]);

  return (
    <div>
      <div className="seg hist-range" role="tablist">
        {(["today", "7d", "30d"] as Range[]).map((r) => (
          <button key={r} className={range === r ? "on" : ""} role="tab" aria-selected={range === r}
            onClick={() => setRange(r)}>
            {t(("history." + r) as any)}
          </button>
        ))}
      </div>
      {series.length === 0 && <p className="helper quiet">{t("history.empty")}</p>}
      {series.map((s) => {
        const bucketTitle = s.extra?.[0]?.value;
        return (
          <div className="hist-group" key={s.providerId + s.kind + (bucketTitle ?? "")}>
            <h4>
              {t(metaOf(s.providerId).nameKey as any)}
              {bucketTitle ? ` · ${bucketTitle}` : ""}
              {" · "}
              {t(s.unitLabelKey as any)}
            </h4>
            <HistRow series={s} range={range} />
            {s.kind === "money" && range !== "today" && <p className="note">{t("history.balance_note")}</p>}
          </div>
        );
      })}
    </div>
  );
}

function HistRow({ series: s, range }: { series: HistorySeries; range: Range }) {
  const { t, lang } = useI18n();
  const fmt = (v: number) => s.kind === "money" ? money(v, "CNY") : s.kind === "quota_percent" ? `${Math.round(v)}%` : compact(v);

  if (range === "today") {
    return (
      <div className="kv" style={{ padding: "6px 0" }}>
        <span>{t("history.today")}</span>
        <b style={{ fontSize: 14 }}>{fmt(s.today)}</b>
      </div>
    );
  }

  const n = range === "7d" ? 7 : 30;
  const pts = s.points.slice(-n);
  if (pts.length === 0) {
    return <p className="helper quiet">{t("history.empty")}</p>;
  }
  const max = Math.max(...pts.map((p) => p.value), 0.0001);
  const min = Math.min(...pts.map((p) => p.value));
  const last = pts[pts.length - 1];

  if (s.kind === "money") {
    // 余额：折线（如实呈现变化，不做消费推算）
    const w = 100, h = 34;
    const px = (i: number) => (pts.length <= 1 ? w / 2 : (i / (pts.length - 1)) * w);
    const py = (v: number) => h - 3 - ((v - min) / (max - min || 1)) * (h - 8);
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(2)},${py(p.value).toFixed(2)}`).join(" ");
    return (
      <div className="hist-row">
        <span className="name">{range === "7d" ? t("history.7d") : t("history.30d")}</span>
        <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
          <path d={d} fill="none" stroke="var(--bar-fill)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={px(pts.length - 1)} cy={py(last.value)} r="2" fill="var(--fg)" />
        </svg>
        <span className="val">{fmt(last.value)}</span>
      </div>
    );
  }

  // 额度剩余率：水位图（面积填充到 0 基线，0–100% 固定刻度——
  // 填充多=剩余多，一眼即懂，无需文字说明）
  if (s.kind === "quota_percent") {
    const w = 100, h = 40;
    const px = (i: number) => (pts.length <= 1 ? w / 2 : (i / (pts.length - 1)) * w);
    // 固定 0–100 刻度：位置即含义（顶=满，底=用尽）
    const py = (v: number) => h - 3 - (Math.max(0, Math.min(100, v)) / 100) * (h - 6);
    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(2)},${py(p.value).toFixed(2)}`).join(" ");
    const area = `${line} L${px(pts.length - 1).toFixed(2)},${h - 2} L${px(0).toFixed(2)},${h - 2} Z`;
    return (
      <div className="hist-row">
        <span className="name">{range === "7d" ? t("history.7d") : t("history.30d")}</span>
        <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
          {/* 100% 满格参考线 */}
          <line x1="0" y1={py(100)} x2={w} y2={py(100)} stroke="var(--hairline)" strokeWidth="0.8" strokeDasharray="2 2" />
          {/* 剩余量水位 */}
          <path d={area} fill="var(--bar-fill)" opacity="0.22" />
          <path d={line} fill="none" stroke="var(--bar-fill)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={px(pts.length - 1)} cy={py(last.value)} r="2" fill="var(--fg)" />
        </svg>
        <span className="val">{fmt(last.value)}</span>
      </div>
    );
  }

  return (
    <div className="hist-row">
      <span className="name">{range === "7d" ? t("history.7d") : t("history.30d")}</span>
      <div className="hist-bars" aria-hidden>
        {pts.map((p, i) => (
          <i key={i} className={i === pts.length - 1 ? "today" : ""} style={{ height: `${Math.max(6, (p.value / max) * 100)}%` }} />
        ))}
      </div>
      <span className="val">{fmt(last.value)}</span>
    </div>
  );
}
