#!/usr/bin/env node
// perf-probe — docs/performance.md 待测项的自动化测量（release 构建）。
// 测量项：冷启动到主窗口可见、空闲内存、空闲 CPU（60s 窗口）、启动期 CPU（前 20s）。
// 限制：刷新瞬时尖峰/24h 驻留/展开态内存/GPU 对比仍需人工或长时运行（见 performance.md）。
import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const EXE = join(process.cwd(), "src-tauri", "target", "release", "agent-quota-monitor.exe");
const PS = (c) => execSync(`powershell -NoProfile -Command "${c}"`, { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(EXE)) {
  console.error(`未找到 ${EXE}；请先 npm run tauri build`);
  process.exit(1);
}

// 单实例插件会把第二次启动变成「唤起已有窗」——先确认没有残留实例
if (PS("if (Get-Process -Name agent-quota-monitor -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }") === "yes") {
  console.error("检测到 agent-quota-monitor.exe 已在运行（单实例会拦截测量启动）；请先退出它。");
  process.exit(1);
}

const stat = () => {
  const raw = PS("(Get-Process -Name agent-quota-monitor -ErrorAction Stop | Select-Object -First 1 | ForEach-Object { '{0}|{1}|{2}|{3}' -f $_.MainWindowHandle, $_.WorkingSet64, $_.PrivateMemorySize64, $_.CPU })");
  const [hwnd, ws, priv, cpu] = raw.split("|");
  return { hwnd: Number(hwnd), ws: Number(ws) / 1048576, priv: Number(priv) / 1048576, cpu: Number(cpu) };
};

const t0 = Date.now();
const child = spawn(EXE, [], { detached: true, stdio: "ignore" });
child.unref();

// 冷启动：进程创建 → 主窗口句柄出现
let coldStart = -1;
while (Date.now() - t0 < 15000) {
  try { if (stat().hwnd !== 0) { coldStart = Date.now() - t0; break; } } catch { /* 进程未就绪 */ }
  await sleep(50);
}
if (coldStart < 0) console.error("15s 内未见主窗口句柄（冷启动测量失败）");

// 启动期（含首次刷新）CPU：前 20s
const s1 = stat();
await sleep(20000);
const s2 = stat();

// 空闲 CPU：60s 窗口 + 内存两时点对比
const m1 = stat();
await sleep(60000);
const m2 = stat();

const bootCpu = ((s2.cpu - s1.cpu) / 20) * 100;
const idleCpu = ((m2.cpu - m1.cpu) / 60) * 100;

console.log("---- perf-probe (release) ----");
console.log(`冷启动(进程→主窗口句柄): ${coldStart} ms   [目标 ≤ 1500 ms]`);
console.log(`内存(工作集) 启动后20s: ${s2.ws.toFixed(1)} MB / 私有 ${s2.priv.toFixed(1)} MB`);
console.log(`内存(工作集) 80s 后:   ${m2.ws.toFixed(1)} MB / 私有 ${m2.priv.toFixed(1)} MB  [观察漂移]`);
console.log(`启动期 CPU(前20s, 含首刷): ${bootCpu.toFixed(2)} % (单核口径)`);
console.log(`空闲 CPU(60s 窗口):      ${idleCpu.toFixed(2)} % (单核口径)   [目标 ≈ 0–0.1%]`);

// 清理：结束测量实例
execSync("taskkill /F /IM agent-quota-monitor.exe", { stdio: "ignore" });
console.log("---- 测量完成，已结束测量进程 ----");
