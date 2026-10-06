// 一次性工具：清除文档中的日期（用户要求：文档不携带时间戳，避免显旧）。
// 用法: node scripts/strip-dates.mjs  （跑完即停用，不进 CI）
// 裁定：只清「文档自身的时间戳」；外部事实日期（产品发布时间线等）保留。
import { readFileSync, writeFileSync } from "node:fs";

const files = process.argv.slice(2);
let total = 0;

const rules = [
  // 字段行整行删："- 日期：X" / "> 日期：X（Y 更新）" / "- 执行日期：X"
  { re: /^[-\s>]*(执行日期|日期)[：:]\s*\d{4}-\d{2}-\d{2}[^\n]*$/gm, to: "" },
  // 前缀型："交接日期：2026-10-06 · " → 删
  { re: /交接日期：\d{4}-\d{2}-\d{2} · /g, to: "" },
  // docs/README 头部："研究日期 X / 更新 Y（Gate F）。"
  { re: /研究日期 \d{4}-\d{2}-\d{2} \/ 更新 \d{4}-\d{2}-\d{2}（Gate F）。\s*/g, to: "" },
  // "研究日期 2026-10-04 · " → 删
  { re: /研究日期 \d{4}-\d{2}-\d{2} · /g, to: "" },
  // codex/zcode："研究日期：X（Gate A.1 运行时验证：Y，" → "Gate A.1 运行时验证："
  { re: /- 研究日期：\d{4}-\d{2}-\d{2}（Gate A\.1 运行时验证：\d{4}-\d{2}-\d{2}，/g, to: "- Gate A.1 运行时验证：" },
  // "研究日期：2026-09-28（Portable-first 修订轮）" → 删字段留括注
  { re: /- 研究日期：\d{4}-\d{2}-\d{2}(?=（)/g, to: "" },
  // 孤立 "- 研究日期：X" 行
  { re: /^-\s*研究日期：\d{4}-\d{2}-\d{2}\s*$/gm, to: "" },
  // 版本头中点："· 2026-09-28"（· 前可能无空格：")· 2026-09-28"）
  { re: /\s*·\s*\d{4}-\d{2}-\d{2}(?=\s*·|\s*$)/gm, to: "" },
  // "（镜像，访问 2026-09-28）" 变体
  { re: /[，,]\s*访问 \d{4}-\d{2}-\d{2}(?=[）)])/g, to: "" },
  // 括号孤立日期："（2026-09-28）"
  { re: /（\d{4}-\d{2}-\d{2}）/g, to: "" },
  { re: /\(\d{4}-\d{2}-\d{2}\)/g, to: "" },
  // 括号内开头日期："（2026-09-29 第二轮，" → "（第二轮，"
  { re: /（\d{4}-\d{2}-\d{2}\s+/g, to: "（" },
  // 逗号夹日期："（2026-09-29，" → "（"；"（本机实测，2026-09-28）" → "（本机实测）"
  { re: /（\d{4}-\d{2}-\d{2}，/g, to: "（" },
  { re: /，\d{4}-\d{2}-\d{2}）/g, to: "）" },
  { re: /，\d{4}-\d{2}-\d{2}，/g, to: "，" },
  // "（访问 2026-09-28）" / "2026-09-28 访问" / "，2026-09-28 访问"
  { re: /（访问 \d{4}-\d{2}-\d{2}）/g, to: "" },
  { re: /，?\s*\d{4}-\d{2}-\d{2} 访问/g, to: "" },
  // fixture 获取日期
  { re: /fixture \d{4}-\d{2}-\d{2}，/g, to: "fixture 实测，" },
  // Mock 周期日期（演示数据描述）
  { re: /本期至 \*\*\d{4}-\d{2}-\d{2}\*\*/g, to: "本期至未来某日" },
  { re: /· \d{4}-\d{2}-\d{2} 周期/g, to: " 周期" },
  // HANDOFF 旧版指涉
  { re: /本文件取代 \d{4}-\d{2}-\d{2} 版 HANDOFF/g, to: "本文件取代旧版 HANDOFF" },
];

for (const f of files) {
  const src = readFileSync(f, "utf8");
  let out = src;
  let n = 0;
  for (const { re, to } of rules) {
    out = out.replace(re, (m) => { n++; return m.match(/^\n*$/) ? m : to; });
  }
  // 清理可能产生的连续空行
  out = out.replace(/\n{3,}/g, "\n\n");
  if (out !== src) {
    writeFileSync(f, out);
    total += n;
    console.log(`${f}: ${n} replacements`);
  }
}
console.log(`TOTAL: ${total}`);
