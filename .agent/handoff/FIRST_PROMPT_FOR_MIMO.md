# 给 MiMo 的第一条提示词（复制下方全部内容粘贴到 MiMo Desktop）

> 用途：从 ZCode（GLM-5.3-Flash）交接本项目给 Xiaomi MiMo v2.6 Pro + MiMo Desktop。
> 配套文档：项目根目录 `HANDOFF.md`（完整交接）。

---

你好，我是这个项目的负责人。你将接替上一任开发代理（ZCode + GLM-5.3-Flash），继续开发「AI Agent 用量监控浮窗」项目。

**项目位置**：`C:\Users\14798\Desktop\monitor`

## 第一步：交接阅读（必须，不许跳过）

请按顺序阅读，然后向我复述要点：
1. `HANDOFF.md`（项目根目录，交接总文档，先读它）
2. `PORTABLE_FIRST.md`（最高产品原则）
3. `IMPLEMENTATION_PLAN.md`（Gate 制路线图）
4. `CHANGELOG_GATE_D.md`（最新进展）与 `docs/README.md`（文档总索引）

## 项目现状

- 项目：Windows 11 桌面浮窗，监控 Codex / ZCode·GLM / MiMo Token Plan / DeepSeek 的额度；Tauri 2 + Rust + React/TS；计划开源；Local First（无云后端）。
- 进度：Phase 0（调研/架构）、Phase 1（UI 原型，经我 4 轮验收）、Phase 2（Tauri 壳 + DeepSeek 真实切片，已可运行）完成。
- **当前停在 Gate D：等我审查真实浮窗 + DeepSeek 全链路。我批准前，不得开始 Phase 3 的实施。**
- Phase 3（待批准后）：Codex Managed Runtime（ADR-004）、ZCode 真实接入、MiMo Token Plan 会话读取（ADR-005，需先由我运行 `scripts/mimo-console-harness.mjs` 产出登录态 fixture）。

## 硬性安全红线（无任何例外；这一点在 MiMo 环境里没有自动钩子提醒，你必须自觉遵守）

- Local First：不建云后端、不上传任何数据；凭证只入 Windows 凭据管理器（或隔离 WebView2 profile）。
- 源码/示例/测试/fixture/日志/控制台**不得出现可用凭证字面量**；日志只允许出现 credential_id，绝不出现凭证值。
- 服务端请求：仅 https；发请求前校验 host（白名单硬编码在适配器内）；拒绝 localhost、环回、私有和保留地址。
- SQL：外部输入全部参数绑定，禁止拼接。
- Reset 仅监控：永不调用消费类端点/方法；不发送无意义 LLM 请求试探额度；不读取 prompt/代码/对话内容（活动检测只看进程名与文件 mtime）。
- 不从第三方源下载二进制；不确定的接口字段不得猜测（用项目既有的 `Custom(raw)` 规则）。
- UI 组件层禁止出现任何 Provider 域名/鉴权逻辑；UI 只消费 ProviderSnapshot。

## 协作方式（重要，前任开发代理的经验）

- 全程中文沟通；我的反馈按编号给出，请逐条对应回复"哪条改了什么"。
- **我主要负责 UI 验收，UI 不够漂亮 = FAIL**；不得以"功能已完成"为由继续堆功能。
- 每次改动后必须自检并给证据：
  - UI 改动 → `node scripts/ui-check.mjs`（当前基线 15/15 PASS）+ `node scripts/screenshot.mjs http://localhost:5173` 重生成截图；
  - Rust 改动 → `cargo check` 零错误。
- 诚实第一：演示/占位数据必须明确标注；做不到的事直接说，不糊弄。
- 环境注意（HANDOFF §8 有详情）：本机 Vite 文件监听失效（已配置 usePolling，不要关）；5173 端口常被残留 vite 占用（netstat 找 PID 后 taskkill）。

## 你的第一个任务

1. 读完上述文档后，向我复述：项目目标、Gate 机制、当前 Gate 状态、Phase 3 的三项实装任务分别是什么、以及你会遵守的红线（简版即可）。
2. 按 `HANDOFF.md` §5 验证开发环境：跑通浏览器原型（`npm run dev` + `node scripts/ui-check.mjs` 应 15/15 PASS），并尝试 `npm run tauri dev` 编译真实壳；把实际输出与预期不一致的地方报告给我。
3. 给我一份「Gate D 收尾 + Phase 3 实施方案」草案（先说计划，等我确认后再动手）。

**不要跳过第 1、2 步直接写代码。**
