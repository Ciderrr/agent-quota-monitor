// MiMo Console Discovery Harness（研究专用，非产品组件）
// 目的：由用户亲自在官方页面登录后，捕获 Console 自己发出的 quota/usage 类请求与响应，
//       生成彻底脱敏的 fixture，用于完成 MiMo Token Plan Round 2 的登录态验证。
//
// 安全边界：
//  - 登录完全在小米官方页面完成；本脚本不读取、不记录、不代理任何账号/密码/短信码/2FA。
//  - 请求只记录 header 名称（绝不记录值）；URL 中 query 值一律替换为键名占位。
//  - 响应体按键名脱敏（token/cookie/手机号/邮箱/账户标识等 → [REDACTED]），仅保留 quota 数值。
//  - 凭证类与登录/SSO 端点的流量完全不采集。
//
// 用法: node scripts/mimo-console-harness.mjs
//       浏览器窗口打开后，请在官方页面完成登录并进入 Token Plan 管理页；
//       采集完成后回到本终端按 Enter 结束并写出 fixture。
import puppeteer from "puppeteer-core";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import readline from "node:readline";

const OUT = "fixtures/mimo-token-plan.redacted.json";
const TARGET = "https://platform.xiaomimimo.com/#/console/plan-manage";

// 只采集与 quota/usage/subscription/balance 相关的官方同源端点
const INCLUDE = /\/api\/v\d+\/(tokenPlan|usage|balance|subscription|billing)/i;
// 排除登录/认证/敏感端点（即使误配也不采集）
const EXCLUDE = /login|logout|auth|sso|oauth|token\/|apiKey|verify|sms|code|agreement|password|face|enterprise|card/i;
function collectible(url) {
  try {
    const u = new URL(url);
    if (u.host !== "platform.xiaomimimo.com") return false;
    if (!INCLUDE.test(u.pathname)) return false;
    if (EXCLUDE.test(u.pathname)) return false;
    return true;
  } catch { return false; }
}
function redactUrl(u) {
  try {
    const url = new URL(u);
    const keys = [...url.searchParams.keys()];
    return url.origin + url.pathname + (keys.length ? "?" + keys.map(k => `[Q:${k}]`).join("&") : "");
  } catch { return u; }
}
const SENSITIVE_KEY = /token|cookie|auth|secret|password|phone|mobile|email|userid|accountid|account_id|openid|unionid|nickname|username|user_name|realname|real_name|cardno|card_no|session|sub\b|name$/i;
function redact(value, key = "") {
  if (typeof value === "string") {
    if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
    if (/^eyJ[A-Za-z0-9_-]{8,}\./.test(value)) return "[REDACTED_JWT]";
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "[REDACTED_EMAIL]";
    if (/^\d{14,}$/.test(value)) return "[REDACTED_LONG_ID]";
    return value;
  }
  if (typeof value === "number") return Math.abs(value) >= 1e14 ? "[REDACTED_LONG_ID]" : value;
  if (Array.isArray(value)) return value.map((v) => redact(v, key));
  if (value && typeof value === "object") { const o = {}; for (const [k, v] of Object.entries(value)) o[k] = redact(v, k); return o; }
  return value;
}
function findBrowser() {
  for (const c of [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ]) { try { if (existsSync(c)) return c; } catch {} }
  throw new Error("no Edge/Chrome found");
}

mkdirSync(".tmp-mimo", { recursive: true });
const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: false,
  userDataDir: ".tmp-mimo/profile", // Monitor 专属研究 profile；可随时整个目录删除
  args: ["--no-first-run", "--disable-extensions", "--window-size=1280,860"],
});
const page = (await browser.pages())[0] || (await browser.newPage());

const requests = [];
const responses = [];
page.on("request", (req) => {
  const u = req.url();
  if (!collectible(u)) return;
  requests.push({ method: req.method(), url: redactUrl(u), headerNames: Object.keys(req.headers()) });
});
page.on("response", async (res) => {
  const u = res.url();
  if (!collectible(u)) return;
  const entry = { method: res.request().method(), url: redactUrl(u), status: res.status(), headerNames: Object.keys(res.headers()) };
  try {
    const ct = (res.headers()["content-type"] || "");
    if (ct.includes("json")) {
      const body = await res.json();
      entry.bodyRedacted = redact(body);
    }
  } catch { /* body 不可解析则只记录请求形态 */ }
  responses.push(entry);
  const m = /\/api\/v\d+\/[^\s]*/.exec(u);
  const short = m ? m[0] : u;
  console.log(`[captured] ${res.status()} ${short.slice(0, 90)}`);
});

console.log("=== MiMo Console Discovery Harness ===");
console.log("1) 即将打开官方控制台页面；请在官方页面完成登录（本脚本不接触你的账号密码）。");
console.log("2) 登录后进入 Token Plan 管理页（platform.xiaomimimo.com/#/console/plan-manage）。");
console.log("3) 看到额度/用量后，回到本终端按 Enter 结束并写出脱敏 fixture：" + OUT);
await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await new Promise((r) => rl.question("采集完成后按 Enter 结束...", r));
rl.close();
await browser.close().catch(() => {});

writeFileSync(OUT, JSON.stringify({
  capturedAt: new Date().toISOString(),
  source: { page: TARGET, harness: "scripts/mimo-console-harness.mjs (research-only)", note: "user logged in on the official page; only quota-related same-origin API traffic captured" },
  redaction: { applied: true, note: "header VALUES never recorded (names only); query values replaced by key placeholders; response fields token/cookie/account/phone/email etc. masked; quota numbers preserved" },
  requests, responses,
}, null, 2));
console.log("WROTE " + OUT + "  (requests=" + requests.length + ", responses=" + responses.length + ")");
