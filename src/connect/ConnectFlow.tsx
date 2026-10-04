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

export function ConnectFlow({ providerId, onClose }: { providerId: string; onClose: () => void }) {
  const { t } = useI18n();
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
              <div className="connect-hero-name">{t(meta.nameKey as any)}</div>
              <div className="connect-hero-sub">
                {meta.connectionMethods.map((m) => t(("conn." + m) as any)).join(" · ")}
              </div>
            </div>
          </div>
          {providerId === "codex" && <CodexFlow onClose={onClose} />}
          {(providerId === "zcode" || providerId === "deepseek" || providerId === "kimi" || providerId === "minimax") && <KeyFlow providerId={providerId} onClose={onClose} />}
          {providerId === "mimo" && <MimoFlow onClose={onClose} />}
          {providerId === "workbuddy" && <WorkbuddyFlow onClose={onClose} />}
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
  const closing = useAutoClose(onClose, stage === "success");

  const start = async () => {
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
    setMsg(t("connect.codex.preparing"));
    try {
      await invoke("codex_ensure_runtime");
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
      <button className="primary-btn" onClick={start} disabled={stage !== "idle" && stage !== "success" && stage !== "waiting" && stage !== "test-fail"}>
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
      {msg && <p className="helper" style={{ margin: 0, color: stage === "test-fail" ? "var(--crit)" : "var(--fg)" }}>{msg}</p>}
      {stage === "success" && <p className="helper" style={{ margin: 0, color: "var(--fg)" }}>✓ {closing.label}</p>}
      <p className="helper">{t("connect.codex.no_install")} {t("connect.codex.helper")}</p>
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
      <p className="helper quiet" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <IconLock /> {t("security.credential_notice")}
      </p>
    </>
  );
}

function KeyFlow({ providerId, onClose }: { providerId: string; onClose: () => void }) {
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
      const res = await bridge.connectWithCredential(providerId, value);
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
      await bridge.connectWithCredential(providerId, value);
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

function MimoFlow({ onClose }: { onClose: () => void }) {
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
      await invoke("mimo_open_login");
      setMsg(t("connect.mimo.wait_login"));
      setStage("reading");
      let tries = 0;
      const timer = setInterval(async () => {
        tries += 1;
        try {
          await invoke("mimo_read_usage");
          const snap = await bridge.getSnapshot("mimo");
          if (snap && snap.connectionState === "connected") {
            clearInterval(timer);
            setStage("got");
            setMsg("");
            invoke("mimo_close_login").catch(() => {});
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

function WorkbuddyFlow({ onClose }: { onClose: () => void }) {
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
      await invoke("workbuddy_open_login");
      setMsg(t("connect.wb.wait_login"));
      setStage("reading");
      let tries = 0;
      const timer = setInterval(async () => {
        tries += 1;
        try {
          await invoke("workbuddy_read_usage");
          const snap = await bridge.getSnapshot("workbuddy");
          if (snap && snap.connectionState === "connected") {
            clearInterval(timer);
            setStage("got");
            setMsg("");
            invoke("workbuddy_close_login").catch(() => {});
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
