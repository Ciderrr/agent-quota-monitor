import { useEffect, useRef, useState } from "react";
import type { ProviderSnapshot } from "../types/provider";
import { metaOf } from "../types/provider";
import { useI18n } from "../i18n";
import { primaryValue, primarySub, levelOf } from "../ui/format";
import { GlassSurface } from "../ui/GlassSurface";
import { IconSettings } from "../ui/icons";

export function CollapsedWidget({
  snapshots, onOpen, onOpenSettings, onExpand,
}: {
  snapshots: ProviderSnapshot[];
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
          const { text, percent, isMoney } = primaryValue(s);
          const sub = primarySub(s, t, lang);
          const level = levelOf(percent);
          const hasErr = s.connectionState !== "connected" && s.connectionState !== "degraded";
          const showErrText = hasErr || s.errorState?.code === "not_configured";
          const stale = s.stale;
          return (
            <div
              key={s.providerId}
              role="listitem"
              tabIndex={0}
              className={`row focusable ${stale ? "stale" : ""}`}
              aria-label={`${t(meta.nameKey as any)} ${showErrText ? "" : text}`}
              onClick={() => onOpen(s.providerId)}
              onKeyDown={(e) => e.key === "Enter" && onOpen(s.providerId)}
            >
              <div className="tile">{meta.shortName[0]}</div>
              <div className="row-main">
                <div className="row-name">{meta.shortName}</div>
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
