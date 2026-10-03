// codex app-server 只读探测脚本（Gate A.1 运行时验证）
// - 启动本机官方 Codex CLI 的 app-server（JSON-RPC over stdio，行分隔）
// - 调用 initialize → account/rateLimits/read
// - 输出脱敏 fixture；绝不打印/写入任何 token；不写 auth.json；不调用 consume/refresh 方法
// 用法: node scripts/codex-appserver-probe.mjs <输出fixture路径>
import { spawn } from "node:child_process";
import { writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2];
if (!OUT) { console.error("usage: node codex-appserver-probe.mjs <fixture-out>"); process.exit(2); }

// 动态解析本机 codex.exe（版本目录会随 CLI 升级变化，勿硬编码）：
// CODEX_PATH → 本机 OpenAI\Codex\bin\<ver>\codex.exe → managed runtime → PATH
function resolveCodex() {
  if (process.env.CODEX_PATH && existsSync(process.env.CODEX_PATH)) return process.env.CODEX_PATH;
  const bin = join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
  if (existsSync(bin)) {
    for (const ent of readdirSync(bin)) {
      const cand = join(bin, ent, "codex.exe");
      if (existsSync(cand)) return cand;
    }
  }
  const managed = join(process.env.LOCALAPPDATA, "AgentQuotaMonitor", "runtimes", "codex", "0.158.0", "codex.exe");
  if (existsSync(managed)) return managed;
  return "codex.exe";
}
const CODEX = resolveCodex();

// ---- 脱敏 ----
const SAFE_ID_KEYS = new Set(["limitid", "plantype", "resettype", "status", "normalmodelslug", "limitname", "type", "unit", "kind"]);
function isSensitiveKey(key) {
  const k = key.toLowerCase().replace(/[_-]/g, "");
  if (SAFE_ID_KEYS.has(k)) return false;
  if (k === "id" || k.endsWith("id") && !["resetsat"].includes(k)) return true; // 各类 id（accountId/userId/reset-credit id 等）
  return /account|user|workspace|email|jwt|token|secret|session|apikey|sub\b/.test(k);
}
function redact(value, key = "") {
  if (typeof value === "string") {
    if (/^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(value)) return "[REDACTED_JWT]";
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "[REDACTED_EMAIL]";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return "[REDACTED_UUID]";
    if (/^\d{14,}$/.test(value)) return "[REDACTED_LONG_ID]";
    if (isSensitiveKey(key)) return "[REDACTED]";
    return value;
  }
  if (typeof value === "number") {
    if (Number.isInteger(value) && Math.abs(value) >= 1e14) return "[REDACTED_LONG_ID]"; // 保留 epoch 秒/毫秒
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, key));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k);
    return out;
  }
  return value;
}

// ---- JSON-RPC over stdio（行分隔）----
const child = spawn(CODEX, ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const pending = new Map(); // id -> resolve
const notifications = [];
let nextId = 1;
function send(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
  child.stdin.write(JSON.stringify(msg) + "\n");
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, timer: setTimeout(() => { pending.delete(id); reject(new Error(`timeout waiting for ${method}`)); }, 25000) });
  });
}
child.stdout.on("data", (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { console.error("[non-json stdout line] " + line.slice(0, 120)); continue; }
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = pending.get(msg.id);
      if (p) { clearTimeout(p.timer); pending.delete(msg.id); msg.error ? p.reject(new Error(methodErr(msg))) : p.resolve(msg.result); }
    } else if (msg.method) {
      notifications.push(msg.method);
    }
  }
});
function methodErr(msg) { return `JSON-RPC error: ${JSON.stringify(msg.error).slice(0, 300)}`; }
let stderrTail = "";
child.stderr.on("data", (d) => { stderrTail = (stderrTail + d.toString()).slice(-2000); });
child.on("exit", (code) => console.error(`[app-server exited code=${code}]`));

const deadline = setTimeout(() => { console.error("[global timeout]"); child.kill(); process.exit(1); }, 60000);

try {
  const initResult = await send("initialize", {
    clientInfo: { name: "agent-quota-monitor-probe", title: "Agent Quota Monitor Probe", version: "0.1.0" },
    capabilities: { experimentalApi: false },
  });
  console.error("[initialize OK]");
  const rateLimits = await send("account/rateLimits/read", { supportsLunaReserve: false, excludeResetCreditDetails: false });
  console.error("[account/rateLimits/read OK]");

  const fixture = {
    capturedAt: new Date().toISOString(),
    source: {
      command: "<LOCALAPPDATA>\\OpenAI\\Codex\\bin\\faa963e871dd422c\\codex.exe app-server",
      transport: "JSON-RPC over stdio (newline-delimited)",
      codexVersion: "codex-cli 0.158.0-alpha.2.1",
      protocolSchema: "generated via `codex app-server generate-json-schema` (app-server protocol v2)",
    },
    method: "account/rateLimits/read",
    params: { supportsLunaReserve: false, excludeResetCreditDetails: false },
    notificationsObserved: [...new Set(notifications)],
    redaction: {
      applied: true,
      note: "account/user/workspace ids, emails, tokens, opaque reset-credit ids, long numeric ids removed; quota percentages, window durations, epoch timestamps, enums preserved",
    },
    initializeResponseRedacted: redact(initResult),
    responseRedacted: redact(rateLimits),
  };
  writeFileSync(OUT, JSON.stringify(fixture, null, 2));
  console.log("WROTE " + OUT);
  console.log("notifications: " + [...new Set(notifications)].join(", "));
} catch (e) {
  console.error("PROBE FAILED: " + e.message);
  console.error("[stderr tail] " + stderrTail.slice(-800));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  child.kill();
}
