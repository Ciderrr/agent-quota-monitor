import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { bridge, isTauri } from "../bridge";
import { metaOf } from "../types/provider";
import { useI18n } from "../i18n";
import { IconClose, IconExternal, IconLock } from "../ui/icons";
import { GlassSurface } from "../ui/GlassSurface";

type Stage = "idle" | "browser" | "waiting" | "success" | "testing" | "test-ok" | "test-fail" | "saved";

/** 已完成 + 3 秒倒计时自动关闭（用户要求的连接完成 UX） */
function useAutoClose(onClose: () => void, active: boolean) {
  const { t } = useI18n();
  const [left, setLeft] = useState(3);
  useEffect(() => {
    if (!active) return;
    setLeft(3);
    const iv = setInterval(() => setLeft((s) => s - 1), 1000);
    const to = setTimeout(onClose, 3000);
    return () => { clearInterval(iv); clearTimeout(to); };
  }, [active]);
  return { left, label: t("connect.auto_close", { s: Math.max(0, left) }) };
}

export function ConnectFlow({ providerId: rawId, onClose }: { providerId: string; onClose: () => void }) {
  const { t } = useI18n();
  // v0.4：providerId 可为复合实例键 "{provider}/{account}"（设置页添加账号时传入）；缺省 main
  const { providerId, accountId } = (() => {
    const [p, a] = rawId.split("/");
    return { providerId: p, accountId: a };
  })();
  const meta = metaOf(providerId);
  return (
    <GlassSurface className="glass-strong sim-window" data-window role="dialog" aria-label={t("connect.title", { name: t(meta.nameKey as any) })}>
      <div className="win-head">
        <div className="win-title">{t("connect.title", { name: t(meta.nameKey as any) })}</div>
        <button className="icon-btn" aria-label={t("action.close")} onClick={onClose}><IconClose /></button>
      </div>
      <div className="win-body">
        <div className="connect-flow">
          <div className="connect-hero">
            <div className="tile">{meta.shortName[0]}</div>
            <div>
              <div className="connect-hero-name">{t(meta.nameKey as any)}{accountId && accountId !== "main" ? ` · ${accountId.slice(0, 4)}` : ""}</div>
              <div className="connect-hero-sub">
                {meta.connectionMethods.map((m) => t(("conn." + m) as any)).join(" · ")}
              </div>
            </div>
          </div>
          {providerId === "codex" && <CodexFlow onClose={onClose} />}
          {(providerId === "zcode" || providerId === "deepseek" || providerId === "kimi" || providerId === "minimax") && <KeyFlow providerId={providerId} accountId={accountId} onClose={onClose} />}
          {providerId === "mimo" && <MimoFlow accountId={accountId} onClose={onClose} />}
          {providerId === "workbuddy" && <WorkbuddyFlow accountId={accountId} onClose={onClose} />}
        </div>
      </div>
    </GlassSurface>
  );
}

function CodexFlow({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const meta = metaOf("codex");
  const [stage, setStage] = useState<Stage>("idle");
  const [msg, setMsg] = useState<string>("");
  // 连接模式（用户实测反馈：让用户明确选择"本机 Codex 自动获取"还是"无 Codex 继续下载"，
  // 而不是后台静默探测——auth.json 存在≠令牌有效，静默选择会让两种失败互相矛盾）
  const [mode, setMode] = useState<"local" | "managed" | null>(isTauri ? null : "managed");
  const [localAuth, setLocalAuth] = useState<boolean | null>(null);
  const closing = useAutoClose(onClose, stage === "success");

  // 挂载时探测本机登录，预选模式
  useEffect(() => {
    invoke<{ localAuth?: boolean }>("codex_login_status")
      .then((r) => {
        const has = r?.localAuth ?? false;
        setLocalAuth(has);
        if (has) setMode("local");
      })
      .catch(() => {});
  }, []);

  // 模式一：本机 Codex 直读（零下载、零登录）
  const runLocal = async () => {
    setMode("local");
    if (!isTauri) {
      // 浏览器原型：模拟读取成功（ui-check 路径）
      setStage("testing");
      setTimeout(async () => {
        await bridge.markConnected("codex");
        setStage("success");
      }, 1600);
      return;
    }
    setStage("testing");
    setMsg(t("connect.codex.local_mode"));
    try {
      await invoke("set_codex_mode", { mode: "local" });
      const snap = await invoke<{ connectionState?: string; errorState?: { code?: string } }>("codex_read_rate_limits");
      if (snap?.connectionState === "connected" || snap?.connectionState === "degraded") {
        setStage("success");
        setMsg(t("connect.codex.got_quota"));
      } else {
        setStage("test-fail");
        const code = snap?.errorState?.code;
        setMsg(
          code === "login_expired"
            ? t("connect.codex.local_expired_hint")
            : t("connect.read_fail", { code: code ?? "unknown" }),
        );
      }
    } catch (e) {
      setStage("test-fail");
      setMsg(t("connect.read_fail", { code: String(e) }));
    }
  };

  // 模式二：托管组件 + 浏览器登录（原流程，尊重用户选择强制下载）
  const runManaged = async () => {
    setMode("managed");
    if (!isTauri) {
      setStage("browser");
      setTimeout(() => setStage("waiting"), 700);
      setTimeout(async () => {
        await bridge.markConnected("codex");
        setStage("success");
      }, 2600);
      return;
    }
    setStage("browser");
    try {
      await invoke("set_codex_mode", { mode: "managed" });
      await invoke("codex_ensure_runtime", { forceManaged: true });
    } catch (e) {
      setStage("test-fail");
      setMsg(t("connect.codex.prepare_fail", { err: String(e) }));
      return;
    }
    try {
      await invoke("codex_login_chatgpt");
      setStage("waiting");
      setMsg(t("connect.codex.wait_login"));
      // 自动轮询，不必手点（变量勿名 t——会遮蔽 i18n 的 t）
      let n = 0;
      const poll = setInterval(async () => {
        n += 1;
        try {
          const snap = await invoke<{ connectionState?: string }>("codex_read_rate_limits");
          if (snap?.connectionState === "connected" || snap?.connectionState === "degraded") {
            clearInterval(poll);
            setStage("success");
            setMsg(t("connect.codex.got_quota"));
          }
        } catch { /* wait */ }
        if (n >= 36) {
          clearInterval(poll);
          setStage("test-fail");
          setMsg(t("connect.codex.fail_expired"));
        }
      }, 3000);
    } catch (e) {
      setStage("test-fail");
      setMsg(String(e));
    }
  };

  const afterLogin = async () => {
    setStage("testing");
    try {
      const snap = await invoke<{ connectionState?: string; errorState?: { code?: string; detail?: string } }>("codex_read_rate_limits");
      if (snap?.connectionState === "connected" || snap?.connectionState === "degraded") {
        setStage("success");
        setMsg(t("connect.codex.got_quota"));
      } else {
        setStage("test-fail");
        const code = snap?.errorState?.code;
        setMsg(code === "network_unavailable"
          ? t("connect.codex.fail_no_response")
          : code ? t("connect.read_fail", { code }) : t("connect.not_logged_in"));
      }
    } catch (e) {
      setStage("test-fail");
      setMsg(String(e));
    }
  };

  return (
    <>
      {/* 连接模式选择（用户实测反馈：明确二选一，而非后台静默探测） */}
      <div className="mode-cards">
        <button className={`mode-card ${mode === "local" ? "on" : ""}`} onClick={() => setMode("local")}>
          <span className="mode-name">{t("connect.codex.mode_local")}</span>
          <span className="helper">
            {localAuth === null
              ? t("connect.codex.mode_local_desc")
              : localAuth
                ? t("connect.codex.mode_local_detected")
                : t("connect.codex.mode_local_none")}
          </span>
        </button>
        <button className={`mode-card ${mode === "managed" ? "on" : ""}`} onClick={() => setMode("managed")}>
          <span className="mode-name">{t("connect.codex.mode_managed")}</span>
          <span className="helper">{t("connect.codex.mode_managed_desc")}</span>
        </button>
      </div>
      {mode === "local" && (
        <button className="primary-btn" onClick={runLocal} disabled={stage === "testing"}>
          {stage === "testing" ? t("connect.reading") : t("connect.codex.read_local")}
        </button>
      )}
      {mode === "managed" && (
        <>
          <button
            className="primary-btn"
            onClick={runManaged}
            disabled={stage !== "idle" && stage !== "success" && stage !== "waiting" && stage !== "test-fail"}
          >
            {stage === "success" ? t("connect.done") : t("connect.codex.primary")}
          </button>
          {isTauri && (
            <>
              <button
                className="foot-btn"
                onClick={() => {
                  if (isTauri) invoke("open_external", { url: meta.officialUsageUrl }).catch(() => {});
                }}
              >
                打开登录页
              </button>
              <button className="foot-btn" onClick={afterLogin} disabled={stage === "testing"}>
                {stage === "testing" ? t("connect.reading") : t("connect.i_logged_in")}
              </button>
            </>
          )}
        </>
      )}
      {msg && <p className="helper" style={{ margin: 0, color: stage === "test-fail" ? "var(--crit)" : "var(--fg)" }}>{msg}</p>}
      {stage === "success" && <p className="helper" style={{ margin: 0, color: "var(--fg)" }}>✓ {closing.label}</p>}
      {mode !== "local" && <p className="helper">{t("connect.codex.no_install")} {t("connect.codex.helper")}</p>}
      {mode === "managed" && (
        <div className="steps">
          {[t("connect.codex.step1"), t("connect.codex.step2"), t("connect.codex.step3")].map((label, i) => {
            const idx = stage === "idle" || stage === "browser" ? 0 : stage === "waiting" ? 1 : stage === "success" ? 3 : 1;
            const cls = i < idx ? "done" : i === idx && stage !== "idle" ? "active" : "";
            return (
              <div key={i} className={`step ${cls}`}>
                <span className="idx">{i < idx ? "✓" : i + 1}</span>
                {label}
                {i === 1 && stage === "waiting" && <span className="spinner" />}
              </div>
            );
          })}
        </div>
      )}
      <p className="helper quiet" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <IconLock /> {t("security.credential_notice")}
      </p>
    </>
  );
}

function KeyFlow({ providerId, accountId, onClose }: { providerId: string; accountId?: string; onClose: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [stage, setStage] = useState<Stage>("idle");

  const test = async () => {
    if (!value.trim()) {
      setStage("test-fail");
      return;
    }
    setStage("testing");
    try {
      // 真实连通性：写入凭据管理器并抓一次官方接口
      const res = await bridge.connectWithCredential(providerId, value, accountId);
      if (res && res.ok) {
        setStage("test-ok");
      } else {
        setStage("test-fail");
      }
    } catch {
      setStage("test-fail");
    }
  };
  const save = async () => {
    try {
      await bridge.connectWithCredential(providerId, value, accountId);
    } catch { /* ignore */ }
    setValue("");
    setStage("saved");
  };
  const closing = useAutoClose(onClose, stage === "saved");

  const helper =
    providerId === "zcode" ? t("connect.zcode.helper")
    : providerId === "kimi" ? t("connect.kimi.helper")
    : providerId === "minimax" ? t("connect.minimax.helper")
    : t("connect.deepseek.helper");

  return (
    <>
      <p className="helper">{helper}</p>
      <input
        className="input" type="password" placeholder={t("connect.key_placeholder")}
        value={value} onChange={(e) => { setValue(e.target.value); setStage("idle"); }}
        aria-label={t("connect.key_placeholder")}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="foot-btn" onClick={test} disabled={stage === "testing"}>
          {stage === "testing" ? <span className="spinner" style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 6 }} /> : null}
          {t("action.test")}
        </button>
        {stage === "test-ok" && <span className="row-state" style={{ color: "var(--fg)" }}>✓ {t("connect.test_ok")}</span>}
        {stage === "test-fail" && (
          <span className="row-state" style={{ color: "var(--crit)" }}>
            ✗ {!value.trim() ? t("connect.key_required") : t("connect.test_fail")}
          </span>
        )}
      </div>
      <button className="primary-btn" onClick={save} disabled={stage !== "test-ok"}>
        {stage === "saved" ? t("connect.done") : t("action.save")}
      </button>
      {stage === "saved" && <p className="helper" style={{ margin: 0, color: "var(--fg)" }}>✓ {closing.label}</p>}
      <p className="secure-note">{t("security.credential_notice")}</p>
      <p className="helper quiet">{t("connect.secure_note")}</p>
    </>
  );
}

function MimoFlow({ accountId, onClose }: { accountId?: string; onClose: () => void }) {
  const { t } = useI18n();
  const meta = metaOf("mimo");
  const [stage, setStage] = useState<"idle" | "reading" | "got">("idle");
  const [msg, setMsg] = useState("");
  const closing = useAutoClose(onClose, stage === "got");

  const startDemo = async () => {
    setStage("reading");
    await new Promise((r) => setTimeout(r, 1600));
    await bridge.markConnected("mimo");
    setStage("got");
  };

  const openLogin = async () => {
    try {
      await invoke("mimo_open_login", { account: accountId ?? null });
      setMsg(t("connect.mimo.wait_login"));
      setStage("reading");
      let tries = 0;
      const timer = setInterval(async () => {
        tries += 1;
        try {
          await invoke("mimo_read_usage", { account: accountId ?? null });
          const snap = await bridge.getSnapshot("mimo");
          if (snap && snap.connectionState === "connected") {
            clearInterval(timer);
            setStage("got");
            setMsg("");
            invoke("mimo_close_login", { account: accountId ?? null }).catch(() => {});
            return;
          }
        } catch {
          /* 未登录继续等 */
        }
        if (tries >= 24) {
          clearInterval(timer);
          setStage("idle");
          setMsg(t("connect.mimo.retry_hint"));
        }
      }, 2500);
    } catch (e) {
      setMsg(String(e));
    }
  };

  return (
    <>
      <div className="status-banner">
        <span className="dot" style={{ marginTop: 5, background: "var(--warn)" }} />
        <div>
          <b>{t("connect.mimo.status_title")}</b>
          {t("connect.mimo.status_desc")}
        </div>
      </div>
      <p className="helper">{t("connect.mimo.plan_desc")}</p>
      <p className="helper">{t("connect.mimo.flow_desc")}</p>
      <p className="secure-note">{t("security.mimo_session_notice")}</p>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {isTauri ? (
          <>
            <button className="foot-btn" onClick={openLogin}>
              {stage === "reading" ? t("connect.waiting_login") : t("connect.open_official_login")}
            </button>
            {stage === "reading" && (
              <span className="row-state" style={{ color: "var(--fg-2)" }}>
                <span className="spinner" style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 6 }} />
                {t("connect.auto_reading_quota")}
              </span>
            )}
          </>
        ) : (
          <>
            <button
              className="foot-btn"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              onClick={() => window.open(meta.officialUsageUrl, "_blank")}
            >
              <IconExternal /> {t("connect.mimo.open_console")}
            </button>
            {stage !== "got" && (
              <button className="foot-btn" disabled={stage === "reading"} onClick={startDemo}>
                {stage === "reading" ? <span className="spinner" style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 6 }} /> : null}
                {stage === "reading" ? t("connect.mimo.reading") : t("connect.mimo.demo_btn")}
              </button>
            )}
          </>
        )}
      </div>
      {msg && <p className="helper" style={{ margin: "6px 0 0" }}>{msg}</p>}
      {stage === "got" && (
        <>
          <p className="helper" style={{ margin: 0, color: "var(--fg)" }}>✓ {t("connect.mimo.got")} · {closing.label}</p>
          {!isTauri && <p className="helper quiet" style={{ margin: 0 }}>{t("connect.mimo.demo_note")}</p>}
        </>
      )}
    </>
  );
}

function WorkbuddyFlow({ accountId, onClose }: { accountId?: string; onClose: () => void }) {
  const { t } = useI18n();
  const meta = metaOf("workbuddy");
  const [stage, setStage] = useState<"idle" | "reading" | "got">("idle");
  const [msg, setMsg] = useState("");
  const closing = useAutoClose(onClose, stage === "got");

  const startDemo = async () => {
    setStage("reading");
    await new Promise((r) => setTimeout(r, 1600));
    await bridge.markConnected("workbuddy");
    setStage("got");
  };

  const openLogin = async () => {
    try {
      await invoke("workbuddy_open_login", { account: accountId ?? null });
      setMsg(t("connect.wb.wait_login"));
      setStage("reading");
      let tries = 0;
      const timer = setInterval(async () => {
        tries += 1;
        try {
          await invoke("workbuddy_read_usage", { account: accountId ?? null });
          const snap = await bridge.getSnapshot("workbuddy");
          if (snap && snap.connectionState === "connected") {
            clearInterval(timer);
            setStage("got");
            setMsg("");
            invoke("workbuddy_close_login", { account: accountId ?? null }).catch(() => {});
            return;
          }
        } catch {
          /* 未登录继续等 */
        }
        if (tries >= 24) {
          clearInterval(timer);
          setStage("idle");
          setMsg(t("connect.wb.retry_hint"));
        }
      }, 2500);
    } catch (e) {
      setMsg(String(e));
    }
  };

  return (
    <>
      <div className="status-banner">
        <span className="dot" style={{ marginTop: 5, background: "var(--warn)" }} />
        <div>
          <b>{t("connect.workbuddy.status_title")}</b>
          {t("connect.workbuddy.status_desc")}
        </div>
      </div>
      <p className="helper">{t("connect.workbuddy.plan_desc")}</p>
      <p className="helper">{t("connect.workbuddy.flow_desc")}</p>
      <p className="secure-note">{t("security.workbuddy_session_notice")}</p>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {isTauri ? (
          <>
            <button className="foot-btn" onClick={openLogin}>
              {stage === "reading" ? t("connect.waiting_login") : t("connect.open_official_login")}
            </button>
            {stage === "reading" && (
              <span className="row-state" style={{ color: "var(--fg-2)" }}>
                <span className="spinner" style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 6 }} />
                {t("connect.auto_reading_credits")}
              </span>
            )}
          </>
        ) : (
          <>
            <button
              className="foot-btn"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              onClick={() => window.open(meta.officialUsageUrl, "_blank")}
            >
              <IconExternal /> {t("connect.workbuddy.open_console")}
            </button>
            {stage !== "got" && (
              <button className="foot-btn" disabled={stage === "reading"} onClick={startDemo}>
                {stage === "reading" ? <span className="spinner" style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 6 }} /> : null}
                {stage === "reading" ? t("connect.workbuddy.reading") : t("connect.workbuddy.demo_btn")}
              </button>
            )}
          </>
        )}
      </div>
      {msg && <p className="helper" style={{ margin: "6px 0 0" }}>{msg}</p>}
      {stage === "got" && (
        <>
          <p className="helper" style={{ margin: 0, color: "var(--fg)" }}>✓ {t("connect.workbuddy.got")} · {closing.label}</p>
          {!isTauri && <p className="helper quiet" style={{ margin: 0 }}>{t("connect.workbuddy.demo_note")}</p>}
        </>
      )}
    </>
  );
}

// 防止未使用告警（占位：正式实现由 App 传入 onClose）
const onCloseSafe = () => {};
