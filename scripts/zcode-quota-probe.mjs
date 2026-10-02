// ZCode/GLM Coding Plan 用量接口只读运行时验证（Gate A.1）
// - 从 ~/.zcode/v2/credentials.json 自动发现 coding-plan api-key（只提取、不存储、不打印）
// - 按区域映射调用官方 GET /api/monitor/usage/quota/limit（裸 key；失败才对比 Bearer 变体）
// - 输出脱敏 fixture；主机白名单硬校验；凭证值永不写入 fixture/控制台
// 用法: node scripts/zcode-quota-probe.mjs <输出fixture路径>
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const OUT = process.argv[2];
if (!OUT) { console.error("usage: node zcode-quota-probe.mjs <fixture-out>"); process.exit(2); }

const ALLOWED_HOSTS = new Set(["api.z.ai", "open.bigmodel.cn"]); // 白名单：拒绝其余一切主机（含内网/环回）
const BASE_BY_FAMILY = { zai: "https://api.z.ai", bigmodel: "https://open.bigmodel.cn" };

function assertAllowed(url) {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("refusing non-https: " + url);
  if (!ALLOWED_HOSTS.has(u.host)) throw new Error("host not in allowlist: " + u.host);
  return url;
}

// ---- 脱敏 ----
function maskKeyLike(s) {
  return s
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}[.A-Za-z0-9_-]*/g, "[REDACTED_JWT]")
    .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_KEY]") // id.secret 形态
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[REDACTED_UUID]")
    .replace(/\b\d{14,}\b/g, "[REDACTED_LONG_ID]"); // 保留 13 位 epoch ms
}
function redact(value, key = "") {
  if (typeof value === "string") {
    if (/account|user|email|token|secret|apikey|session/i.test(key) && !/reset|type/i.test(key)) return "[REDACTED]";
    return maskKeyLike(value);
  }
  if (typeof value === "number") return Math.abs(value) >= 1e14 ? "[REDACTED_LONG_ID]" : value; // epoch ms ~1.79e12 保留
  if (Array.isArray(value)) return value.map((v) => redact(v, key));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k);
    return out;
  }
  return value;
}

// ---- 从 credentials.json 提取 key（值不落日志）----
const credPath = join(homedir(), ".zcode", "v2", "credentials.json");
const creds = JSON.parse(readFileSync(credPath, "utf8"));
// 值为 ~113 字符复合串（含 : . - _，两个点号）；不猜测内部格式，原样作为 Authorization 发送
function looksLikeKey(s) { return typeof s === "string" && s.length >= 40 && /^[A-Za-z0-9._:\-]+$/.test(s.trim()) && s.includes("."); }
function extractKey(v) {
  if (typeof v === "string") return looksLikeKey(v) ? v.trim() : null;
  if (v && typeof v === "object") {
    for (const k of ["key", "api_key", "apiKey", "value", "token", "secret"]) {
      if (typeof v[k] === "string" && v[k].length > 20) return v[k].trim();
    }
    for (const val of Object.values(v)) { const hit = extractKey(val); if (hit) return hit; }
  }
  return null;
}
const entries = [];
for (const [name, value] of Object.entries(creds)) {
  if (!name.includes("coding-plan") || !name.endsWith(":api-key")) continue;
  const family = name.includes("zai") ? "zai" : name.includes("bigmodel") ? "bigmodel" : null;
  const role = name.includes("team") ? "team" : name.includes("individual") ? "individual" : "unknown";
  const key = extractKey(value);
  entries.push({ nameId: "[REDACTED:" + (family || "?") + "/" + role + "]", family, role, keyLen: key ? key.length : 0, key });
}
console.log("discovered entries: " + entries.map(e => `${e.nameId}(keyLen=${e.keyLen})`).join(", "));

// ---- 请求 ----
async function call(base, key, authStyle) {
  const url = assertAllowed(base + "/api/monitor/usage/quota/limit");
  const auth = authStyle === "bearer" ? `Bearer ${key}` : key; // raw = 无前缀
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { Authorization: auth, "User-Agent": "agent-quota-monitor-probe/0.1", Accept: "application/json" }, signal: ctrl.signal });
    const text = await res.text();
    let body;
    try { body = redact(JSON.parse(text)); } catch { body = { unparsedBodyPreview: maskKeyLike(text.slice(0, 400)) }; }
    return { httpStatus: res.status, contentType: res.headers.get("content-type") || "", body };
  } finally { clearTimeout(t); }
}

const attempts = [];
for (const e of entries) {
  if (!e.family || !e.key) { attempts.push({ entry: e.nameId, error: "no usable key extracted" }); continue; }
  const base = BASE_BY_FAMILY[e.family];
  const main = await call(base, e.key, "raw");
  attempts.push({ entry: e.nameId, family: e.family, host: new URL(base).host, authStyle: "raw-key (no Bearer prefix)", ...main });
  const ok = main.httpStatus === 200 && main.body && main.body.code === 0;
  if (!ok) { // 失败才做一次 Bearer 对比，回答“是否裸 key”
    const alt = await call(base, e.key, "bearer");
    attempts.push({ entry: e.nameId, family: e.family, host: new URL(base).host, authStyle: "bearer (对比用)", ...alt });
  }
}

const fixture = {
  capturedAt: new Date().toISOString(),
  source: {
    credentialSource: "~/.zcode/v2/credentials.json (entries account-provider:coding-plan:account:*:api-key, entry names & key values redacted)",
    endpoint: "GET {base}/api/monitor/usage/quota/limit",
    baseByFamily: BASE_BY_FAMILY,
    note: "read-only validation; one GET per discovered key (+ one Bearer comparison per failing family)",
  },
  redaction: { applied: true, note: "keys/jwts/uuids/long numeric ids removed; epoch-ms timestamps (13 digits) and quota numbers preserved" },
  attempts,
};
writeFileSync(OUT, JSON.stringify(fixture, null, 2));
console.log("WROTE " + OUT);
for (const a of attempts) {
  if (a.error) { console.log(`${a.entry}: ERROR ${a.error}`); continue; }
  const b = a.body || {};
  const limits = b?.data?.limits;
  console.log(`${a.entry} ${a.authStyle} http=${a.httpStatus} code=${b?.code} level=${b?.data?.level ?? "-"} limits=${Array.isArray(limits) ? limits.map(l => `${l.type}:unit${l.unit}`).join("|") : "-"}`);
}
