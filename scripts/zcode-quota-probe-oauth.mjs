// 补充验证（Gate A.1）：monitor 接口是否接受本机已有的 bigmodel OAuth access_token
// 只读 GET；白名单主机；token 值不落 fixture/控制台
// 用法: node scripts/zcode-quota-probe-oauth.mjs <输出fixture路径>
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const OUT = process.argv[2];
const ALLOWED_HOSTS = new Set(["api.z.ai", "open.bigmodel.cn"]);
function assertAllowed(url) { const u = new URL(url); if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.host)) throw new Error("host not allowed"); return url; }

function maskKeyLike(s) {
  return s.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}[.A-Za-z0-9_-]*/g, "[REDACTED_JWT]")
    .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_KEY]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[REDACTED_UUID]")
    .replace(/\b\d{14,}\b/g, "[REDACTED_LONG_ID]");
}
function redact(value, key = "") {
  if (typeof value === "string") {
    if (/account|user|email|token|secret|apikey|session/i.test(key) && !/reset|type/i.test(key)) return "[REDACTED]";
    return maskKeyLike(value);
  }
  if (typeof value === "number") return Math.abs(value) >= 1e14 ? "[REDACTED_LONG_ID]" : value;
  if (Array.isArray(value)) return value.map((v) => redact(v, key));
  if (value && typeof value === "object") { const o = {}; for (const [k, v] of Object.entries(value)) o[k] = redact(v, k); return o; }
  return value;
}

const creds = JSON.parse(readFileSync(join(homedir(), ".zcode", "v2", "credentials.json"), "utf8"));
const oauthToken = typeof creds["oauth:bigmodel:access_token"] === "string" ? creds["oauth:bigmodel:access_token"] : null;
const attempts = [];
if (!oauthToken) {
  attempts.push({ error: "oauth:bigmodel:access_token not present or not a string" });
} else {
  const describe = (s) => `oauth access token (len=${s.length}, jwt=${/^eyJ/.test(s)})`;
  console.log("testing " + describe(oauthToken));
  for (const style of ["raw", "bearer"]) {
    const url = assertAllowed("https://open.bigmodel.cn/api/monitor/usage/quota/limit");
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(url, { headers: { Authorization: style === "bearer" ? `Bearer ${oauthToken}` : oauthToken, "User-Agent": "agent-quota-monitor-probe/0.1", Accept: "application/json" }, signal: ctrl.signal });
      const text = await res.text();
      let body; try { body = redact(JSON.parse(text)); } catch { body = { unparsedBodyPreview: maskKeyLike(text.slice(0, 400)) }; }
      attempts.push({ credential: "oauth:bigmodel:access_token (value redacted)", host: "open.bigmodel.cn", authStyle: style === "bearer" ? "bearer" : "raw-token (no prefix)", httpStatus: res.status, body });
    } finally { clearTimeout(t); }
  }
}
const fixture = {
  capturedAt: new Date().toISOString(),
  source: { credentialSource: "~/.zcode/v2/credentials.json key 'oauth:bigmodel:access_token' (value redacted)", endpoint: "GET open.bigmodel.cn/api/monitor/usage/quota/limit", purpose: "supplementary: does the monitor endpoint accept the locally available OAuth session token?" },
  redaction: { applied: true, note: "token values removed; quota numbers preserved" },
  attempts,
};
writeFileSync(OUT, JSON.stringify(fixture, null, 2));
console.log("WROTE " + OUT);
for (const a of attempts) console.log(`${a.credential || a.error} ${a.authStyle || ""} http=${a.httpStatus ?? "-"} code=${a.body?.code ?? "-"} msg=${a.body?.msg ?? "-"}`);
