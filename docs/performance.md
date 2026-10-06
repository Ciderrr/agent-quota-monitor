# docs/performance.md — 性能实测

> 原则：不凭感觉说"轻量"，一切以任务管理器/实测数据为准。Gate F 出完整报告；本表随阶段滚动更新。

## 测量环境

- Windows 11，1280×800 逻辑分辨率
- Gate F 数字来自 **release 构建**（0.1.0，`npm run tauri build`），测量脚本 `scripts/perf-probe.mjs`（PowerShell Get-Process 采样）
- 内存口径说明：**工作集(WS)** 含共享页；**私有(Private)** 排除共享 DLL 重复计数，更接近任务管理器"内存(专用工作集)"

## Phase 2（Gate D）基线 —— dev 构建

| 指标 | 实测值 | 备注 |
|---|---|---|
| 进程内存（Rust core，空闲） | ≈ 35 MB（agent-quota-monitor.exe） | dev 构建含调试符号 |
| 后台常驻进程 | 1 个（tauri 单进程模型）+ WebView2 子进程树 | 无 Node/无 Electron 多进程 |
| 首次 Rust 构建（cargo build，依赖已缓存 check） | 57.7 s | 全量冷构建（含依赖编译）另计 ≈ 6 min |
| UI 数据流 | Rust 调度器事件推送 → WebView 渲染 | 前端零轮询；仅两个低频 tick（"Xm 前"文案、详情倒计时） |
| 动画 | 全部 CSS transform/opacity，160–240 ms | prefers-reduced-motion 下降级 |

## Gate F（Phase 4）—— release 构建实测

| 指标 | 实测值 | 目标 | 结论 |
|---|---|---|---|
| 冷启动（进程创建 → 主窗口句柄） | **265 ms** | ≤ 1500 ms | ✅ |
| 主进程内存（启动 20s 后） | WS 37.8 MB / 私有 11.9–12.1 MB | — | 与 dev 基线相当（release 无调试符号） |
| 主进程内存（80s 后） | WS 37.8 MB / 私有 11.9 MB | 无持续增长 | ✅ 60s 内零漂移 |
| 启动期 CPU（前 20s，含首轮抓取） | 0.55%（单核口径） | — | ✅ |
| 空闲 CPU（60s 窗口） | **0.00%**（单核口径） | ≈ 0–0.1% | ✅ |
| WebView2 子进程树（渲染浮窗 UI） | 9 个进程；私有内存合计 ≈ 542 MB（浏览器主进程 236 + GPU 137 + 其余网络/存储/渲染） | — | Chromium 多进程架构固有开销；GPU/浏览器进程占大头，退出即全部回收（实测 after_kill=0，无孤儿） |
| NSIS 安装包 | 4.69 MiB；SHA256 `6ed0a7bb00dd75253364af53748a9b939391ab6316dc55b8dd50f9dbca64c68a`（Gate F 反馈修复后重打包） | — | 未签名（SmartScreen 会提示，见 .agent/CHANGELOG_GATE_F.md） |
| 完整 release 构建（含前端 + Rust + NSIS） | ≈ 3 min 20 s（依赖已缓存） | — | — |

### 测量方法与诚实边界

- 冷启动：`spawn` 后轮询 `MainWindowHandle != 0`，50ms 粒度（±50ms 误差）。
- CPU：进程 CPU 总秒数差 ÷ 窗口时长（PowerShell `Get-Process().CPU`，单核百分比口径）。
- WebView2 树：按命令行匹配本应用 user-data-dir 归属；启动前后均验证过**无孤儿进程混入**。
- **未测**（后续补）：
  - [ ] 24 小时驻留内存曲线（方法：`perf-probe.mjs` 拉长采样间隔挂机；本轮会话内无法完成）
  - [ ] 展开态/详情态内存（需 UI 交互配合，待人工验收时顺手记录）
  - [ ] 手动刷新瞬时 CPU 尖峰（< 3% 目标；需在真实刷新窗口内高频采样）
  - [ ] Mica vs Acrylic vs 纯色三档 GPU 占用对比（需要 GPU 计数器工具）
