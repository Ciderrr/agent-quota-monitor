import { useEffect, useState } from "react";
import type { ProviderSnapshot, QuotaBucket, Insights, BucketPrediction } from "../types/provider";
import { metaOf } from "../types/provider";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../bridge";
import { useI18n } from "../i18n";
import {
  bucketLabel, levelOf, timeUntil, updatedAgo, money, compact,
  pickPrimaryBucket, isAggregateBucket, formatDate,
} from "../ui/format";
import { IconBack, IconRefresh, IconExternal, IconHistory, IconCollapse, IconSettings } from "../ui/icons";
import { GlassSurface } from "../ui/GlassSurface";
import { HistoryPanel } from "./HistoryPanel";

export function ExpandedWidget({
  snapshots, insights, view, detailId, onBack, onBackHistory, onOpenDetail, onShowHistory, onRefresh, lastAllUpdated, onCollapse, showCollapse, onOpenSettings,
}: {
  snapshots: ProviderSnapshot[];
  /** v0.2 洞察（真实壳）；浏览器原型为 null → 预测/建议不显示 */
  insights: Insights | null;
  view: "overview" | "detail" | "history";
  detailId?: string;
  onBack: () => void;
  onBackHistory: () => void;
  onOpenDetail: (id: string) => void;
  onShowHistory: () => void;
  onRefresh: (id?: string) => void;
  lastAllUpdated: string;
  onCollapse: () => void;
  showCollapse: boolean;
  onOpenSettings: (section?: string) => void;
}) {
  const { t, lang } = useI18n();

  if (view === "history") {
    return (
      <GlassSurface className="glass expanded" data-widget>
        <div className="x-head">
          <button className="x-back" aria-label={t("action.back")} onClick={onBackHistory}><IconBack /></button>
          <div className="x-title">{t("history.title")}</div>
        </div>
        <div className="x-body">
            <HistoryPanel providerId={detailId} />
        </div>
        <Foot meta={updatedAgo(lastAllUpdated, lang)} onRefresh={() => onRefresh()} refreshLabel={t("action.refresh")} />
      </GlassSurface>
    );
  }

  if (view === "detail" && detailId) {
    const s = snapshots.find((x) => x.providerId === detailId);
    if (!s) return null;
    const meta = metaOf(detailId);
    // 会话型 Provider 登录失效时隐藏「打开官方用量页」：浏览器打开官方页
    // 并不会让本程序重新登录，只会误导用户（用户实测反馈）
    const sessionLogin = detailId === "mimo" || detailId === "workbuddy";
    const hasErr = s.connectionState === "not_connected" || s.connectionState === "auth_required" || s.connectionState === "disconnected";
    const showOpenUsage = !(sessionLogin && hasErr);
    return (
      <GlassSurface className="glass expanded" data-widget>
        <div className="x-head">
          <button className="x-back" aria-label={t("nav.all_providers")} title={t("nav.all_providers")} onClick={onBack}><IconBack /></button>
          <div className="x-title">{t(meta.nameKey as any)}</div>
          <button className="icon-btn" aria-label={t("tray.settings")} title={t("tray.settings")} onClick={() => onOpenSettings()}><IconSettings /></button>
          <button className="icon-btn" aria-label={t("action.history")} onClick={onShowHistory}><IconHistory /></button>
        </div>
        <div className="x-body">
          <ProviderDetail snapshot={s} insights={insights} onOpenSettings={onOpenSettings} />
        </div>
        <Foot
          meta={updatedAgo(s.fetchedAt, lang)}
          onRefresh={() => onRefresh(detailId)}
          refreshLabel={t("action.refresh")}
          refreshNode={
            <DetailRefreshButton
              providerId={detailId}
              onRefresh={() => onRefresh(detailId)}
              label={t("action.refresh")}
            />
          }
          extra={showOpenUsage ? <button
            className="foot-btn"
            onClick={() => {
              if (isTauri) invoke("open_external", { url: meta.officialUsageUrl }).catch(() => {});
              else window.open(meta.officialUsageUrl, "_blank");
            }}
          >{t("action.open_usage")}</button> : undefined}
        />
      </GlassSurface>
    );
  }

  // overview
  return (
    <GlassSurface className="glass expanded" data-widget>
      <div className="x-head">
        {showCollapse && (
          <button className="x-back x-collapse" aria-label={t("collapse")} title={t("collapse")} onClick={onCollapse}><IconCollapse /></button>
        )}
        <div className="x-title">{t("app.name")}</div>
        <button className="icon-btn" aria-label={t("tray.settings")} title={t("tray.settings")} onClick={() => onOpenSettings()}><IconSettings /></button>
      </div>
      <div className="x-body">
        {snapshots.map((s) => (
          <OverviewBlock key={s.providerId} s={s} onOpen={() => onOpenDetail(s.providerId)} />
        ))}
      </div>
      <Foot meta={updatedAgo(lastAllUpdated, lang)} onRefresh={() => onRefresh()} refreshLabel={t("action.refresh")} />
      </GlassSurface>
    );
  }

function Foot({ meta, onRefresh, refreshLabel, extra, refreshNode }: {
  meta: string; onRefresh: () => void; refreshLabel: string; extra?: React.ReactNode; refreshNode?: React.ReactNode;
}) {
  return (
    <div className="x-foot">
      <span className="meta">{meta}</span>
      {extra}
      {refreshNode ?? (
        <button className="icon-btn" aria-label={refreshLabel} onClick={onRefresh}><IconRefresh /></button>
      )}
    </div>
  );
}

/** ④ 详情页刷新按钮（用户实测反馈）：按了必须立刻有反应——busy 转圈直到该 Provider
 *  快照真正更新（snapshot-updated 事件）或超时；会话型读取最长 30–45s 也不再是无声等待 */
function DetailRefreshButton({ providerId, onRefresh, label }: {
  providerId: string; onRefresh: () => void; label: string;
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!busy) return;
    let un: (() => void) | undefined;
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      setBusy(false);
      un?.();
    };
    if (isTauri) {
      listen<{ providerId?: string }>("snapshot-updated", (e) => {
        const pid = e.payload?.providerId;
        if (!pid || pid === providerId || pid === "all") finish();
      }).then((f) => { un = f; }).catch(() => {});
    }
    const to = setTimeout(finish, 45000);
    return () => { closed = true; clearTimeout(to); un?.(); };
  }, [busy, providerId]);
  return (
    <button
      className="icon-btn"
      aria-label={label}
      onClick={() => { if (!busy) { setBusy(true); onRefresh(); } }}
    >
      {busy ? <span className="spinner" /> : <IconRefresh />}
    </button>
  );
}

function OverviewBlock({ s, onOpen }: { s: ProviderSnapshot; onOpen: () => void }) {
  const { t, lang } = useI18n();
  const meta = metaOf(s.providerId);
  const buckets = s.quotaBuckets.filter((b) => b.remainingPercent !== undefined);
  const primary = pickPrimaryBucket(buckets);
  // ②3：存在聚合桶（积分包合计）时，列表行只展示合计；逐包明细留给详情页
  const rest = buckets.some(isAggregateBucket)
    ? []
    : buckets.filter((b) => b !== primary);
  const bal = s.balances[0];
  const hasErr = s.connectionState === "not_connected" || s.connectionState === "auth_required" || s.connectionState === "unsupported" || s.connectionState === "disconnected";

  return (
    <div
      className={`provider-block focusable ${s.stale ? "stale" : ""}`} tabIndex={0}
      onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()}
      aria-label={t(meta.nameKey as any)}
    >
      <div className="pb-head">
        <span className="pb-name">{t(meta.nameKey as any)}</span>
        {s.planLabel && <span className="pb-plan">{s.planLabel}</span>}
      </div>
      {hasErr ? (
        <>
          {primary ? (
            <div className="pb-main" style={{ opacity: 0.55 }}>
              <span className="pb-num num">{Math.round(primary.remainingPercent!)}<small>%</small></span>
              <span className="pb-reset">{primary.resetAt ? t("reset.in", { time: timeUntil(primary.resetAt, lang) }) : ""}</span>
            </div>
          ) : null}
          <div className="err-line">
            <span className={`dot ${s.connectionState === "auth_required" ? "err" : ""}`} />
            {t(("error." + (s.errorState?.code ?? "unknown")) as any)}
            {s.errorState && (s.errorState.code === "login_expired" || s.errorState.code === "auth_required") && (
              <button className="link-btn" onClick={(e) => { e.stopPropagation(); onOpen(); }}>{t("action.reconnect")}</button>
            )}
          </div>
        </>
      ) : primary ? (
        <>
          <div className="pb-main">
            <span className={`pb-num num ${levelOf(primary.remainingPercent)}-text`}>
              {Math.round(primary.remainingPercent!)}<small>%</small>
            </span>
            <span className="pb-reset">
              {primary.resetAt ? t("reset.in", { time: timeUntil(primary.resetAt, lang) }) : ""}
            </span>
          </div>
          <div className={`bar ${levelOf(primary.remainingPercent)}`} aria-hidden>
            <i style={{ width: `${primary.remainingPercent}%` }} />
          </div>
          <div className="pb-rows">
            {primary.used !== undefined && primary.total !== undefined && (
              <>
                <span className="k">{t("quota.used")}</span>
                <span className="v num">{compact(primary.used)} / {compact(primary.total)}{primary.unit.kind === "credits" ? " Credits" : ""}</span>
              </>
            )}
            {rest.map((b) => (
              <span key={b.id} style={{ display: "contents" }}>
                <span className="k">{bucketLabel(b, t)}</span>
                <span className="v num">{Math.round(b.remainingPercent!)}%</span>
              </span>
            ))}
            {s.resetOpportunities.map((r) => (
              <span key={r.id} style={{ display: "contents" }}>
                <span className="k">{t("reset.opportunities", { n: r.count })}</span>
                <span className="v num">{r.items[0]?.expiresAt ? t("reset.expires", { time: timeUntil(r.items[0].expiresAt, lang) }) : ""}</span>
              </span>
            ))}
          </div>
          {(s.stale || (s.errorState && !hasErr)) && (
            <div className="err-line">
              <span className="dot stale" />
              {s.errorState ? t(("error." + s.errorState.code) as any) : ""}
              {s.stale ? ` · ${updatedAgo(s.fetchedAt, lang)}` : ""}
            </div>
          )}
        </>
      ) : bal ? (
        <>
          <div className="pb-main">
            <span className="pb-num num">{money(bal.total ?? 0, bal.currency)}</span>
            <span className="pb-reset">{bal.availableFlag === false ? t("state.degraded") : t("balance.available")}</span>
          </div>
          <div className="pb-rows">
            {bal.granted != null && (
              <><span className="k">{t("balance.granted")}</span><span className="v num">{money(bal.granted, bal.currency)}</span></>
            )}
            {bal.toppedUp != null && (
              <><span className="k">{t("balance.topped")}</span><span className="v num">{money(bal.toppedUp, bal.currency)}</span></>
            )}
          </div>
        </>
      ) : (
        <div className="err-line">{t("error.no_data")}</div>
      )}
    </div>
  );
}

/** Provider 详情：全部桶 + 燃烧预测 + 切换建议 + Reset 明细 + 来源 */
export function ProviderDetail({ snapshot: s, insights, onOpenSettings }: { snapshot: ProviderSnapshot; insights: Insights | null; onOpenSettings?: (section?: string) => void }) {
  const { t, lang } = useI18n();
  const hasErr = s.connectionState === "not_connected" || s.connectionState === "auth_required" || s.connectionState === "disconnected";
  // 会话型 Provider（MiMo/WorkBuddy）：登录失效时给一键重登，不再让用户空按刷新
  const sessionLogin = s.providerId === "mimo" || s.providerId === "workbuddy";
  const [reloginBusy, setReloginBusy] = useState(false);
  const [reloginMsg, setReloginMsg] = useState<string | null>(null);
  const relogin = async () => {
    if (!isTauri || reloginBusy) return;
    setReloginBusy(true);
    setReloginMsg(t("detail.relogin_waiting"));
    try {
      if (s.providerId === "workbuddy") {
        await invoke("workbuddy_open_login");
        await invoke("workbuddy_read_usage");
        await invoke("workbuddy_close_login");
      } else {
        await invoke("mimo_open_login");
        await invoke("mimo_read_usage");
        await invoke("mimo_close_login");
      }
      setReloginMsg(null); // 成功 → snapshot-updated 事件刷新为数据
    } catch {
      setReloginMsg(t("detail.relogin_failed"));
    } finally {
      setReloginBusy(false);
    }
  };

  return (
    <>
      {hasErr && (
        <button
          type="button"
          className="status-banner"
          style={{ width: "100%", textAlign: "left", border: "none", cursor: "pointer" }}
          onClick={() => onOpenSettings?.("providers")}
          title={t("tray.settings")}
        >
          <span className={`dot ${s.connectionState === "auth_required" ? "err" : ""}`} style={{ marginTop: 5 }} />
          <div>
            <b>{t(("error." + (s.errorState?.code ?? "unknown")) as any)}</b>
            {s.errorState?.detail && ` · ${s.errorState.detail}`}
            <div className="desc" style={{ marginTop: 4 }}>{t("tray.settings")} → Providers</div>
            {s.stale && <div>{t("time.updated_ago", { time: updatedAgo(s.fetchedAt, lang).replace(/^Updated |更新于?/, "") })}</div>}
          </div>
        </button>
      )}

      {hasErr && sessionLogin && isTauri && (
        <div style={{ margin: "6px 0 0" }}>
          <button
            type="button"
            className="foot-btn"
            disabled={reloginBusy}
            onClick={relogin}
          >
            {reloginBusy ? <span className="spinner" style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 6 }} /> : null}
            {t("action.reconnect")}
          </button>
          {reloginMsg && <p className="helper" style={{ margin: "6px 0 0" }}>{reloginMsg}</p>}
        </div>
      )}

      {/* v0.2：逐桶展示 + 燃烧预测行（有预测才显示，绝不硬造） */}
      {s.quotaBuckets.filter((b) => !isAggregateBucket(b)).map((b) => {
        const pred = insights?.predictions?.[s.providerId]?.find((p) => p.bucketId === b.id);
        return (
          <div key={b.id}>
            <Bucket b={b} />
            {pred && <PredictionLine p={pred} />}
          </div>
        );
      })}

      {/* v0.2 切换建议：Rust 侧判定该 Provider 余量已低于告警阈值时才出现 */}
      {(insights?.alternatives?.[s.providerId]?.length ?? 0) > 0 && (
        <div className="bucket">
          <div className="bucket-head">
            <span className="bucket-label">{t("switch.title")}</span>
          </div>
          {insights!.alternatives[s.providerId].map((a) => (
            <div className="kv" key={a.providerId}>
              <span>{a.name}</span>
              <b>{a.remainingPct !== undefined ? `${Math.round(a.remainingPct)}%` : "—"}</b>
            </div>
          ))}
        </div>
      )}

      {s.resetOpportunities.map((r) => (
        <div key={r.id} className="bucket">
          <div className="bucket-head">
            <span className="bucket-label">{t("reset.opportunities", { n: r.count })}</span>
            <span className="bucket-reset">{t("reset.monitor_note")}</span>
          </div>
          {r.items.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {/* 标题与过期时间分行堆叠：官方标题较长（如 Full reset (Weekly + 5 hr)），
                  原左右两端对齐的 .kv 会让两者换行挤在一起且无法对齐（用户实测反馈） */}
              {r.items.map((it, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                    paddingBottom: 6,
                    borderBottom: i + 1 < r.items.length ? "0.5px solid var(--hairline)" : "none",
                  }}
                >
                  <span style={{ fontSize: 11.5, color: "var(--fg-2)" }}>{it.titleRaw ?? "—"}</span>
                  <b style={{ fontSize: 11.5 }}>
                    {it.expiresAt ? `${formatDate(it.expiresAt)} · ${t("reset.expires", { time: timeUntil(it.expiresAt, lang) })}` : "—"}
                  </b>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {s.balances.map((b) => (
        <div key={b.id} className="bucket">
          <div className="bucket-head">
            <span className="bucket-label">{t("balance.main")}</span>
            <span className={`chip num`}>{t(("source." + (b.source === "official" ? "official" : b.source)) as any)}</span>
          </div>
          <div className="bucket-main">
            <span className="bucket-num num">{money(b.total ?? 0, b.currency)}</span>
            {b.availableFlag !== undefined && (
              <span className="pb-plan">{b.availableFlag ? t("balance.available") : t("state.degraded")}</span>
            )}
          </div>
          {b.granted != null && <div className="kv"><span>{t("balance.granted")}</span><b>{money(b.granted, b.currency)}</b></div>}
          {b.toppedUp != null && <div className="kv"><span>{t("balance.topped")}</span><b>{money(b.toppedUp, b.currency)}</b></div>}
        </div>
      ))}

      {/* v0.2 余额趋势（DeepSeek）：真实余额历史的线性外推，仅估趋势 */}
      {insights?.balance?.[s.providerId] && (
        <div className="bucket">
          <div className="err-line">
            <span className="dot stale" />
            {t("predict.balance_line", {
              days: insights.balance[s.providerId].daysLeft.toFixed(1),
              rate: insights.balance[s.providerId].dailyBurn.toFixed(2),
            })}
            <span className="pb-plan"> · {t(("predict.conf." + insights.balance[s.providerId].confidence) as any)}</span>
          </div>
        </div>
      )}
    </>
  );
}

/** v0.2 燃烧预测行：区间 + 置信度，绝不显示伪精确点估计 */
function PredictionLine({ p }: { p: BucketPrediction }) {
  const { t, lang } = useI18n();
  const hours = p.windowHours < 1 ? `${Math.round(p.windowHours * 60)}m` : `${p.windowHours.toFixed(1)}h`;
  return (
    <div style={{ margin: "8px 0 0" }}>
      <div className="err-line">
        <span className="dot stale" />
        {t("predict.line", { time: timeUntil(p.exhaustAt, lang) })}
        <span className="pb-plan"> · {t(("predict.conf." + p.confidence) as any)}</span>
      </div>
      <div className="err-line" style={{ opacity: 0.72 }}>
        {t("predict.range", { low: timeUntil(p.exhaustLow, lang), high: timeUntil(p.exhaustHigh, lang), hours })}
      </div>
    </div>
  );
}

function Bucket({ b }: { b: QuotaBucket }) {
  const { t, lang } = useI18n();
  const lvl = levelOf(b.remainingPercent);
  const isPercent = b.unit.kind === "percent";
  const showNum = isPercent ? `${Math.round(b.remainingPercent ?? 0)}%`
    : b.remaining !== undefined ? compact(b.remaining) : "—";
  return (
    <div className="bucket">
      <div className="bucket-head">
        <span className="bucket-label">{bucketLabel(b, t)}</span>
        <span className="bucket-reset">
          {b.resetAt ? t("reset.in", { time: timeUntil(b.resetAt, lang) }) + " · " : ""}
          {t(("source." + b.source) as any)}
        </span>
      </div>
      <div className="bucket-main">
        <span className={`bucket-num num ${lvl !== "normal" ? lvl + "-text" : ""}`}>{showNum}</span>
        {!isPercent && b.unit.kind === "credits" && <small className="pb-plan">Credits</small>}
        {b.used !== undefined && b.total !== undefined && (
          <span className="pb-plan num">{compact(b.used)} / {compact(b.total)}</span>
        )}
      </div>
      {b.remainingPercent !== undefined && (
        <div className={`bar ${lvl !== "normal" ? lvl : ""}`} aria-hidden>
          <i style={{ width: `${b.remainingPercent}%` }} />
        </div>
      )}
    </div>
  );
}
