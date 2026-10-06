import { useEffect, useRef, useState } from "react";
import type { ProviderSnapshot, Insights } from "../types/provider";
import { metaOf, instIdOf, accountIndexOf } from "../types/provider";
import { useI18n } from "../i18n";
import { primaryValue, primarySub, levelOf, pickPrimaryBucket, bucketLabel, timeUntil } from "../ui/format";
import { GlassSurface } from "../ui/GlassSurface";
import { IconSettings } from "../ui/icons";

export function CollapsedWidget({
  snapshots, insights, onOpen, onOpenSettings, onExpand,
}: {
  snapshots: ProviderSnapshot[];
  /** v0.2 洞察（真实壳）；浏览器原型为 null → 不显示预测提示 */
  insights: Insights | null;
  /** 点击行 → 直接进入该 Provider 详情（精简层点谁看谁） */
  onOpen: (providerId: string) => void;
  /** gear 不带参 → 通用页；空态「前往设置连接」带 "providers" → 直达 Provider 列表 */
  onOpenSettings: (section?: string) => void;
  /** 展开为 4-Agent 详细概览 */
  onExpand: () => void;
}) {
  const { t, lang } = useI18n();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  if (snapshots.length === 0) {
    return (
      <GlassSurface className="glass" data-widget>
        <button
          className="row-settings"
          aria-label={t("tray.settings")}
          title={t("tray.settings")}
          onClick={(e) => { e.stopPropagation(); onOpenSettings(); }}
        >
          <IconSettings />
        </button>
        <div className="empty" onContextMenu={openMenu}>
          <p>{t("empty.title")}</p>
          <button
            className="ghost-btn"
            onClick={(e) => { e.stopPropagation(); onOpenSettings("providers"); }}
          >
            {t("empty.action")}
          </button>
        </div>
        {menu && (
          <div
            ref={menuRef}
            className="ctx-menu"
            style={{ left: menu.x, top: menu.y }}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button className="ctx-item" onClick={() => { setMenu(null); onOpenSettings(); }}>
              {t("tray.settings")}
            </button>
          </div>
        )}
      </GlassSurface>
    );
  }

  return (
    <GlassSurface className="glass" data-widget>
      <button
        className="row-settings"
        aria-label={t("tray.settings")}
        title={t("tray.settings")}
        onClick={(e) => { e.stopPropagation(); onOpenSettings(); }}
      >
        <IconSettings />
      </button>
      <div className="rows" role="list" onContextMenu={openMenu}>
        {snapshots.map((s) => {
          const meta = metaOf(s.providerId);
          const accIdx = accountIndexOf(snapshots, s);
          const { text, percent, isMoney } = primaryValue(s);
          let sub = primarySub(s, t, lang);
          // v0.2：代表桶存在燃烧预测且 2 小时内耗尽 → 副标题改提示「预计 X 后耗尽」（按账号匹配）
          const primary = pickPrimaryBucket(s.quotaBuckets);
          const pred = primary
            ? insights?.predictions?.[s.providerId]?.find((p) => p.bucketId === primary.id && (p.accountId ?? "main") === (s.accountId ?? "main"))
            : undefined;
          if (pred) {
            const minsLeft = (new Date(pred.exhaustAt).getTime() - Date.now()) / 60000;
            if (minsLeft > 0 && minsLeft <= 120 && primary) {
              sub = `${bucketLabel(primary, t)} · ${t("collapsed.exhaust_hint", { time: timeUntil(pred.exhaustAt, lang) })}`;
            }
          }
          const level = levelOf(percent);
          const hasErr = s.connectionState !== "connected" && s.connectionState !== "degraded";
          const showErrText = hasErr || s.errorState?.code === "not_configured";
          const stale = s.stale;
          return (
            <div
              key={instIdOf(s)}
              role="listitem"
              tabIndex={0}
              className={`row focusable ${stale ? "stale" : ""}`}
              aria-label={`${t(meta.nameKey as any)} ${showErrText ? "" : text}`}
              onClick={() => onOpen(instIdOf(s))}
              onKeyDown={(e) => e.key === "Enter" && onOpen(instIdOf(s))}
            >
              <div className="tile">{meta.shortName[0]}</div>
              <div className="row-main">
                <div className="row-name">{meta.shortName}{accIdx > 0 ? <span className="row-sub-inline"> · {t("accounts.n", { n: accIdx })}</span> : null}</div>
                <div className="row-sub">{sub}</div>
              </div>
              <div className="row-value">
                {showErrText ? (
                  <div className="row-state">
                    <span className={`dot ${s.errorState?.code === "login_expired" || s.errorState?.code === "auth_required" ? "err" : ""}`} />
                    {t(("error." + (s.errorState?.code ?? "unknown")) as any)}
                  </div>
                ) : (
                  <>
                    <div className={`row-num num ${level !== "normal" ? level : ""}`}>{text}</div>
                    {!isMoney && percent !== undefined && (
                      <div className={`row-bar ${level !== "normal" ? level : ""}`} aria-hidden>
                        <i style={{ width: `${percent}%` }} />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {menu && (
        <div
          ref={menuRef}
          className="ctx-menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button className="ctx-item" onClick={() => { setMenu(null); onExpand(); }}>
            {t("nav.expand")}
          </button>
          <button className="ctx-item" onClick={() => { setMenu(null); onOpenSettings(); }}>
            {t("tray.settings")}
          </button>
        </div>
      )}
    </GlassSurface>
  );
}
