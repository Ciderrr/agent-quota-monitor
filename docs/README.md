# Agent Quota Monitor — 文档索引

研究日期 2026-09-28 / 更新 2026-09-29（Gate F）。当前状态：**Gate A–E 已通过；Phase 4 / Gate F 完成，等待用户终验**（DeepSeek / Codex / MiMo 可用；ZCode 适配器就绪待真实 Key）。交接（MiMo Desktop → ZCode / GLM-5.3-Flash）：见 [HANDOFF.md](../.agent/HANDOFF.md)、[CHANGELOG_GATE_E.md](../.agent/CHANGELOG_GATE_E.md) 与 [PROMPT_FOR_ZCODE_GLM.md](../.agent/handoff/PROMPT_FOR_ZCODE_GLM.md)。Gate F 产出：[CHANGELOG_GATE_F.md](../.agent/CHANGELOG_GATE_F.md)。

## 核心原则

- [PORTABLE_FIRST.md](PORTABLE_FIRST.md) — **最高级产品原则**：Account-level Monitor、双层架构、Clean-PC 验收、Gate B 自审

## 根目录规格

| 文档 | 内容 |
|---|---|
| [PRODUCT_SPEC.md](PRODUCT_SPEC.md) | 产品定位、范围、v1 Provider 矩阵、成功标准 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Tauri 2 双层架构、模块、数据流、Managed Runtime、性能设计 |
| [DATA_MODEL.md](DATA_MODEL.md) | 统一快照模型（动态桶/开放枚举）、连接 vs 安装状态、SQLite |
| [PROVIDER_INTERFACE.md](PROVIDER_INTERFACE.md) | 适配器 trait、connectionMethods/localEnhancements、ManagedProviderRuntime、IPC 面 |
| [SECURITY.md](../SECURITY.md) | 凭证存储、redaction、WebView2 会话隔离、威胁模型 |
| [REFRESH_STRATEGY.md](REFRESH_STRATEGY.md) | 智能刷新（不依赖本地 Agent）、退避、活动联动 |
| [UI_SPEC.md](UI_SPEC.md) | 视觉 token、两态布局、Connect 页面、Mock 场景、i18n、验收清单 |
| [IMPLEMENTATION_PLAN.md](../.agent/IMPLEMENTATION_PLAN.md) | Phase 1–4 与 Gate C–F |
| [CHANGELOG_GATE_A1.md](../.agent/CHANGELOG_GATE_A1.md) | Gate A.1 修正与运行时验证 |
| [CHANGELOG_GATE_B.md](../.agent/CHANGELOG_GATE_B.md) | Portable-first 修订 + MiMo Round 2 + Phase 1 交付 |
| [CHANGELOG_GATE_D.md](../.agent/CHANGELOG_GATE_D.md) | Tauri 壳 + DeepSeek 垂直切片 |
| [CHANGELOG_GATE_E.md](../.agent/CHANGELOG_GATE_E.md) | Codex Runtime / MiMo 会话 / UI 与安全实测 |
| [CHANGELOG_GATE_F.md](../.agent/CHANGELOG_GATE_F.md) | 性能实测 / 安全审计与 CI 断言 / NSIS 打包 / 活动检测 |

## Gate F 工具与报告

- `npm run audit:sec` — 安全静态断言（scripts/security-grep.mjs，6 项红线 grep）
- `node scripts/perf-probe.mjs` — release 冷启动/内存/CPU 实测
- [performance.md](performance.md) — Gate F 实测数据（含 WebView2 内存口径说明与未测项）

## ADR

- [ADR-001 技术栈](adr/ADR-001-tech-stack.md) — Tauri 2 + Rust + React + TS
- [ADR-002 凭证存储](adr/ADR-002-credential-storage.md) — Windows Credential Manager
- [ADR-003 本地数据库](adr/ADR-003-local-database.md) — SQLite（rusqlite）
- [ADR-004 Managed Codex Runtime](adr/ADR-004-MANAGED-CODEX-RUNTIME.md) — 官方源按需下载 + Apache-2.0
- [ADR-005 MiMo Console Session](adr/ADR-005-MIMO-CONSOLE-SESSION.md) — 专用 WebView2 会话（fixture 待采集）
- [ADR-006 会话路线扩展](adr/ADR-006-SESSION-ROUTE-EXPANSION.md) — Claude / WorkBuddy / OpenCode Go（Proposed，待 fixture）

## Provider Discovery

- [codex.md](provider-discovery/codex.md) — app-server 主通道（已实测）
- [zcode.md](provider-discovery/zcode.md) — 官方接口（凭证需用户粘贴）
- [mimo-token-plan.md](provider-discovery/mimo-token-plan.md) + [mimo-token-plan-round2.md](provider-discovery/mimo-token-plan-round2.md) — 数据源已定位（usage/detail），登录态 fixture 待 harness
- [mimo-desktop.md](provider-discovery/mimo-desktop.md) — **ARCHIVED：OUT OF V1 SCOPE**
- [deepseek.md](provider-discovery/deepseek.md) — 官方余额 API（仅余额 + 余额历史）
- [claude.md](provider-discovery/claude.md) — Pro/Max 用量：会话路线（无官方 API；本地 JSONL/代理路线违反红线）
- [workbuddy.md](provider-discovery/workbuddy.md) — 腾讯 WorkBuddy Credits：端点待 harness（社区插件已证明余额可读）
- [opencode-go.md](provider-discovery/opencode-go.md) — Go 订阅 5h/周/月 美元额度：控制台会话路线

## UI Prototype（Gate C）

- 运行：`npm install && npm run dev` → http://localhost:5173（底部控制条可切换场景/主题/语言/Connect 流程）
- 截图矩阵：[docs/ui/screenshots/](ui/screenshots/)（27 张，含 125%/150% DPI、双主题、双语言、错误/空态）
- 代码：`src/`（widget / connect / settings / i18n / theme / mock / bridge / types）

## Fixtures 与脚本

- `fixtures/codex-rate-limits.redacted.json` — app-server 真实响应（脱敏）
- `fixtures/zcode-quota-limit.redacted.json` + `-oauth` — monitor 接口实测（凭证证伪）
- `fixtures/mimo-console-network-observations.redacted.json` — 控制台真实网络观测
- `scripts/` — codex-appserver-probe / zcode-quota-probe(+oauth) / mimo-console-capture / **mimo-console-harness（用户参与式，待运行）** / screenshot

## 本机证据摘要（2026-09-28）

- `%USERPROFILE%\.codex\auth.json` 存在；Codex CLI 装于 `%LOCALAPPDATA%\OpenAI\Codex\bin`
- `~/.zcode/v2/credentials.json` 存在（其 api-key 条目对 monitor 接口无效——已证伪）
- 工具链：node/npm/python/git 有；cargo/rustc 无（Phase 2 前置项）
