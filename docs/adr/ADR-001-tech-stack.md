# ADR-001 — 技术栈选型：Tauri 2 + Rust + React + TypeScript

- 状态：Proposed（Gate B 评审）
- 日期：2026-09-28

## 背景

Windows 11 常驻浮窗监控工具，硬性要求：长期后台运行、idle CPU 趋近 0、低内存、系统托盘、透明/Mica 窗口、置顶、窗口定位记忆、原生凭据存储、SQLite、进程检测、高质 UI、开源可审计。

## 候选对比

| 维度 | **Tauri 2 + Rust + React（选定）** | Electron | C# WinUI 3 / WPF | Flutter |
|---|---|---|---|---|
| idle 内存 | Webview2 + Rust core ≈ 60–120 MB | 常态 150–300 MB | 50–90 MB | 80–150 MB |
| idle CPU | 事件驱动即可 ≈0%（WebView2 空闲渲染器挂起） | 可达成但 Node 侧定时器/Chromium 合成器负担重 | ≈0% | ≈0% 但 Skia 常驻 |
| Windows 集成 | 托盘/通知/自启/单实例官方插件齐备；Mica 经 window-vibrancy；凭据管理器 keyring 成熟 | 均需第三方或手写 | 最佳（原生） | 较弱（窗口材质/托盘靠插件） |
| UI 开发效率 | Web 技术，设计还原度最高 | 同左 | XAML 生态，设计实现慢 | Dart 生态，设计还原中等 |
| 安全 | Rust 后端 + IPC 白名单 + CSP；凭证不经过 Node | 主进程 Node 攻击面大；凭证经手面广 | 好 | 好 |
| 后台长驻稳定性 | 单 WebView2，崩溃面小 | 多进程 Chromium | 好 | 好 |
| 开源审计友好 | 结构清晰、依赖少 | 依赖面大 | Windows-only 闭源工具链摩擦 | 中 |
| 主要风险 | WebView2 依赖（Win11 预装✓）、Mica/圆角细节坑、团队 Rust 学习成本 | 明确违反性能预算倾向 | UI 开发成本高、跨平台愿景受限 | Windows 桌面体验非主线 |

## 决策

**Tauri 2 + Rust（core）+ React + TypeScript（UI）**。决定性理由：唯一同时满足"Electron 级 UI 效率"与"原生级资源纪律"的方案；凭据/调度/Provider 层在 Rust 侧天然隔离于 UI，安全边界清晰（SECURITY §7 审计路径）。Electron 仅以"开发简单"为理由不可接受（master prompt 红线），且内存代价与本项目"长期常驻无感"目标冲突。WinUI 3 在 UI 迭代速度上无法支撑 Gate C 的视觉标准要求。

## 风险与缓解

1. WebView2 运行时：Win11 系统预装；打包可带 fixed-version 兜底。
2. Mica/透明窗口圆角/置顶细节：Phase 1 第一周 spike（ARCHITECTURE §4 技术清单），失败降级链 Mica→Acrylic→纯色半透明已定义。
3. 团队 Rust 成本：core 面积刻意小（调度/存储/适配器骨架）， Provider 适配器是主要增量。
4. 窗口抖动/重绘 bug（透明窗口已知问题类）：性能预算里列了 24h 驻留验证项。

## 后果

- 需安装 Rust 工具链（本机当前未装，见 IMPLEMENTATION_PLAN 前置项）。
- IPC 类型用 ts-rs/specta 生成，防 Rust/TS 模型漂移。
- 若 Phase 1 spike 发现重大障碍（Mica 不可用且降级不可接受、托盘行为异常），回到本 ADR 重新评估，并按 master prompt 补记内存/CPU/集成/安全代价对比。
