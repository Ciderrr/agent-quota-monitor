import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { bridge, isTauri } from "../bridge";
import { PROVIDERS } from "../types/provider";
import { useI18n, type Lang } from "../i18n";
import { engine } from "../mock/engine";
import { IconClose } from "../ui/icons";
import { GlassSurface } from "../ui/GlassSurface";

type Section = "general" | "providers" | "refresh" | "notifications" | "privacy" | "about";
const SECTIONS: Section[] = ["general", "providers", "refresh", "notifications", "privacy", "about"];

/** 设置改动：只走 Rust command，由 app.emit 广播（设置窗无 event.emit 权限） */
async function notifySettings(patch: Record<string, unknown>) {
  if (!isTauri) return;
  try {
    await invoke("set_settings", patch);
  } catch { /* ignore */ }
}

export function SettingsWindow({
  onClose, theme, setTheme, lang, setLang, initialSection = "general",
}: {
  onClose: () => void;
  theme: "light" | "dark" | "auto"; setTheme: (t: "light" | "dark" | "auto") => void;
  lang: Lang; setLang: (l: Lang) => void;
  initialSection?: Section;
}) {
  const { t } = useI18n();
  const [section, setSection] = useState<Section>(initialSection);
  const [prefs, setPrefs] = useState({
    launch: false, mode: "desktop", refresh: "smart",
    notify: true, warn: 20, crit: 10, balance: 30, glass: 100,
  });
  const set = <K extends keyof typeof prefs>(k: K, v: (typeof prefs)[K]) => setPrefs((p) => ({ ...p, [k]: v }));
  const [testState, setTestState] = useState<Record<string, "running" | "ok" | undefined>>({});
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});
  const [snaps, setSnaps] = useState<Record<string, { connectionState?: string; errorState?: { code?: string } }>>({});
  const [creds, setCreds] = useState<Record<string, boolean>>({});
  const [codexSess, setCodexSess] = useState<boolean | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [capHint, setCapHint] = useState(false);
  // 更新状态机（v0.2.2）：idle → checking → latest | available → downloading | failed
  const [updateState, setUpdateState] = useState<"idle" | "checking" | "latest" | "available" | "downloading" | "failed">("idle");
  const [updateInfo, setUpdateInfo] = useState<{ version?: string } | null>(null);
  const [updatePercent, setUpdatePercent] = useState(0);
  const busyRef = useRef(false);

  const runCheckUpdate = async () => {
    if (!isTauri || updateState === "checking") return;
    setUpdateState("checking");
    try {
      const info = await invoke<{ version?: string } | null>("check_update");
      if (info) {
        setUpdateInfo(info);
        setUpdateState("available");
      } else {
        setUpdateState("latest");
      }
    } catch {
      setUpdateState("failed");
    }
  };
  const runInstallUpdate = async () => {
    if (!isTauri) return;
    setUpdateState("downloading");
    setUpdatePercent(0);
    try {
      await invoke("install_update");
      // Windows 安装阶段应用会被退出；若走到这里说明安装流程已启动
    } catch {
      setUpdateState("failed");
    }
  };

  // 下载进度（update-progress 事件）
  useEffect(() => {
    if (!isTauri) return;
    let un: (() => void) | undefined;
    listen<{ percent?: number }>("update-progress", (e) => {
      if (typeof e.payload?.percent === "number") setUpdatePercent(e.payload.percent);
    }).then((f) => { un = f; }).catch(() => {});
    return () => un?.();
  }, []);

  useEffect(() => {
    // About 页版本号：从 Tauri 运行时读取（与安装包版本永远一致，不再手写）
    getVersion().then((v) => setAppVersion(v)).catch(() => {});
  }, []);

  const refreshStatus = () => {
    if (!isTauri) return;
    bridge.getSnapshots().then((all) => {
      const m: Record<string, { connectionState?: string; errorState?: { code?: string } }> = {};
      for (const s of all) m[s.providerId] = s;
      setSnaps(m);
    }).catch(() => {});
    invoke<Record<string, boolean>>("get_credential_status").then(setCreds).catch(() => {});
    invoke<{ loggedIn: boolean }>("codex_login_status").then((r) => setCodexSess(r?.loggedIn ?? null)).catch(() => {});
    // 启停状态每次一并刷新（v0.3.1：此前只在挂载时拉一次且失败即空表，
    // 空表 + 「?? true」兜底让 9 家全部显示为开启——用户实测 9/4 的根因）
    invoke<Record<string, boolean>>("list_providers_enabled").then((m) => {
      if (m && Object.keys(m).length > 0) setEnabledMap(m);
    }).catch(() => {});
    // 切换选项卡后清掉临时「测试成功」标记
    setTestState({});
  };

  useEffect(() => {
    if (!isTauri) return;
    refreshStatus();
    // 启停状态来自 Rust（v0.3 起持久化）
    invoke<Record<string, boolean>>("list_providers_enabled").then(setEnabledMap).catch(() => {});
    invoke<{ defaultView?: string; notifyEnabled?: boolean; refreshIntervalMs?: number; glassStrength?: number; thresholds?: { warn?: number; crit?: number; balance?: number } }>("get_settings").then((s) => {
      if (s?.defaultView === "collapsed" || s?.defaultView === "overview") setDefaultView(s.defaultView);
      const ms = s?.refreshIntervalMs ?? 0;
      const refresh = ms === 0 ? "smart" : ms === 60_000 ? "1" : ms === 300_000 ? "5" : ms === 600_000 ? "10" : "smart";
      setPrefs((p) => ({
        ...p,
        refresh,
        notify: s?.notifyEnabled ?? p.notify,
        warn: s?.thresholds?.warn ?? p.warn,
        crit: s?.thresholds?.crit ?? p.crit,
        balance: s?.thresholds?.balance ?? p.balance,
        glass: Math.round((s?.glassStrength ?? 1) * 100),
      }));
      if (typeof s?.glassStrength === "number") {
        document.documentElement.style.setProperty("--glass-strength", String(s.glassStrength));
      }
    }).catch(() => {});
    window.addEventListener("focus", refreshStatus);
    return () => window.removeEventListener("focus", refreshStatus);
  }, []);

  // 连接/清除后自动刷新状态
  useEffect(() => {
    if (!isTauri) return;
    let un: (() => void) | undefined;
    listen("snapshot-updated", () => {
      bridge.getSnapshots().then((all) => {
        const m: Record<string, { connectionState?: string; errorState?: { code?: string } }> = {};
        for (const s of all) m[s.providerId] = s;
        setSnaps(m);
      }).catch(() => {});
      invoke<Record<string, boolean>>("get_credential_status").then(setCreds).catch(() => {});
    }).then((f) => { un = f; }).catch(() => {});
    return () => un?.();
  }, []);

  const runTest = async (id: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setTestState((s) => ({ ...s, [id]: "running" }));
    try {
      if (id === "codex") {
        const snap = await invoke<{ connectionState?: string }>("codex_read_rate_limits");
        const ok = snap?.connectionState === "connected" || snap?.connectionState === "degraded";
        setTestState((s) => ({ ...s, [id]: ok ? "ok" : undefined }));
        if (snap) setSnaps((m) => ({ ...m, codex: snap as never }));
      } else {
        await bridge.refreshNow(id);
        // ④（用户实测反馈）：会话型读取在后台异步完成（最长 30–45s），必须轮询等快照
        // 真正变化（新数据或新错误）再判定；绝不拿旧快照冒充「测试通过」
        const old = await bridge.getSnapshot(id);
        const oldAt = old?.fetchedAt;
        const oldErr = old?.errorState?.code;
        let snap = old;
        const deadline = Date.now() + 50000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1500));
          snap = await bridge.getSnapshot(id);
          if (snap && (snap.fetchedAt !== oldAt || snap.errorState?.code !== oldErr)) break;
        }
        const ok = snap && !snap.errorState && (snap.connectionState === "connected" || snap.connectionState === "degraded");
        setTestState((s) => ({ ...s, [id]: ok ? "ok" : undefined }));
        if (snap) setSnaps((m) => ({ ...m, [id]: snap as never }));
      }
    } catch {
      setTestState((s) => ({ ...s, [id]: undefined }));
    } finally {
      busyRef.current = false;
    }
  };
  const [defaultView, setDefaultView] = useState<"collapsed" | "overview">(
    (engine.defaultView as "collapsed" | "overview") || "collapsed"
  );
  // 从 Provider 状态条跳入 → 直达 Providers
  useEffect(() => {
    if (!isTauri) return;
    let un: (() => void) | undefined;
    listen<string>("settings-section", (e) => {
      const sec = typeof e.payload === "string" ? e.payload : (e.payload as { section?: string })?.section;
      if (sec === "general" || sec === "providers" || sec === "refresh" || sec === "notifications" || sec === "privacy" || sec === "about") {
        setSection(sec as Section);
      }
    }).then((f) => { un = f; }).catch(() => {});
    return () => un?.();
  }, []);
  const changeDefaultView = (v: "collapsed" | "overview") => {
    setDefaultView(v);
    engine.setDefaultView(v);
    // Rust set_settings 会 kv 持久化并 app.emit("settings-changed")
    void notifySettings({ defaultView: v });
  };
  const changeWindowMode = (v: string) => {
    set("mode", v);
    if (!isTauri) return;
    if (v === "ontop") invoke<boolean>("toggle_ontop").then((on) => { if (!on) invoke("toggle_ontop").catch(() => {}); }).catch(() => {});
    else invoke<boolean>("get_ontop").then((on) => { if (on) invoke("toggle_ontop").catch(() => {}); }).catch(() => {});
  };
  const setThreshold = (key: "warn" | "crit" | "balance", v: number) => {
    set(key, v);
    void notifySettings({ [key]: v });
  };
  const toggleProvider = (id: string, on: boolean) => {
    // 用户红线：主界面最多同时显示 4 家（v0.3 扩容后强制；Rust 侧同样兜底）
    if (on) {
      const already = enabledMap[id] ?? true;
      const count = PROVIDERS.filter((p) => enabledMap[p.id] ?? true).length;
      if (!already && count >= 4) {
        setCapHint(true);
        setTimeout(() => setCapHint(false), 4000);
        return;
      }
    }
    setCapHint(false);
    setEnabledMap((m) => ({ ...m, [id]: on }));
    // Rust set_provider_enabled 会 app.emit("providers-changed")
    bridge.setProviderEnabled(id, on).catch(() => {});
  };
  const clearCred = (id: string) => {
    invoke("clear_credential", { id }).then(() => {
      setCreds((c) => ({ ...c, [id]: false }));
      // 同步 Providers 列表状态
      invoke<Record<string, boolean>>("get_credential_status").then(setCreds).catch(() => {});
      bridge.getSnapshots().then((all) => {
        const m: Record<string, { connectionState?: string; errorState?: { code?: string } }> = {};
        for (const s of all) m[s.providerId] = s;
        setSnaps(m);
      }).catch(() => {});
    }).catch(() => {});
  };
  // ②1：会话型 Provider 退出——此前 MiMo 是 no-op、WorkBuddy 无入口（用户实测反馈）
  const clearSession = (id: string) => {
    invoke("clear_provider_session", { id }).then(() => {
      bridge.getSnapshots().then((all) => {
        const m: Record<string, { connectionState?: string; errorState?: { code?: string } }> = {};
        for (const s of all) m[s.providerId] = s;
        setSnaps(m);
      }).catch(() => {});
    }).catch(() => {});
  };

  return (
    <GlassSurface className="glass-strong sim-window wide" data-window role="dialog" aria-label={t("settings.title")}>
      <div
        className="win-head"
        style={{ cursor: "move", minHeight: 44 }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          if (isTauri) invoke("start_window_drag").catch(() => {});
        }}
      >
        <div className="win-title">{t("settings.title")}</div>
        <button type="button" className="icon-btn" aria-label={t("action.close")} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}>
          <IconClose />
        </button>
      </div>
      <div className="win-body">
        <div className="set-layout">
          <div className="set-nav" role="tablist">
            {SECTIONS.map((s) => (
              <button key={s} className={section === s ? "on" : ""} role="tab" aria-selected={section === s}
                onClick={() => {
                  if (s !== section) refreshStatus();
                  setSection(s);
                }}>{t(("settings." + s) as any)}</button>
            ))}
          </div>
          <div className="set-pane">
            {section === "general" && (
              <>
                <div>
                  <div className="label" style={{ marginBottom: 6 }}>{t("settings.default_view")}</div>
                  <div className="desc" style={{ marginTop: 0, marginBottom: 8 }}>{t("settings.default_view_desc")}</div>
                  <div className="mode-cards">
                    <ModeCard
                      active={defaultView === "collapsed"}
                      label={t("settings.mode_collapsed")}
                      onClick={() => changeDefaultView("collapsed")}
                    >
                      <MiniCollapsed />
                    </ModeCard>
                    <ModeCard
                      active={defaultView === "overview"}
                      label={t("settings.mode_overview")}
                      onClick={() => changeDefaultView("overview")}
                    >
                      <MiniOverview />
                    </ModeCard>
                  </div>
                </div>
                <Row label={t("settings.launch_startup")}><Switch on={prefs.launch} onChange={(v) => set("launch", v)} /></Row>
                <Row label={t("settings.language")}>
                  <Seg value={lang} onChange={(v) => setLang(v as Lang)}
                    options={[["zh", "简体中文"], ["en", "English"]]} />
                </Row>
                <Row label={t("settings.theme")} desc="">
                  <Seg value={theme} onChange={(v) => setTheme(v as "light" | "dark" | "auto")}
                    options={[["auto", t("settings.theme.auto")], ["light", t("settings.theme.light")], ["dark", t("settings.theme.dark")]]} />
                </Row>
                <Row label={t("settings.glass")} desc={t("settings.glass_desc")}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 180 }}>
                    <input
                      type="range" min={50} max={140} step={5}
                      value={prefs.glass}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        set("glass", v);
                        document.documentElement.style.setProperty("--glass-strength", String(v / 100));
                        void notifySettings({ glassStrength: v / 100 });
                      }}
                      style={{ flex: 1, accentColor: "#34c759" }}
                      aria-label={t("settings.glass")}
                    />
                    <span className="num" style={{ width: 40, textAlign: "right", color: "var(--fg-2)" }}>{prefs.glass}%</span>
                  </div>
                </Row>
                <Row label={t("settings.window_mode")}>
                  <Seg value={prefs.mode} onChange={changeWindowMode}
                    options={[["desktop", t("settings.mode_desktop")], ["ontop", t("settings.mode_ontop")]]} />
                </Row>
              </>
            )}

            {section === "providers" && (
              <>
                <p className="helper quiet" style={{ marginTop: 0 }}>
                  {t("settings.providers_helper")}
                </p>
                {capHint && (
                  <p className="helper" style={{ color: "var(--warn)", margin: "4px 0 0" }}>
                    {t("settings.cap_hint")}
                  </p>
                )}
                <p className="helper quiet" style={{ margin: "4px 0 0" }}>
                  {t("settings.enabled_count", {
                    n: String(PROVIDERS.filter((p) => enabledMap[p.id] === true).length),
                  })}
                </p>
                {PROVIDERS.map((p) => {
                  // 启停状态未加载完成前不渲染开关（宁可慢一拍，不可显示假状态）
                  const enabledKnown = enabledMap[p.id] !== undefined;
                  const enabled = enabledMap[p.id] ?? false;
                  const snap = isTauri ? snaps[p.id] : engine.getSnapshot(p.id);
                  const conn = snap?.connectionState ?? "not_connected";
                  // Key 型 Provider：凭据已不存在时，旧快照的「已连接」不可信 → 如实显示未配置
                  const keyBased = p.id === "deepseek" || p.id === "zcode";
                  const credMissing = keyBased && isTauri && creds[p.id] === false;
                  const isLocalLogs = p.connectionMethods.includes("local_logs");
                  const live = !credMissing && (conn === "connected" || conn === "degraded");
                  const testing = testState[p.id];
                  return (
                    <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 10, borderBottom: "0.5px solid var(--hairline)" }}>
                      <div className="set-row">
                        <span className="label">{t(p.nameKey as any)}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {/* 日志型 Provider 无连接流程（自动探测本机数据），仅 API Key/登录型显示 Connect */}
                          {!live && p.connectionMethods.some((m) => m !== "local_logs") && (
                            <button className="mini-btn" onClick={() => { window.dispatchEvent(new CustomEvent("proto-connect", { detail: p.id })); }}>{t("action.connect")}</button>
                          )}
                          {live && (
                            <button className="mini-btn" disabled={testing === "running"} onClick={() => runTest(p.id)}>
                              {testing === "running" ? <span className="spinner" style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 5 }} /> : null}
                              {testing === "running" ? t("settings.test_running") : t("action.test")}
                            </button>
                          )}
                          <Switch on={enabled} onChange={(on) => toggleProvider(p.id, on)} />
                        </div>
                      </div>
                      <div className="set-row" style={{ justifyContent: "flex-start" }}>
                        <span className="desc" style={{ marginTop: 0 }}>
                          {/* 连接状态只说一次：未配置/未连接/已连接/…，不叠错误短词 */}
                          {credMissing
                            ? t("settings.cred_missing")
                            : isLocalLogs && (conn === "not_connected" || conn === "auth_required")
                              ? t("settings.local_logs_missing")
                              : conn === "not_connected" && (snap?.errorState?.code === "not_configured" || !snap?.errorState)
                              ? t("settings.cred_unset")
                              : `${t("settings.provider_state")}：${t(("state." + conn) as any)}${(() => { const e = snap?.errorState?.code; if (!e || e === "not_configured") return ""; const err = t(("error." + e) as any); const st = t(("state." + conn) as any); return err === st ? "" : ` · ${err}`; })()}`}
                          {!enabled ? t("settings.hidden_suffix") : ""}
                        </span>
                        {testing === "ok" && <span className="desc" style={{ marginTop: 0, color: "var(--fg)" }}>✓ {t("connect.test_ok")}</span>}
                        {p.id === "codex" && codexSess !== null && (
                          <span className="desc" style={{ marginTop: 0 }}>
                            {codexSess ? t("settings.codex_sess_in") : t("settings.codex_sess_out")}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {section === "refresh" && (
              <Row label={t("settings.smart")} desc={t("settings.smart_desc")}>
                <Seg
                  value={prefs.refresh}
                  onChange={(v) => {
                    set("refresh", v);
                    const ms = v === "smart" ? 0 : v === "1" ? 60_000 : v === "5" ? 300_000 : 600_000;
                    void notifySettings({ refreshIntervalMs: ms });
                  }}
                  options={[["smart", t("settings.smart")], ["1", t("settings.interval_1")], ["5", t("settings.interval_5")], ["10", t("settings.interval_10")]]}
                />
              </Row>
            )}

            {section === "notifications" && (
              <>
                <Row label={t("settings.notify_global")}>
                  <Switch on={prefs.notify} onChange={(v) => { set("notify", v); void notifySettings({ notifyEnabled: v }); }} />
                </Row>
                <Row label={t("settings.notify_warn", { value: prefs.warn })}>
                  <ThreshPick presets={[25, 20, 15]} value={prefs.warn} onChange={(v) => setThreshold("warn", v)} unit="%" min={0} max={100} />
                </Row>
                <Row label={t("settings.notify_crit", { value: prefs.crit })}>
                  <ThreshPick presets={[10, 5, 3]} value={prefs.crit} onChange={(v) => setThreshold("crit", v)} unit="%" min={0} max={100} />
                </Row>
                {snaps.deepseek?.connectionState === "connected" && (
                  <Row label={t("settings.notify_balance")}>
                    <ThreshPick presets={[30, 50, 100]} value={prefs.balance} onChange={(v) => setThreshold("balance", v)} unit="¥" min={0} max={10000} />
                  </Row>
                )}
              </>
            )}

            {section === "privacy" && (
              <>
                <p className="helper" style={{ marginTop: 0 }}>{t("settings.privacy_desc")}</p>
                <div>
                  {(["deepseek", "zcode"] as const).map((id) => {
                    const slot = id === "deepseek" ? "deepseek/api-key" : "zcode/coding-plan-key";
                    const set = creds[id] ?? false;
                    return (
                      <div key={id} className="cred-row">
                        <span className="cred-id">{slot}</span>
                        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span className="cred-state">{set ? t("settings.credential_set") : t("settings.credential_unset")}</span>
                          <button className="mini-btn" disabled={!set} onClick={() => clearCred(id)}>{t("action.clear")}</button>
                        </span>
                      </div>
                    );
                  })}
                  <div className="cred-row">
                    <span className="cred-id">mimo / web-session (isolated WebView2 profile)</span>
                    <button
                      className="mini-btn"
                      onClick={() => clearSession("mimo")}
                    >
                      {t("settings.clear_session")}
                    </button>
                  </div>
                  <div className="cred-row">
                    <span className="cred-id">workbuddy / web-session (isolated WebView2 profile)</span>
                    <button
                      className="mini-btn"
                      onClick={() => clearSession("workbuddy")}
                    >
                      {t("settings.clear_session")}
                    </button>
                  </div>
                  <p className="helper quiet">{t("settings.clear_session_note")}</p>
                  <p className="helper quiet" style={{ marginTop: 4 }}>{t("settings.privacy_logs_note")}</p>
                  <div className="cred-row">
                    <span className="cred-id">codex / chatgpt session（Managed Runtime）</span>
                    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span className="cred-state">
                        {snaps.codex?.connectionState === "connected" || snaps.codex?.connectionState === "degraded"
                          ? t("settings.codex_app_connected")
                          : t("settings.codex_app_disconnected")}
                      </span>
                      <button
                        className="mini-btn"
                        title={t("settings.disconnect_monitor_title")}
                        onClick={() => {
                          invoke("codex_logout").then(() => {
                            bridge.getSnapshots().then((all) => {
                              const m: Record<string, { connectionState?: string; errorState?: { code?: string } }> = {};
                              for (const s of all) m[s.providerId] = s;
                              setSnaps(m);
                            }).catch(() => {});
                          }).catch(() => {});
                        }}
                      >
                        {t("settings.disconnect_monitor")}
                      </button>
                    </span>
                  </div>
                </div>
              </>
            )}

            {section === "about" && (
              <>
                <div className="kv"><span>{t("settings.about_version")}</span><b>{appVersion || "—"}</b></div>
                <div className="kv">
                  <span>{t("settings.about_repo")}</span>
                  <b>
                    <a
                      className="link-btn"
                      href="https://github.com/Ciderrr/agent-quota-monitor"
                      onClick={(e) => {
                        e.preventDefault();
                        const url = "https://github.com/Ciderrr/agent-quota-monitor";
                        if (isTauri) invoke("open_external", { url }).catch(() => {});
                        else window.open(url, "_blank");
                      }}
                    >github.com/Ciderrr/agent-quota-monitor</a>
                  </b>
                </div>
                {/* 更新（v0.2.2）：手动检查 + 下载安装 + 进度；签名强制校验 */}
                <div className="kv" style={{ alignItems: "flex-start" }}>
                  <span>{t("settings.about_update")}</span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                    {isTauri && (
                      <>
                        {updateState === "idle" && (
                          <button className="mini-btn" onClick={runCheckUpdate}>{t("update.check")}</button>
                        )}
                        {updateState === "checking" && (
                          <span className="cred-state">
                            <span className="spinner" style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 6 }} />
                            {t("update.checking")}
                          </span>
                        )}
                        {updateState === "latest" && (
                          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span className="cred-state">✓ {t("update.latest")}</span>
                            <button className="mini-btn" onClick={runCheckUpdate}>{t("update.recheck")}</button>
                          </span>
                        )}
                        {updateState === "available" && updateInfo && (
                          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span className="cred-state">{t("update.available", { v: updateInfo.version ?? "" })}</span>
                            <button className="mini-btn" onClick={runInstallUpdate}>{t("update.install")}</button>
                          </span>
                        )}
                        {updateState === "downloading" && (
                          <span className="cred-state">
                            {t("update.downloading", { pct: updatePercent })} — {t("update.restart_note")}
                          </span>
                        )}
                        {updateState === "failed" && (
                          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span className="cred-state" style={{ color: "var(--crit)" }}>{t("update.failed")}</span>
                            <button className="mini-btn" onClick={runCheckUpdate}>{t("update.retry")}</button>
                          </span>
                        )}
                      </>
                    )}
                    {!isTauri && <span className="cred-state">{t("update.tauri_only")}</span>}
                  </span>
                </div>
                <p className="helper quiet">{t("settings.about_license")}</p>
              </>
            )}
          </div>
        </div>
      </div>
    </GlassSurface>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div>
        <div className="label">{label}</div>
        {desc ? <div className="desc">{desc}</div> : null}
      </div>
      {children}
    </div>
  );
}

function Seg({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} className={value === v ? "on" : ""} role="radio" aria-checked={value === v} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={`switch ${on ? "on" : ""}`} role="switch" aria-checked={on} onClick={() => onChange(!on)} />;
}

/** 默认视图模式卡片：内嵌主题化迷你预览（自动跟随 dark/light 变量） */
function ModeCard({ active, label, onClick, children }: {
  active: boolean; label: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button className={`mode-card ${active ? "on" : ""}`} role="radio" aria-checked={active} onClick={onClick}>
      <span className="mode-name">{label}</span>
      {children}
    </button>
  );
}

function MiniCollapsed() {
  return (
    <span className="mini">
      {[72, 55, 38].map((w, i) => (
        <span className="m-row" key={i}>
          <span className="m-line" style={{ width: `${34 - i * 6}%` }} />
          <span className="m-val" style={{ width: `${w / 3}%` }} />
        </span>
      ))}
      <span className="m-row">
        <span className="m-line" style={{ width: "28%" }} />
        <span className="m-money" />
      </span>
    </span>
  );
}

function MiniOverview() {
  return (
    <span className="mini">
      {[80, 62].map((w, i) => (
        <span className="m-block" key={i}>
          <span className="m-line" style={{ width: "42%" }} />
          <span className="m-bar"><i style={{ width: `${w}%` }} /></span>
        </span>
      ))}
      <span className="m-block">
        <span className="m-line" style={{ width: "36%" }} />
        <span className="m-bar"><i style={{ width: "45%" }} /></span>
      </span>
    </span>
  );
}

/** 阈值选择：3 个预设 + 自定义输入（0–100，越界钳制） */
function ThreshPick({ presets, value, onChange, unit, min, max }: {
  presets: number[]; value: number; onChange: (v: number) => void; unit: string; min: number; max: number;
}) {
  const { t } = useI18n();
  const clamp = (v: number) => {
    if (Number.isNaN(v)) return min;
    return Math.max(min, Math.min(max, v));
  };
  const [custom, setCustom] = useState(!presets.includes(value));
  const [draft, setDraft] = useState(String(value));
  const fmt = (p: number) => `${unit === "%" ? "" : unit}${p}${unit === "%" ? "%" : ""}`;
  return (
    <span className="thresh">
      <span className="seg" role="radiogroup">
        {presets.map((p) => (
          <button key={p} className={!custom && value === p ? "on" : ""} role="radio" aria-checked={!custom && value === p}
            onClick={() => { setCustom(false); setDraft(String(p)); onChange(clamp(p)); }}>{fmt(p)}</button>
        ))}
        <button className={custom ? "on" : ""} role="radio" aria-checked={custom}
          onClick={() => { setCustom(true); setDraft(String(value)); }}>{t("settings.custom")}</button>
      </span>
      {custom && (
        <input
          className="input num" type="number" value={draft} min={min} max={max}
          onChange={(e) => {
            setDraft(e.target.value);
            const v = Number(e.target.value);
            if (!Number.isNaN(v) && e.target.value !== "") onChange(clamp(v));
          }}
          onBlur={() => {
            const v = clamp(Number(draft));
            setDraft(String(v));
            onChange(v);
          }}
          aria-label={`${value}${unit}`}
        />
      )}
      {custom && <span className="unit">{unit}</span>}
    </span>
  );
}
