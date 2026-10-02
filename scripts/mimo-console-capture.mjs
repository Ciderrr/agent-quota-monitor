// MiMo Console 无登录态网络捕获（Round 2 研究专用，不属于产品）
// 观察官方控制台 SPA 自己发出的网络请求（方法/路径/query键/状态码）；
// 不记录任何请求头值、Cookie、token；仅研究用途。
// 用法: node scripts/mimo-console-capture.mjs [输出json] [等待毫秒]
import puppeteer from "puppeteer-core";
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = process.argv[2] || ".tmp-mimo/capture-unauth.json";
const WAIT = Number(process.argv[3] || 20000);
const TARGET = "https://platform.xiaomimimo.com/#/console/plan-manage";

function findBrowser() {
  const cands = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const c of cands) { try { if (existsSync(c)) return c; } catch {} }
  throw new Error("no Edge/Chrome found");
}
import { existsSync } from "node:fs";

function redactUrl(u) {
  try {
    const url = new URL(u);
    const keys = [...url.searchParams.keys()];
    return url.origin + url.pathname + (keys.length ? "?" + keys.map(k => `[Q:${k}]`).join("&") : "") + (url.hash ? "#[ROUTE]" : "");
  } catch { return u; }
}

mkdirSync(".tmp-mimo", { recursive: true });
const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: "new",
  args: ["--no-first-run", "--disable-extensions", "--window-size=1440,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const requests = [];
page.on("request", (req) => {
  requests.push({ phase: "request", url: redactUrl(req.url()), method: req.method(), type: req.resourceType() });
});
page.on("response", (res) => {
  requests.push({ phase: "response", url: redactUrl(res.url()), status: res.status(), type: res.request().resourceType() });
});
page.on("requestfailed", (req) => {
  requests.push({ phase: "failed", url: redactUrl(req.url()), method: req.method(), error: req.failure()?.errorText || "" });
});

console.log("navigating: " + TARGET);
try { await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 30000 }); } catch (e) { console.log("goto note: " + e.message); }
await new Promise(r => setTimeout(r, WAIT));
const finalUrl = redactUrl(page.url());
await browser.close();

// 摘要
const api = requests.filter(r => /platform\.xiaomimimo\.com\/api\//.test(r.url));
const sso = requests.filter(r => /(xiaomi|mi\.com|account)/i.test(r.url) && !/platform\.xiaomimimo\.com/.test(r.url)).slice(0, 25);
const js = [...new Set(requests.filter(r => r.type === "script").map(r => r.url.replace(/#\[ROUTE\]$/, "")))];
const xhr = requests.filter(r => r.type === "xhr" || r.type === "fetch");

writeFileSync(OUT, JSON.stringify({ capturedAt: new Date().toISOString(), target: TARGET, finalUrl, counts: { total: requests.length, api: api.length, js: js.length, xhrLike: xhr.length }, api, sso, js, all: requests }, null, 2));
console.log("WROTE " + OUT);
console.log("finalUrl: " + finalUrl);
console.log("--- console API requests (platform.xiaomimimo.com/api/*) ---");
for (const a of api) console.log(`${a.phase} ${a.method || a.status} ${a.url}`);
console.log("--- SSO/auth redirect chain (first 25) ---");
for (const s of sso) console.log(`${s.phase} ${s.status || s.method || ""} ${s.url.slice(0, 140)}`);
console.log("--- js chunks: " + js.length + " (first 15) ---");
for (const j of js.slice(0, 15)) console.log(j);
