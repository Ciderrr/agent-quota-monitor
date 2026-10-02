// WorkBuddy 积分页 网络捕获 harness（ADR-006 验证轮专用，不属于产品）
// 用户在有头浏览器中手动登录 → 自动捕获 www.workbuddy.cn 的 XHR/fetch：
// 记录 方法/路径/状态码 + JSON 响应的「字段名+类型」结构（数值保留、字符串脱敏）。
// 不记录任何 Cookie / 请求头值 / token；仅研究用途。
// 用法: node scripts/workbuddy-capture.mjs [输出json] [捕获毫秒]
import puppeteer from "puppeteer-core";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";

const OUT = process.argv[2] || ".tmp-workbuddy/capture-plans-usage.json";
const WAIT = Number(process.argv[3] || 75000);
const TARGET = "https://www.workbuddy.cn/profile/plans-usage";
const PROFILE = ".tmp-workbuddy/profile";

function findBrowser() {
  const cands = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const c of cands) { if (existsSync(c)) return c; }
  throw new Error("未找到 Edge/Chrome");
}

function redactUrl(u) {
  try {
    const url = new URL(u);
    const keys = [...url.searchParams.keys()];
    return url.origin + url.pathname + (keys.length ? "?" + keys.map(k => `[Q:${k}]`).join("&") : "") + (url.hash ? "#[ROUTE]" : "");
  } catch { return u; }
}

// 响应体 → 结构骨架：数值/布尔保留，字符串脱敏（白名单键保留原值便于读结构）
const STR_KEEP = ["planCode", "plan", "planName", "name", "productName", "currency", "unit", "type", "status", "code", "id"];
function shape(v, depth = 0) {
  if (v == null) return v;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") {
    try {
      const j = JSON.parse(v);
      if (typeof j === "object" && j !== null) return shape(j, depth); // 字符串化 JSON 展开一层
    } catch { /* 普通字符串 */ }
    return STR_KEEP.includes("") ? v : `<str:${v.length}>`;
  }
  if (Array.isArray(v)) return v.slice(0, 3).map((x) => shape(x, depth + 1));
  if (typeof v === "object") {
    if (depth > 6) return "<deep>";
    const o = {};
    for (const [k, val] of Object.entries(v)) {
      o[k] = (typeof val === "string" && STR_KEEP.includes(k)) ? val : shape(val, depth + 1);
    }
    return o;
  }
  return `<${typeof v}>`;
}

mkdirSync(".tmp-workbuddy", { recursive: true });
const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: false,
  userDataDir: PROFILE,
  args: ["--no-first-run", "--disable-extensions", "--window-size=1440,960", "--lang=zh-CN"],
});
const page = (await browser.pages())[0] || await browser.newPage();
await page.setViewport({ width: 1440, height: 920 });

const seen = new Map(); // key: method+path → {method, url, status, shapes:[], hits}
const timeline = [];

page.on("response", async (res) => {
  const req = res.request();
  const type = req.resourceType();
  if (type !== "xhr" && type !== "fetch") return;
  let url;
  try { url = new URL(res.url()); } catch { return; }
  if (url.host !== "www.workbuddy.cn") return; // 只看同源官方接口
  const key = `${req.method()} ${url.pathname}`;
  const entry = seen.get(key) || { method: req.method(), url: redactUrl(res.url()), status: res.status(), hits: 0, shapes: [] };
  entry.hits++;
  entry.status = res.status();
  try {
    const ct = (res.headers()["content-type"] || "");
    if (ct.includes("json") && entry.shapes.length < 3) {
      const body = await res.text().catch(() => "");
      if (body) entry.shapes.push(shape(body));
    }
  } catch { /* body 不可读则跳过 */ }
  seen.set(key, entry);
  timeline.push(`${new Date().toISOString().slice(11, 19)} ${req.method()} ${res.status()} ${url.pathname}`);
});

console.log("打开: " + TARGET);
console.log("→ 请在弹出的浏览器里完成登录；进入「积分/用量」页后，把 订阅计划/购买积分/平台奖励 几个标签都点一遍。");
console.log(`→ 脚本将捕获 ${Math.round(WAIT / 1000)} 秒后自动保存并退出；也可随时 Ctrl+C（本次不保存）。`);
try { await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 45000 }); } catch (e) { console.log("goto note: " + e.message); }

await new Promise((r) => setTimeout(r, WAIT));

const records = [...seen.entries()].map(([k, v]) => ({ api: k, ...v }));
const finalUrl = redactUrl(page.url());
await browser.close();

writeFileSync(OUT, JSON.stringify({
  capturedAt: new Date().toISOString(),
  target: TARGET,
  finalUrl,
  note: "结构骨架：数值/布尔保留，字符串除白名单键外脱敏；不含 Cookie/请求头。",
  endpoints: records,
  timeline,
}, null, 2));
console.log("WROTE " + OUT);
console.log("--- 捕获到的同源接口 ---");
for (const r of records) console.log(`${r.method} ${r.status} hits=${r.hits} ${r.url}`);
