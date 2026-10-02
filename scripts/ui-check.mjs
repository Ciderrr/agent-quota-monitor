// Gate C 反馈修复验证：点击链路（折叠行→展开→详情）+ 设置交互 + 倒计时文案存在性
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

function findBrowser() {
  for (const c of [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ]) { try { if (existsSync(c)) return c; } catch {} }
  throw new Error("no browser");
}

const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
const results = [];
const check = (name, ok) => { results.push(`${ok ? "PASS" : "FAIL"}  ${name}`); };

await page.goto("http://localhost:5173/?shot=collapsed", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 400));

// 1. 折叠行点击 → 直接进入该 Provider 详情（新导航：点谁看谁）
await page.click(".row");
await page.waitForSelector(".bucket", { timeout: 3000 }).then(() => check("折叠行点击 → 直接进入该 Provider 详情", true)).catch(() => check("折叠行点击 → 直接进入该 Provider 详情", false));

// 2. 详情 ‹ → 默认主页（精简）
await page.click(".x-back");
await new Promise((r) => setTimeout(r, 200));
const collapsedHome = await page.$(".rows") !== null && await page.$(".provider-block") === null;
check("详情返回 → 精简主页", collapsedHome);

// 2b. 右键精简层 → 展开详细 → 全体概览
await page.click(".rows", { button: "right" });
await new Promise((r) => setTimeout(r, 200));
const expandBtn = await page.evaluateHandle(() =>
  [...document.querySelectorAll(".ctx-item")].find((b) => /展开详细|Show details/.test(b.textContent || ""))
);
const hasExpand = expandBtn.asElement() !== null;
if (hasExpand) await expandBtn.asElement().click();
await new Promise((r) => setTimeout(r, 250));
const overviewShown = await page.$(".provider-block") !== null;
check("右键展开详细 → 全体概览", hasExpand && overviewShown);

// 3. 概览点击块 → 详情
await page.click(".provider-block");
const detailAgain = await page.$(".bucket") !== null;
check("概览点击块 → 详情", detailAgain);

// 3b. 详情头部统计入口 → 历史 → 返回回详情（来源记忆）
const headBtns = await page.$$(".x-head .icon-btn");
await headBtns[headBtns.length - 1].click();
await page.waitForSelector(".hist-range", { timeout: 3000 }).then(() => check("详情 → 统计入口可用", true)).catch(() => check("详情 → 统计入口可用", false));
await page.click(".x-back");
const backToDetail = await page.$(".bucket") !== null;
check("统计返回 → 回到详情（来源记忆）", backToDetail);

// 4. 详情 ‹ → 精简主页（默认视图）；再展开 → ⌃ 收起
await page.click(".x-back");
await new Promise((r) => setTimeout(r, 200));
const homeAgain = await page.$(".rows") !== null;
check("详情返回 → 精简主页（二次）", homeAgain);

await page.click(".rows", { button: "right" });
await new Promise((r) => setTimeout(r, 150));
await page.evaluate(() => {
  const b = [...document.querySelectorAll(".ctx-item")].find((x) => /展开详细|Show details/.test(x.textContent || ""));
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 250));
await page.click(".x-collapse");
await new Promise((r) => setTimeout(r, 300));
const collapsedAgain = await page.$(".rows") !== null;
check("概览收起按钮 → 折叠", collapsedAgain);

// 4. 设置页：开关可交互
await page.goto("http://localhost:5173/?shot=settings", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 300));
const before = await page.$eval(".set-pane .switch", (el) => el.getAttribute("aria-checked"));
await page.click(".set-pane .switch");
await new Promise((r) => setTimeout(r, 150));
const after = await page.$eval(".set-pane .switch", (el) => el.getAttribute("aria-checked"));
check(`设置开关可切换 (${before}→${after})`, before !== after);

// 5. 通知阈值：预设 + 自定义（点击“自定义”后出现输入框）
const tabs = await page.$$(".set-nav button");
await tabs[3].click();
await new Promise((r) => setTimeout(r, 200));
const customBtns = await page.$$(".set-pane .seg button");
let customFound = false;
for (const b of customBtns) {
  const txt = await b.evaluate((el) => el.textContent);
  if (txt && (txt.includes("自定义") || txt.includes("Custom"))) { await b.click(); customFound = true; break; }
}
await new Promise((r) => setTimeout(r, 200));
const canType = await page.$(".thresh input") !== null;
check("通知阈值：预设 + 自定义输入", customFound && canType);

// 5b. Providers 行已无“本机程序”文案（按反馈删除）
const provText = await page.evaluate(() => {
  const btns = [...document.querySelectorAll(".set-nav button")];
  const p = btns.find((b) => /Providers/i.test(b.textContent || ""));
  return p ? (p.textContent || "") : "";
});
await page.evaluate(() => {
  const btns = [...document.querySelectorAll(".set-nav button")];
  const p = btns.find((b) => /Providers/i.test(b.textContent || ""));
  if (p) p.click();
});
await new Promise((r) => setTimeout(r, 200));
const paneText = await page.$eval(".set-pane", (el) => el.textContent || "");
check("Providers 行不再显示“本机程序”", !paneText.includes("本机程序"));

// 6. Connect Codex：完成态文案与倒计时（跳过等待仅验证流程存在）
await page.goto("http://localhost:5173/?shot=connect-codex", { waitUntil: "networkidle0" });
await page.click(".primary-btn");
await new Promise((r) => setTimeout(r, 4200));
const bodyText = await page.$eval("[data-window]", (el) => el.textContent);
check("Codex 连接出现「已完成」+ 自动关闭文案", /已完成|Done/.test(bodyText) && /自动关闭|Auto-closing/.test(bodyText));

// 7. MiMo：官方会话登录状态 + 无假登录按钮 + 流程说明（官方登录已实装，无「验证中」过渡态）
await page.goto("http://localhost:5173/?shot=connect-mimo", { waitUntil: "networkidle0" });
const mimoText = await page.$eval("[data-window]", (el) => el.textContent);
check("MiMo 显示官方会话登录状态", /官方账户会话登录|Sign in with official account/.test(mimoText));
check("MiMo 无假登录按钮（无 Sign in 主按钮）", await page.$("[data-window] .primary-btn") === null);
check("MiMo 展示完成后的流程说明", /已获取|retrieved/.test(mimoText));

// 7b. MiMo 演示读取闭环：登录完成按钮 → 已获取信息 + 倒计时
const demoBtn = await page.evaluateHandle(() => [...document.querySelectorAll("[data-window] .foot-btn")].find((b) => /演示|demo/i.test(b.textContent || "")));
await demoBtn.asElement().click();
await new Promise((r) => setTimeout(r, 2400));
const gotText = await page.$eval("[data-window]", (el) => el.textContent);
check("MiMo 演示读取 → 已获取信息 + 倒计时", /已获取信息|Usage retrieved/.test(gotText) && /自动关闭|Auto-closing/.test(gotText));

// 8. 默认视图设置：切到“详细”后浮窗主界面变为概览
await page.goto("http://localhost:5173/?shot=settings-general", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".mode-card")];
  const c = cards.find((b) => /详细|Detailed/.test(b.textContent || ""));
  if (c) c.click();
});
await new Promise((r) => setTimeout(r, 300));
const overviewBehind = await page.$(".provider-block") !== null;
check("默认视图=详细 → 浮窗主界面为概览", overviewBehind);

// 8b. 默认视图=详细时：详情返回 → 详细主页
await page.click(".provider-block");
await new Promise((r) => setTimeout(r, 200));
const detailFromOverview = await page.$(".bucket") !== null;
await page.click(".x-back");
await new Promise((r) => setTimeout(r, 200));
const backToOverviewHome = await page.$(".provider-block") !== null && detailFromOverview;
check("默认视图=详细 → 详情返回详细主页", backToOverviewHome);

await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".mode-card")];
  const c = cards.find((b) => /精简|Compact/.test(b.textContent || ""));
  if (c) c.click();
});

await browser.close();
console.log(results.join("\n"));
process.exitCode = results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
