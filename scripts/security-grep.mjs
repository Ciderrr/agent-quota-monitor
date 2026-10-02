#!/usr/bin/env node
// security-grep — SECURITY.md §7 的机械断言（Gate F 起 CI 必跑）。
// 用法：node scripts/security-grep.mjs；任何 FAIL 以退出码 1 结束。
// 说明：Provider 官方 usage URL 只允许出现在「元数据注册表 / Mock 原型」两个数据层
// （src/types/provider.ts、src/mock/）；React 组件与 bridge 层零域名（PROVIDER_INTERFACE §4）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const results = [];
const report = (name, pass, detail = "") => results.push({ name, pass, detail });

// ---------- 收集文件 ----------
const SKIP_DIRS = new Set(["node_modules", "target", ".git", "dist", ".mimosa", "gen"]);
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p, acc);
    } else acc.push(p);
  }
  return acc;
}
const all = walk(ROOT);
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

// ---------- A. UI 组件层零 Provider 域名 ----------
const UI_DOMAIN_ALLOW = [join("src", "types", "provider.ts"), join("src", "mock") + sep];
const UI_DOMAIN_RE = /deepseek\.com|chatgpt\.com|openai\.com|z\.ai|bigmodel\.cn|xiaomimimo\.com/i;
const uiHits = [];
for (const p of all) {
  const rel = p.slice(ROOT.length);
  if (!/^src[\\/].+\.(tsx?|css)$/.test(rel)) continue;
  if (UI_DOMAIN_ALLOW.some((a) => rel.includes(a))) continue;
  if (UI_DOMAIN_RE.test(read(p))) uiHits.push(rel);
}
report(
  "A. UI 组件层零 Provider 域名（白名单：types/provider.ts 元数据、src/mock 原型）",
  uiHits.length === 0,
  uiHits.join(", "),
);

// ---------- B. 仓库零明文凭证模式 ----------
const SECRET_RES = [
  [/sk-[A-Za-z0-9]{20,}/, "sk- 密钥字面量"],
  [/Bearer [A-Za-z0-9._-]{20,}/, "Bearer token 字面量"],
  [/(api[_-]?key|token|secret|password)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{24,}["']/i, "疑似凭证赋值"],
];
const secretHits = [];
for (const p of all) {
  const rel = p.slice(ROOT.length);
  if (rel.startsWith("scripts" + sep + "security-grep.mjs")) continue; // 本脚本模式表自身
  const text = read(p);
  for (const [re, label] of SECRET_RES) {
    if (re.test(text)) secretHits.push(`${rel} (${label})`);
  }
}
report("B. 仓库零明文凭证（sk- / Bearer / 键值赋值模式）", secretHits.length === 0, secretHits.join(", "));

// ---------- C. React 前端不持久化任何数据到 Web 存储 ----------
const webStoreHits = [];
for (const p of all) {
  const rel = p.slice(ROOT.length);
  if (!/^src[\\/].+\.tsx?$/.test(rel)) continue;
  if (/localStorage\.setItem|sessionStorage\.setItem|indexedDB/i.test(read(p))) webStoreHits.push(rel);
}
report("C. 前端零 localStorage/sessionStorage/indexedDB 持久化", webStoreHits.length === 0, webStoreHits.join(", "));

// ---------- D. 禁止 dangerouslySetInnerHTML（XSS 威胁模型） ----------
const htmlHits = [];
for (const p of all) {
  const rel = p.slice(ROOT.length);
  if (!/^src[\\/].+\.tsx?$/.test(rel)) continue;
  if (/dangerouslySetInnerHTML/i.test(read(p))) htmlHits.push(rel);
}
report("D. 前端零 dangerouslySetInnerHTML", htmlHits.length === 0, htmlHits.join(", "));

// ---------- E. 禁止动态创建 UI WebView（只用 tauri.conf 预声明窗） ----------
const dynWinHits = [];
for (const p of all) {
  const rel = p.slice(ROOT.length);
  if (!/^src-tauri[\\/]src[\\/].+\.rs$/.test(rel)) continue;
  if (/WebviewWindowBuilder|WebviewBuilder/.test(read(p))) dynWinHits.push(rel);
}
report("E. Rust 侧零 WebviewWindowBuilder（预声明窗红线）", dynWinHits.length === 0, dynWinHits.join(", "));

// ---------- F. 绝不调用用户 Codex 的 account/logout（注释提及也单独列出复核） ----------
const logoutHits = [];
for (const p of all) {
  const rel = p.slice(ROOT.length);
  if (!/^src-tauri[\\/]src[\\/].+\.rs$/.test(rel)) continue;
  for (const line of read(p).split(/\r?\n/)) {
    const code = line.replace(/\/\/.*$/, ""); // 去掉行注释后再判
    if (/account\s*\/\s*logout|"logout"/.test(code)) logoutHits.push(`${rel}: ${line.trim()}`);
  }
}
report("F. Rust 代码零 account/logout 调用（monitor-only 断开）", logoutHits.length === 0, logoutHits.join(" | "));

// ---------- 汇总 ----------
let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : "  ← " + r.detail}`);
  if (!r.pass) failed++;
}
console.log(failed === 0 ? "\nsecurity-grep: 全部通过" : `\nsecurity-grep: ${failed} 项未通过`);
process.exit(failed === 0 ? 0 : 1);
