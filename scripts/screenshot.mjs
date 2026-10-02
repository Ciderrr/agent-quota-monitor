// Gate C 截图矩阵：puppeteer-core + Edge，dev server 上按 shot 参数逐张捕获。
// 用法: node scripts/screenshot.mjs [baseURL=http://127.0.0.1:5173]
import puppeteer from "puppeteer-core";
import { mkdirSync, existsSync } from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:5173";
const OUT = "docs/ui/screenshots";
mkdirSync(OUT, { recursive: true });

function findBrowser() {
  for (const c of [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ]) { try { if (existsSync(c)) return c; } catch {} }
  throw new Error("no Edge/Chrome found");
}

// [文件名, shot参数, theme, lang, deviceScaleFactor]
// DPI 模拟：Windows 缩放 = 同一 CSS 布局按倍率渲染 → 100%→dsf1.0, 125%→1.25, 150%→1.5
const SHOTS = [
  ["collapsed-dark-zh", "collapsed", "dark", "zh", 1],
  ["collapsed-light-zh", "collapsed", "light", "zh", 1],
  ["collapsed-dark-en", "collapsed", "dark", "en", 1],
  ["expanded-dark-zh", "expanded", "dark", "zh", 1],
  ["expanded-light-zh", "expanded", "light", "zh", 1],
  ["expanded-dark-en", "expanded", "dark", "en", 1],
  ["detail-codex-dark-zh", "detail-codex", "dark", "zh", 1],
  ["detail-codex-light-zh", "detail-codex", "light", "zh", 1],
  ["detail-mimo-dark-zh", "detail-mimo", "dark", "zh", 1],
  ["detail-deepseek-light-zh", "detail-deepseek", "light", "zh", 1],
  ["connect-codex-dark-zh", "connect-codex", "dark", "zh", 1],
  ["connect-codex-light-en", "connect-codex", "light", "en", 1],
  ["connect-zcode-dark-zh", "connect-zcode", "dark", "zh", 1],
  ["connect-deepseek-light-zh", "connect-deepseek", "light", "zh", 1],
  ["connect-mimo-dark-zh", "connect-mimo", "dark", "zh", 1],
  ["settings-dark-zh", "settings", "dark", "zh", 1],
  ["settings-light-zh", "settings", "light", "zh", 1],
  ["settings-general-dark-zh", "settings-general", "dark", "zh", 1],
  ["settings-general-light-en", "settings-general", "light", "en", 1],
  ["history-dark-zh", "history", "dark", "zh", 1],
  ["history-light-en", "history", "light", "en", 1],
  ["issues-dark-zh", "collapsed&scenario=issues", "dark", "zh", 1],
  ["issues-expanded-dark-zh", "expanded&scenario=issues", "dark", "zh", 1],
  ["empty-light-zh", "collapsed&scenario=empty", "light", "zh", 1],
  ["low-dark-zh", "expanded&scenario=low", "dark", "zh", 1],
  ["dpi125-collapsed-dark-zh", "collapsed", "dark", "zh", 1.25],
  ["dpi150-collapsed-dark-zh", "collapsed", "dark", "zh", 1.5],
  ["dpi125-expanded-dark-zh", "expanded", "dark", "zh", 1.25],
  ["dpi150-expanded-dark-zh", "expanded", "dark", "zh", 1.5],
];

const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: "new" });
const page = await browser.newPage();

for (const [name, shot, theme, lang, dsf] of SHOTS) {
  // 逻辑视口 1280×800；dsf 相对 2.0 基准映射：100%→2.0, 125%→2.5, 150%→3.0
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: dsf });
  await page.goto(`${BASE}/?shot=${shot}&theme=${theme}&lang=${lang}`, { waitUntil: "networkidle0", timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 350));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("shot: " + name);
}

await browser.close();
console.log("DONE → " + OUT);
