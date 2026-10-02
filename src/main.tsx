import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme/tokens.css";
import "./theme/global.css";

function showFatal(msg: string) {
  const el = document.createElement("pre");
  el.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:#1a1a1a;color:#ff6b6b;padding:24px;font:13px/1.5 Consolas,monospace;white-space:pre-wrap;margin:0";
  el.textContent = "Render error:\n" + msg;
  document.body.appendChild(el);
}

class ErrorBoundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { err: e instanceof Error ? e.stack || e.message : String(e) };
  }
  render() {
    if (this.state.err) {
      return (
        <pre style={{ background: "#1a1a1a", color: "#ff6b6b", padding: 16, font: "12px Consolas, monospace", whiteSpace: "pre-wrap", height: "100%", margin: 0, boxSizing: "border-box" }}>
          {"Render error:\n" + this.state.err}
        </pre>
      );
    }
    return this.props.children;
  }
}

window.addEventListener("error", (e) => {
  showFatal(String(e.message || e.error || "unknown error"));
});
window.addEventListener("unhandledrejection", (e) => {
  // 异步失败（如刷新超时）不致命：只记控制台；快照状态本身会如实反馈到 UI
  console.error("[aqm] unhandled rejection:", e.reason);
});
// 屏蔽 WebView 默认右键菜单（含「分享」等会卡死的项）；精简层自定义菜单不受影响
window.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

try {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("#root missing");
  createRoot(rootEl).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
} catch (e) {
  showFatal(e instanceof Error ? (e.stack || e.message) : String(e));
}
