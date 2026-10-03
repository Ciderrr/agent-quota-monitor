import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { engine, type Scenario } from "./mock/engine";
import { makeT, I18nContext, type Lang } from "./i18n";
import { isTauri } from "./bridge";
import type { ProviderSnapshot } from "./types/provider";
import { CollapsedWidget } from "./widget/CollapsedWidget";
import { ExpandedWidget } from "./widget/ExpandedWidget";
import { ConnectFlow } from "./connect/ConnectFlow";
import { SettingsWindow } from "./settings/SettingsWindow";
import { bridge } from "./bridge/bridge";

type View = "collapsed" | "overview" | "detail" | "history";
type Theme = "light" | "dark" | "auto";
type Win = null | { kind: "settings" } | { kind: "settings-general" } | { kind: "connect"; id: string };

/** 玻璃不透明度：三个窗口共用，从设置读取并跟 settings-changed 同步 */
function applyGlassStrength(v: number) {
  document.documentElement.style.setProperty("--glass-strength", String(Math.min(1.4, Math.max(0.3, v))));
}
function useGlassStrength() {
  useEffect(() => {
    if (!isTauri) return;
    invoke<{ glassStrength?: number }>("get_settings").then((s) => {
      if (typeof s?.glassStrength === "number") applyGlassStrength(s.glassStrength);
    }).catch(() => {});
    let un: (() => void) | undefined;
    listen<{ glassStrength?: number }>("settings-changed", (e) => {
      if (typeof e.payload?.glassStrength === "number") applyGlassStrength(e.payload.glassStrength);
    }).then((f) => { un = f; }).catch(() => {});
    return () => un?.();
  }, []);
}

function useEngineTick() {
  return useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => engine.getSnapshots().map((s) => s.providerId + "@" + s.fetchedAt + (s.stale ? "!stale" : "")).join("|"),
  );
}

function tauriWindowLabel(): string | null {
  try {
    const m = (window as unknown as {
      __TAURI_INTERNALS__?: {
        metadata?: {
          currentWindow?: { label?: string };
          currentWebview?: { label?: string };
        };
      };
    }).__TAURI_INTERNALS__?.metadata;
    return m?.currentWindow?.label || m?.currentWebview?.label || null;
  } catch {
    return null;
  }
}

function detectShell(): "tray" | "settings" | "main" {
  // 1) 独立入口 HTML 写入的标记
  const forced = (window as unknown as { __SHELL__?: string }).__SHELL__;
  if (forced === "tray") return "tray";
  if (forced === "settings") return "settings";
  // 2) Tauri 窗口 label（纯属性读取，无 IPC，不会卡死）
  const label = tauriWindowLabel();
  if (label === "tray-menu") return "tray";
  if (label === "settings") return "settings";
  // 3) query（浏览器原型）
  const params = new URLSearchParams(location.search);
  if (params.get("traymenu") === "1") return "tray";
  if (params.get("window") === "settings") return "settings";
  return "main";
}

/** 语言/主题（用户实测反馈：设置窗切语言主浮窗不跟）——真实壳里是多个独立 WebView 窗口，
 *  语言状态必须持久化（set_settings → SQLite）并经 settings-changed 事件广播到所有窗口；
 *  浏览器原型仍走 URL 参数。setters 同时写库，确保重启后保持。 */
function usePersistedAppearance() {
  const params = new URLSearchParams(location.search);
  const [lang, setLangState] = useState<Lang>((params.get("lang") as Lang) || "zh");
  const [theme, setThemeState] = useState<Theme>((params.get("theme") as Theme) || "dark");
  useEffect(() => {
    if (!isTauri) return;
    invoke<{ lang?: string; theme?: string }>("get_settings").then((s) => {
      if (s?.lang === "zh" || s?.lang === "en") setLangState(s.lang);
      if (s?.theme === "auto" || s?.theme === "light" || s?.theme === "dark") setThemeState(s.theme);
    }).catch(() => {});
    let un: (() => void) | undefined;
    listen<{ lang?: string; theme?: string }>("settings-changed", (e) => {
      const l = e.payload?.lang;
      if (l === "zh" || l === "en") setLangState(l);
      const t = e.payload?.theme;
      if (t === "auto" || t === "light" || t === "dark") setThemeState(t);
    }).then((f) => { un = f; }).catch(() => {});
    return () => un?.();
  }, []);
  const setLang = (l: Lang) => {
    setLangState(l);
    if (isTauri) invoke("set_settings", { lang: l }).catch(() => {});
  };
  const setTheme = (t: Theme) => {
    setThemeState(t);
    if (isTauri) invoke("set_settings", { theme: t }).catch(() => {});
  };
  return { lang, setLang, theme, setTheme };
}

export function App() {
  const shell = detectShell();
  if (shell === "tray") return <TrayMenuPanel />;
  if (shell === "settings") return <SettingsShell />;
  return <MainShell />;
}

/** 独立设置窗口（真实壳）；浏览器原型仍走 MainShell 覆盖层以便 ui-check */
function SettingsShell() {
  const { lang, setLang, theme, setTheme } = usePersistedAppearance();
  const i18nCtx = useMemo(() => makeT(lang), [lang]);
  const [connectId, setConnectId] = useState<string | null>(null);
  useGlassStrength();

  useEffect(() => {
    const apply = () => {
      const resolved =
        theme === "auto"
          ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
          : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.tauri = isTauri ? "1" : "0";
      document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    };
    apply();
    if (theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme, lang]);

  useEffect(() => {
    const h = (e: Event) => setConnectId((e as CustomEvent).detail as string);
    window.addEventListener("proto-connect", h);
    return () => window.removeEventListener("proto-connect", h);
  }, []);

  const close = () => {
    if (isTauri) {
      invoke("close_settings_window").catch(() => {});
    }
  };

  return (
    <I18nContext.Provider value={i18nCtx}>
      <div className="settings-shell">
        <SettingsWindow
          onClose={close}
          theme={theme} setTheme={setTheme}
          lang={lang} setLang={setLang}
        />
        {connectId && (
          <div className="connect-overlay">
            <ConnectFlow providerId={connectId} onClose={() => setConnectId(null)} />
          </div>
        )}
      </div>
    </I18nContext.Provider>
  );
}

function TrayMenuPanel() {
  const { lang, theme } = usePersistedAppearance();
  const i18nCtx = useMemo(() => makeT(lang), [lang]);
  const { t } = i18nCtx;
  const [ontop, setOntop] = useState(false);
  useGlassStrength();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.tauri = isTauri ? "1" : "0";
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    if (!isTauri) return;
    invoke<boolean>("get_ontop").then(setOntop).catch(() => {});
    const onBlur = () => { invoke("close_tray_menu").catch(() => {}); };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [theme, lang]);

  const close = () => { invoke("close_tray_menu").catch(() => {}); };

  return (
    <I18nContext.Provider value={i18nCtx}>
      <div className="tray-menu" data-tauri-drag-region="">
        <button className="ctx-item" onClick={() => { invoke("refresh_all").catch(() => {}); close(); }}>
          {t("tray.refresh_all")}
        </button>
        <button
          className="ctx-item"
          onClick={async () => {
            // 置顶：只改状态，菜单不关闭
            try { setOntop(await invoke<boolean>("toggle_ontop")); } catch { /* ignore */ }
          }}
        >
          <span>{t("tray.always_on_top")}</span>
          <span className="check">{ontop ? "✓" : ""}</span>
        </button>
        <button
          className="ctx-item"
          onClick={() => {
            invoke("open_settings_window").catch(() => {});
            close();
          }}
        >
          {t("tray.settings")}
        </button>
        <div className="ctx-sep" />
        <button className="ctx-item" onClick={() => { invoke("quit_app").catch(() => {}); }}>
          {t("tray.quit")}
        </button>
      </div>
    </I18nContext.Provider>
  );
}

function MainShell() {
  const params = new URLSearchParams(location.search);
  const shot = params.get("shot");
  const { lang, setLang, theme, setTheme } = usePersistedAppearance();
  const [view, setView] = useState<View>(engine.defaultView as View);
  const [detailId, setDetailId] = useState<string | undefined>();
  const [historyFrom, setHistoryFrom] = useState<"overview" | "detail">("overview");
  const [win, setWin] = useState<Win>(null);
  const [pos, setPos] = useState({ right: 24, top: 24 }); // 右上角锚定（可拖动）
  const [dragging, setDragging] = useState(false);
  useGlassStrength();

  useEngineTick();
  const i18nCtx = useMemo(() => makeT(lang), [lang]);
  const [tauriSnaps, setTauriSnaps] = useState<ProviderSnapshot[]>([]);
  useEffect(() => {
    if (!isTauri) return;
    let un: (() => void) | undefined;
    const pull = async () => { try { setTauriSnaps(await invoke<ProviderSnapshot[]>("get_snapshots")); } catch { /* 尚未就绪 */ } };
    (async () => { await pull(); un = await listen("snapshot-updated", pull); })();
    return () => un?.();
  }, []);
  const snapshots = isTauri ? tauriSnaps : engine.getSnapshots();
  const lastUpdated = snapshots.reduce(
    (a, s) => (a > s.fetchedAt ? a : s.fetchedAt),
    new Date(0).toISOString(),
  );

  // 场景 / 快捷状态（截图模式）
  useEffect(() => {
    const s = params.get("scenario") as Scenario | null;
    if (s) engine.setScenario(s);
    if (shot === "empty") engine.setScenario("empty");
    if (shot === "expanded") setView("overview");
    if (shot?.startsWith("detail-")) { setDetailId(shot.slice(7)); setView("detail"); }
    if (shot === "history") setView("history");
    if (shot?.startsWith("connect-")) setWin({ kind: "connect", id: shot.slice(8) });
    if (shot === "settings") setWin({ kind: "settings" });
    if (shot === "settings-general") setWin({ kind: "settings-general" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 默认视图设置变更 → 浮窗回到新的主界面
  useEffect(() => {
    return engine.subscribe(() => setView((v) =>
      v === "collapsed" || v === "overview" ? engine.defaultView : v,
    ));
  }, []);

  // 真实壳：启动时从 SQLite 恢复默认视图（与 set_settings 对称）
  useEffect(() => {
    if (!isTauri) return;
    invoke<{ defaultView?: string; notifyEnabled?: boolean }>("get_settings")
      .then((s) => {
        const dv = s?.defaultView;
        if (dv === "collapsed" || dv === "overview") {
          lastDvRef.current = dv;
          engine.setDefaultView(dv);
          setView((v) => (v === "collapsed" || v === "overview" ? dv : v));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const apply = () => {
      const resolved =
        theme === "auto"
          ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
          : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.shot = shot ? "1" : "0";
      document.documentElement.dataset.tauri = isTauri ? "1" : "0";
      document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    };
    apply();
    if (theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme, lang, shot]);

  // Esc：统计→来源层；详情→默认主界面；概览→精简；关闭窗口
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (win) { setWin(null); return; }
      setView((v) =>
        v === "history" ? historyFrom
        : v === "detail" ? (engine.defaultView as View)
        : "collapsed"
      );
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [win, historyFrom]);

  const homeView = () => setView(engine.defaultView as View);
  const openProvider = (id: string) => { setDetailId(id); setView("detail"); };
  const openHistory = () => {
    const from = view === "detail" ? "detail" : "overview";
    setHistoryFrom(from);
    if (from === "overview") setDetailId(undefined);
    setView("history");
  };
  const openSettings = (section?: string) => {
    if (isTauri) {
      invoke("open_settings_window", { section: section ?? null }).catch(() => {});
    } else {
      setWin({ kind: section === "general" ? "settings-general" : "settings" });
    }
  };
  const openOverview = () => setView("overview");

  // 拖动（右上角锚定）：>4px 位移才算拖动，不捕获指针 —— 保证面板内点击（展开/按钮）正常；
  // 拖动后的误触 click 由 movedRef 在 onClickCapture 中拦截
  const dragRef = useRef<{ sx: number; sy: number; or: number; ot: number } | null>(null);
  const movedRef = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if (shot) return;
    // 行/按钮/输入不参与拖动，否则点不进详情
    const target = e.target as HTMLElement | null;
    if (target?.closest(
      "button, input, select, textarea, a, [role='button'], .row, .provider-block, .x-back, .icon-btn, .foot-btn, .ctx-item, .mode-card",
    )) return;
    if (isTauri) {
      invoke("start_window_drag").catch(() => {});
      return;
    }
    dragRef.current = { sx: e.clientX, sy: e.clientY, or: pos.right, ot: pos.top };
    movedRef.current = false;
    setDragging(true);
  };
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current; if (!d) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) movedRef.current = true;
      setPos({
        right: Math.max(8, Math.min(window.innerWidth - 300, d.or - dx)),
        top: Math.max(8, Math.min(window.innerHeight - 120, d.ot + dy)),
      });
    };
    const up = () => {
      dragRef.current = null; setDragging(false);
      setTimeout(() => { movedRef.current = false; }, 0); // click 事件之后再清除
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [dragging]);
  const suppressClickAfterDrag = (e: React.MouseEvent) => {
    if (movedRef.current) { e.stopPropagation(); e.preventDefault(); }
  };

  // 真实壳：按面板实际尺寸收紧窗口
  useEffect(() => {
    if (!isTauri) return;
    let raf = 0, lastW = 0, lastH = 0;
    const apply = () => {
      const el = document.querySelector("[data-widget]") as HTMLElement | null;
      if (!el) return;
      // 用 scrollHeight：展开层有 max-height:74vh，窗口小的时候 offsetHeight 会被压扁，导致死锁式小窗
      const w = Math.ceil(Math.max(el.offsetWidth, el.scrollWidth));
      const h = Math.ceil(Math.max(el.offsetHeight, el.scrollHeight, el.getBoundingClientRect().height));
      if (w < 80 || h < 80) return;
      if (w === lastW && h === lastH) return;
      lastW = w; lastH = h;
      invoke("set_widget_size", { w, h }).catch(() => {});
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => requestAnimationFrame(apply));
    };
    schedule();
    const el = document.querySelector("[data-widget]");
    const ro = new ResizeObserver(schedule);
    if (el) ro.observe(el);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [view, snapshots.length, detailId, win?.kind]);

  // Settings 内"连接"按钮 → Connect 窗口（原型内事件桥）
  useEffect(() => {
    const h = (e: Event) => setWin({ kind: "connect", id: (e as CustomEvent).detail });
    window.addEventListener("proto-connect", h);
    return () => window.removeEventListener("proto-connect", h);
  }, []);

  // 跨窗同步：设置里的默认视图/Providers 显隐 → 主浮窗立即生效。
  // ⚠️ 只在 defaultView **真正变化**时才应用（用户实测：切语言/主题也会携带 defaultView
  // 重发事件，无条件应用会把手动的精简/详细选择拽回默认视图）。
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const lastDvRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!isTauri) return;
    let un1: (() => void) | undefined;
    let un2: (() => void) | undefined;
    listen<{ defaultView?: string }>("settings-changed", (e) => {
      const dv = e.payload?.defaultView;
      if ((dv === "collapsed" || dv === "overview") && dv !== lastDvRef.current) {
        lastDvRef.current = dv;
        engine.setDefaultView(dv);
        setView((v) => (v === "collapsed" || v === "overview" ? dv : v));
      }
    }).then((f) => { un1 = f; }).catch(() => {});
    listen<{ id: string; enabled: boolean }>("providers-changed", (e) => {
      const { id, enabled } = e.payload;
      setHiddenIds((s) => {
        const n = new Set(s);
        if (enabled) n.delete(id); else n.add(id);
        return n;
      });
    }).then((f) => { un2 = f; }).catch(() => {});
    invoke<Record<string, boolean>>("list_providers_enabled").then((m) => {
      const hid = new Set<string>();
      for (const [id, on] of Object.entries(m || {})) if (!on) hid.add(id);
      setHiddenIds(hid);
    }).catch(() => {});
    return () => { un1?.(); un2?.(); };
  }, []);

  const visibleSnaps = snapshots.filter((s) => !hiddenIds.has(s.providerId));

  // 真实壳：设置/托盘菜单是独立预声明窗口，主窗只负责浮窗
  return (
    <I18nContext.Provider value={i18nCtx}>
      <div style={{ position: "relative", height: "100%" }}>
        <div className={`wallpaper ${isTauri ? "is-hidden" : ""}`} aria-hidden />

        {/* 浮窗 */}
        <div
          className={`widget ${dragging ? "dragging" : ""}`}
          style={isTauri ? { right: 0, top: 0 } : { right: pos.right, top: pos.top }}
          data-widget-root
        >
          <div
          className={`drag-region`}
          data-tauri-drag-region=""
          onPointerDown={onPointerDown}
          onClickCapture={suppressClickAfterDrag}
        >
            {view === "collapsed" ? (
              <CollapsedWidget
                snapshots={visibleSnaps}
                onOpen={openProvider}
                onOpenSettings={openSettings}
                onExpand={openOverview}
              />
            ) : (
              <ExpandedWidget
                snapshots={visibleSnaps}
                view={view === "detail" ? "detail" : view === "history" ? "history" : "overview"}
                detailId={detailId}
                onBack={homeView}
                onBackHistory={() => setView(historyFrom)}
                onOpenDetail={openProvider}
                onShowHistory={openHistory}
                onRefresh={(id) => { bridge.refreshNow(id).catch(() => {}); }}
                lastAllUpdated={lastUpdated}
                onCollapse={() => setView("collapsed")}
                showCollapse={engine.defaultView === "collapsed"}
                onOpenSettings={openSettings}
              />
            )}
          </div>
        </div>

        {/* 模拟窗口层 */}
        {win?.kind === "settings" && (
          <CenterLayer>
            <SettingsWindow
              onClose={() => setWin(null)}
              theme={theme} setTheme={setTheme}
              lang={lang} setLang={setLang}
            />
          </CenterLayer>
        )}
        {win?.kind === "settings-general" && (
          <CenterLayer>
            <SettingsWindow
              onClose={() => setWin(null)}
              theme={theme} setTheme={setTheme}
              lang={lang} setLang={setLang}
              initialSection="general"
            />
          </CenterLayer>
        )}
        {win?.kind === "connect" && (
          <CenterLayer>
            <ConnectFlow providerId={win.id} onClose={() => setWin(null)} />
          </CenterLayer>
        )}

        {/* 原型控制条（非产品 UI；截图模式与真实壳隐藏） */}
        {!shot && !isTauri && (
          <div className="proto-bar">
            <span className="tag">{i18nCtx.t("proto.note")}</span>
            <select value={engine.scenario} onChange={(e) => engine.setScenario(e.target.value as Scenario)} aria-label="scenario">
              <option value="default">default</option>
              <option value="issues">error / stale</option>
              <option value="low">low quota</option>
              <option value="empty">empty</option>
            </select>
            <button onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "auto" : "dark")}>{theme}</button>
            <button onClick={() => setLang(lang === "zh" ? "en" : "zh")}>{lang === "zh" ? "中文" : "EN"}</button>
            <button onClick={() => setWin({ kind: "connect", id: "codex" })}>Connect Codex</button>
            <button onClick={() => setWin({ kind: "connect", id: "mimo" })}>Connect MiMo</button>
            <button onClick={() => setWin({ kind: "settings" })}>{i18nCtx.t("tray.settings")}</button>
          </div>
        )}
      </div>
    </I18nContext.Provider>
  );
}

function CenterLayer({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: "absolute", inset: 0, display: "grid", placeItems: "center",
      zIndex: 40, pointerEvents: "none",
    }}>
      <div style={{ pointerEvents: "auto" }}>{children}</div>
    </div>
  );
}
