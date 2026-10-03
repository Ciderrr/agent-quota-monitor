// 主视觉图生成：真实前端渲染（隐藏模拟壁纸、透明背景抠图）→ 合成到深色渐变画布。
// 用法: node scripts/hero-shot.mjs [baseURL] [outPath]
// 产物仅供 README 主视觉，不经用户审核不替换。
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:5173";
const OUT = process.argv[3] || "docs/ui/hero.png";
const TMP = "tmp-hero";
mkdirSync(TMP, { recursive: true });

function findBrowser() {
  for (const c of [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ]) { try { if (existsSync(c)) return c; } catch {} }
  throw new Error("no Edge/Chrome found");
}

const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: "new",
  defaultViewport: { width: 900, height: 1100, deviceScaleFactor: 2 },
});

// 清洁注入：隐藏模拟壁纸 + 原型控制条，页面透明
const cleanCSS = `
  .wallpaper { display: none !important; }
  .proto-bar { display: none !important; }
  html, body { background: transparent !important; }
`;

async function captureWidget(shot, outFile) {
  const page = await browser.newPage();
  await page.goto(`${BASE}/?shot=${shot}`, { waitUntil: "networkidle0" });
  await page.addStyleTag({ content: cleanCSS });
  await new Promise((r) => setTimeout(r, 600)); // 玻璃材质/过渡动画落定
  const el = await page.$("[data-widget]");
  if (!el) throw new Error(`[data-widget] not found on ${shot}`);
  await el.screenshot({ path: outFile, omitBackground: true });
  await page.close();
  console.log(`captured ${outFile}`);
}

await captureWidget("collapsed", join(TMP, "collapsed.png"));
await captureWidget("expanded", join(TMP, "expanded.png"));

// 合成：深色专业渐变画布（无任何壁纸模拟），双视图 + 柔和投影
const expandedB64 = (await import("node:fs")).readFileSync(join(TMP, "expanded.png")).toString("base64");
const collapsedB64 = (await import("node:fs")).readFileSync(join(TMP, "collapsed.png")).toString("base64");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; }
  body {
    width: 1440px; height: 760px; overflow: hidden;
    background:
      radial-gradient(1000px 560px at 72% 0%, rgba(64, 140, 255, 0.13), transparent 62%),
      radial-gradient(860px 520px at 14% 96%, rgba(52, 199, 123, 0.09), transparent 62%),
      linear-gradient(158deg, #11161f, #0a0d13 72%);
  }
  img { border-radius: 16px; }
  .expanded {
    position: absolute; left: 148px; top: 68px; height: 624px;
    box-shadow: 0 34px 90px rgba(0, 0, 0, 0.55), 0 6px 22px rgba(0, 0, 0, 0.4);
  }
  .collapsed {
    position: absolute; left: 648px; top: 208px; height: 336px;
    box-shadow: 0 26px 64px rgba(0, 0, 0, 0.5), 0 5px 18px rgba(0, 0, 0, 0.38);
  }
</style></head><body>
  <img class="expanded" src="data:image/png;base64,${expandedB64}" />
  <img class="collapsed" src="data:image/png;base64,${collapsedB64}" />
</body></html>`;
writeFileSync(join(TMP, "compose.html"), html);

const page2 = await browser.newPage();
await page2.setViewport({ width: 1440, height: 760, deviceScaleFactor: 2 });
await page2.goto("file:///" + join(process.cwd(), TMP, "compose.html").replace(/\\/g, "/"), { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 300));
await page2.screenshot({ path: OUT });
await page2.close();
await browser.close();
console.log(`WROTE ${OUT}`);
