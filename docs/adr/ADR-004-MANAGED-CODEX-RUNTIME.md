# ADR-004 — Managed Codex Runtime（Clean PC 上的 Codex 供应与登录）

- 状态：Accepted（Gate B 修订轮）
- 日期：2026-09-28

## 背景

Portable-first 原则（PORTABLE_FIRST.md）：Clean Windows 11 PC 只装 Monitor 就能 "Connect Codex → Sign in with ChatGPT" 完成监控；用户不得被要求"先安装 Codex CLI"。Gate A.1 已验证 `codex app-server`（JSON-RPC over stdio）是主数据通道（5h/weekly/GPT Reserve 桶、Reset ×N、credits.balance），因此 Codex Provider 需要**由 Monitor 管理的官方 runtime**。

## 事实核查

- `openai/codex` 许可证 = **Apache-2.0**（GitHub LICENSE 与 npm 元数据双确认）→ 未修改二进制的再分发合法（需附许可证与声明）。
- 官方发行源：npm `@openai/codex`（当前 0.157.1，Apache-2.0，registry 提供 sha512 integrity）；GitHub Releases 提供预编译二进制。
- 登录协议（app-server v2 schema，本机 `generate-json-schema` 确认）：
  - `account/login/start`，params 变体：`{type:"chatgpt", appBrand:"codex"|"chatgpt"}`（浏览器登录）、`{type:"chatgptDeviceCode"}`（设备码）、`{type:"apiKey"}`（粘贴 key）。
  - 完成通知 `account/login/completed {success, loginId?, error?}`。
  - **存在但禁用**：`{type:"chatgptAuthTokens"}`（直接喂 access token——标记 UNSTABLE 且违反零 token 原则）。
  - runtime 自管 token 存储与刷新；Monitor 永不接触。

## 决策

**采用 B：首次连接时从官方源按需下载， integrity 校验，版本固定 + 更新支持。**

1. 下载源白名单：npm registry `@openai/codex` tarball（registry.npmjs.org，用 registry 元数据中的 `dist.integrity` 做 sha512 校验）或 GitHub `openai/codex` Releases。仅此两个来源；禁止任何第三方镜像。
2. 版本策略：记录并固定 tested version（`docs/` 中登记），支持"检查更新"（仍限官方源）；下载物校验后放入 `%LOCALAPPDATA%\AgentQuotaMonitor\runtimes\codex\<version>\`，与 Monitor 凭据空间隔离。
3. 记录义务：bundled/downloaded version 与来源写入 About/诊断信息与 `docs/performance.md` 附表。
4. 登录 UX：`Connect Codex` → Monitor 启动/复用 managed runtime → 发 `account/login/start{type:"chatgpt"}` → 打开官方 ChatGPT 登录页 → `account/login/completed{success}` → `account/rateLimits/read`。用户全程不知道 app-server 存在；不被要求复制任何 token/auth.json。
5. 备选连接（同一 runtime 支持）：`{type:"apiKey"}`（Platform 计费用户）。

## 否决与备选

- **A（随安装包分发官方 binary）**：合法（Apache-2.0）但 installer 增重 ~数十 MB、runtime 版本与产品版本耦合、更新需重发包 → 不选；保留为离线安装场景的可选 future work。
- **复用本机已装 Codex**：仅作 Optional Enhancement（`localEnhancements: existingRuntime`）——探测到兼容版本时优先复用其登录态，避免下载；Clean PC 上绝不依赖。
- **chatgptAuthTokens 注入**：禁用（UNSTABLE + 违反"Monitor 不处理 token"红线）。

## 风险

| 风险 | 缓解 |
|---|---|
| OpenAI 变更 CLI 分发/接口 | 版本固定 + 启动时 schema 探测（`initialize` 失败 → `ProviderChanged`）；仅官方源更新 |
| 下载被劫持 | https + sha512 integrity + 来源白名单 |
| 登录回调环境（浏览器可用性） | chatgptDeviceCode 变体兜底 |
| Apache-2.0 合规 | 随分发/下载记录 LICENSE 与 NOTICE（About 页可见） |

## 后果

- Codex 成为完全 Portable 的 Provider：`connectionMethods: [BrowserLogin, ApiKey]`，`localEnhancements: [existingRuntime, processActivity]`。
- Clean-PC Acceptance Test（PORTABLE_FIRST.md §3）的 Codex 项达成路径明确。
