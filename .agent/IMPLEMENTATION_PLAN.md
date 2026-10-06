# IMPLEMENTATION_PLAN.md — 实施计划（Gate 制）

> 版本 0.3（Portable-first 修订）
> 铁律：**每个 Gate 停下等人工审查。** 用户主要负责 UI 验收：UI 不满意时，禁止以"功能已写完"为由继续开发。
> 当前状态：Phase 0 完成（Gate A CONDITIONAL PASS → A.1 完成）→ Gate B 修订完成（Portable-first，自审通过）→ **Phase 1 UI Prototype 完成，停止在 Gate C 等待 UI 验收。**

---

## Phase 0 — Discovery & Architecture ✅（Gate A CONDITIONAL PASS + A.1 完成）

产出：全套规格文档 + 5 份 Discovery + 运行时 fixtures（codex app-server 实测打通；zcode 凭证证伪 → 用户粘贴 key 路线；MiMo 数据源定位）。

## Gate B 修订 ✅（本轮）

Portable-first 原则落地：PORTABLE_FIRST.md、双层架构（Remote Account Layer / Local Enhancement Layer）、Clean-PC 验收测试、connectionMethods/localEnhancements 能力模型、ManagedProviderRuntime（ADR-004）、MiMo Console 会话路线（ADR-005）、MiMo Desktop 移出 v1、Gate B 自审通过（PORTABLE_FIRST §7）。

## Phase 1 — UI Prototype ✅（本轮完成，**停止在 Gate C**）

- Mock Provider Engine（TS，与未来 Rust core 同形快照）+ PlatformBridge 抽象（Phase 2 换 TauriBridge，UI 零改动）。
- 全部界面：Collapsed / Expanded overview / Provider detail / Connect×4 / Settings 六节 / History / 错误·stale·未配置·空态 / Light+Dark / zh+en。
- 27 张截图（含 125%/150% DPI 模拟）→ docs/ui/screenshots/。
- 运行：`npm install && npm run dev` → http://localhost:5173。

**Gate C = UI 验收（用户负责）。通过前不进入 Phase 2。**

## Phase 2 — Tauri 壳 + DeepSeek 垂直切片（Gate D）

1. 前置：安装 Rust 工具链 + MSVC Build Tools（**本机尚无 cargo/rustc**）。
2. Tauri 2 脚手架：透明无边框浮窗、Mica（window-vibrancy + 降级链）、托盘、单实例、自启、位置记忆；PlatformBridge 换为 TauriBridge（IPC 同形）。
3. core：凭据管理器（keyring）、共享 HTTP（域名白名单 + redaction）、调度器（REFRESH_STRATEGY 全规则）、SQLite（DATA_MODEL §3）。
4. DeepSeek 端到端：API Key 输入（强制安全提示）→ 余额 → Balance history → 错误态 → 通知（金额阈值）。
5. Mock 与真实 DeepSeek 共存。

**Gate D 验收**：真实凭证全链路；错误态实测；性能基线；安全自查。

## Phase 3 — 其余 Provider（Gate E）

1. **Codex**：Managed Runtime（ADR-004：npm 官方源按需下载 + sha512 + 版本固定）→ `account/login/start{type:"chatgpt"}` Clean-PC 登录 → app-server 快照（含动态附加桶/Reset ×N）；本机已有 Codex = Optional Enhancement。
2. **ZCode/GLM**：用户粘贴 Coding Plan Key → `quota/limit`（裸 key）→ limits[] 运行时验证（确认前 Custom(raw)+通用标签）。
3. **MiMo Token Plan**：用户运行 harness（`scripts/mimo-console-harness.mjs`）出登录态 fixture → ADR-005 解锁 → 专用 WebView2 会话 + `/api/v1/tokenPlan/usage|detail` → Connect MiMo 切换为官方登录流程。
4. 活动检测接入（Optional Enhancement，仅优化刷新）。

**Gate E 验收**：四家真实数据；Clean-PC Test 全过；错误态演练；通知去重实测。

## Phase 4 — 性能/安全/发布审计（Gate F）

性能实测（docs/performance.md：idle CPU/内存/启动/刷新尖峰/24h 驻留）、安全审计（SECURITY §7 逐项 + CI grep 断言 + cargo/npm audit）、可访问性复核（DPI/键盘/对比度/Reduce Motion）、打包签名与 GitHub 发布。

---

## Gate 对照表

| Gate | 内容 | 状态 |
|---|---|---|
| A / A.1 | Provider Discovery + 运行时验证 | ✅ CONDITIONAL PASS → 修正完成 |
| B | 架构/数据模型/Portable-first | ✅ 自审通过（本轮） |
| **C** | **UI Prototype（Mock）** | **⛔ 停止，等待用户 UI 验收** |
| D | Tauri 壳 + DeepSeek 切片 | 待 Gate C 通过 |
| E | Codex/ZCode/MiMo 全量 | — |
| F | 性能/安全/发布 | — |

## 全程红线

PORTABLE_FIRST §1/§4、SECURITY 全部约束、master prompt §33：Reset 仅监控、不发无意义推理请求、不上传凭证、不读 prompt/代码/会话内容、Clean-PC 可用性不依赖本机 Agent。
