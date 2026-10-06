# Provider Discovery — OpenAI Codex

- Gate A.1 运行时验证：本机实测通过）
- 证据等级标注：**[官方文档]** / **[官方代码]**（openai/codex 开源仓库 + 本机 `generate-json-schema` 输出）/ **[运行时已验证]**（本机真实响应）/ **[社区]** / **[UNVERIFIED]**
- 结论速览：**可监控性：高，主通道已实测打通**。`codex app-server`（JSON-RPC over stdio）的 `account/rateLimits/read` 一次调用即可获得 5h/weekly 窗口、Reset ×N、付费 Credits——**v1 不需要任何 web 端点**。

---

## 0. 概念修正（Gate A.1，覆盖旧文档）

**付费 Credits 与 Rate Limit Reset Credits 是两个独立的数据概念**，旧文档把二者混写为 "Credits = banked rate-limit resets"，作废。运行时响应中二者并列出现、语义不同：

| 概念 | wire 字段 | 含义 | 映射到通用模型 |
|---|---|---|---|
| 付费 Credits / balance | `rateLimits.credits.{hasCredits, unlimited, balance}` | 用量超限后继续使用的按量余额（真金白银/赠送） | `balances[]` |
| Rate Limit Reset Credits | `rateLimitResetCredits.{availableCount, credits[]}` | banked rate-limit resets：把 5h/weekly 窗口重置的机会（活动赠送） | `resetOpportunities[]`（**仅监控，永不消费**） |

用户只需要显示 `Reset ×N` → 只要 `availableCount`。v1 **不调用** `wham/rate-limit-reset-credits`（app-server 已含），**永不调用** `account/rateLimitResetCredit/consume`。

## 1. 官方目前的额度结构

**[官方文档]** https://developers.openai.com/codex/pricing + **[运行时已验证]**

- Codex 包含在 ChatGPT Free / Go / Plus / Pro / Business / Edu / Enterprise 套餐中；也可用 Platform API Key 登录（另一套计费）。
- **5 小时窗口**（本地消息+云任务共享）+ 可能的**周窗口**：运行时响应显式给出 `windowDurationMins`：primary=**300**（5h）、secondary=**10080**（7×24h）——窗口长度不再需要推断，语义映射从 Derived 升级为 **Official（运行时实证）**。
- 付费 Credits（余额概念）与 banked rate-limit resets（重置机会）**互相独立**（见 §0）。
- 部分模型/功能有独立限额桶：运行时实际出现第三个桶 `base_model_inference`（`limitName: "gpt-reserve"`，关联 `gpt-5.6-luna`，周窗口）——**文档未预期的真实字段，适配器必须渲染 `rateLimitsByLimitId` 全部桶，而非写死两个**。
- `planType` 运行时实测值 `"plus"`；v2 schema 枚举含 `prolite/promax/ent26/...`，必须容忍 `unknown`。
- 存在 `ordinaryUsageAllowed`、`spendControlReached`、`rateLimitReachedType`、`rateLimitUpsell` 等状态字段（schema 定义，运行时亦出现）。

## 2. 官方文档证据

- 定价与限额：https://developers.openai.com/codex/pricing ；认证：https://developers.openai.com/codex/auth ；条款：https://openai.com/policies/terms-of-use
- **官方开源代码**（github.com/openai/codex `codex-rs/`）。
- **本机协议 Schema（决定性）**：`codex app-server generate-json-schema`（codex-cli 0.158.0-alpha.2.1）生成的 v2 协议定义，与真实响应一致：`GetAccountRateLimitsResponse`（`rateLimits`/`rateLimitsByLimitId`/`rateLimitResetCredits`/`ordinaryUsageAllowed`/`accountId`/`rateLimitUpsell`）。

## 3. 可用数据源（按优先级框架）

| 优先级 | 数据源 | 状态 |
|---|---|---|
| P1 官方公开 API | ChatGPT-plan Codex 用量 REST API | ❌ 不存在（platform.openai.com/usage 属另一体系） |
| P2 官方 CLI 本地信息 | **`codex app-server`（JSON-RPC over stdio）** | ✅ **运行时已验证（主通道，唯一 v1 通道）**：本机实测 `initialize` → `account/rateLimits/read` 成功，见 `fixtures/codex-rate-limits.redacted.json` |
| P3 官方客户端本地状态 | `%USERPROFILE%\.codex\auth.json`（字段名已验证）| 仅作为"是否已登录"的发现信号；**不读取 token 内容、不写回** |
| P4 Web 会话端点 | `wham/usage` / `wham/rate-limit-reset-credits` | ⬇️ **降级为高级 fallback / 诊断通道**；reset-credits 端点 v1 不需要（availableCount 已可得） |
| P5 页面解析 | chatgpt.com 用量面板 | 不采用 |

**协议内存在但本应用禁用的方法**：`account/rateLimitResetCredit/consume`（消费 Reset）、`ChatgptAuthTokensRefresh`（token 刷新）——适配器代码中不得出现。

## 4. 是否需要认证

需要 ChatGPT 登录态。但走 app-server 通道时，**登录/刷新完全由官方 CLI 自管，本应用零 token 接触**。

## 5. 认证从哪里得到

- CLI 自身的登录态（本机 `~/.codex/auth.json`，file 模式；keyring 模式则在凭据管理器）。
- **本应用规则（红线）**：不读取 auth.json 内容、不写回、不自行刷新 OAuth token。401/未登录 → `LoginExpired`，引导用户打开 Codex CLI 处理。

## 6. 是否可以自动发现

**可以（运行时已验证）**：Codex CLI 装于 `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`（发现逻辑：扫描该目录模式 + `PATH` + `CODEX_HOME`）；登录态通过调用 `account/rateLimits/read` 的成功与否判定。

## 7. 是否必须用户配置

仅当未安装/未登录 Codex CLI：提示用户自行完成官方 `codex login`（本应用不代输入账号密码）。

## 8. 数据字段映射（运行时实证）

真实响应关键结构（完整见 `fixtures/codex-rate-limits.redacted.json`）：

```jsonc
{
  "ordinaryUsageAllowed": true,
  "rateLimits": {                       // 单桶镜像视图
    "limitId": "codex",
    "primary":   { "usedPercent": 10, "windowDurationMins": 300,   "resetsAt": 1790584624 },
    "secondary": { "usedPercent": 24, "windowDurationMins": 10080, "resetsAt": 1791048061 },
    "credits": { "hasCredits": false, "unlimited": false, "balance": "0" },  // 付费 Credits（独立概念）
    "planType": "plus", "spendControlReached": false, "individualLimit": null
  },
  "rateLimitsByLimitId": {              // 多桶真实视图（适配器以此为准）
    "codex": { "...同上 5h+weekly..." },
    "base_model_inference": { "limitName": "gpt-reserve", "normalModelSlug": "gpt-5.6-luna",
                              "primary": { "usedPercent": 0, "windowDurationMins": 10080 }, "secondary": null }
  },
  "rateLimitResetCredits": {
    "availableCount": 2,                // → Reset ×2，无需额外端点
    "credits": [ { "resetType": "codexRateLimits", "status": "available",
                   "grantedAt": ..., "expiresAt": ..., "title": "Full reset (Weekly + 5 hr)" } ]
  },
  "accountId": "[REDACTED]", "rateLimitUpsell": null
}
```

| 通用模型 | 来源字段 | 置信度 |
|---|---|---|
| QuotaBucket `<limitId>/primary`（rolling 5h） | `rateLimitsByLimitId[*].primary.{usedPercent, windowDurationMins, resetsAt}` | **Official（运行时实证）** |
| QuotaBucket `<limitId>/secondary`（weekly） | 同上 `secondary` | **Official（运行时实证）** |
| ResetOpportunity `Reset ×N` | `rateLimitResetCredits.availableCount`（明细可选：`credits[]` 的 expiresAt/status） | **Official（运行时实证）** |
| Balance（付费 credits） | `rateLimits.credits.{balance, hasCredits, unlimited}` → Balance{total=balance} | **Official**；与 Reset Credits 严格分离 |
| 附加桶 | `rateLimitsByLimitId` 中除 `codex` 外的桶（如 `base_model_inference`）→ `Custom` 展示，label 用 `limitName` | Official |
| 计划类型 | `planType`（容忍 unknown） | Official |
| `ordinaryUsageAllowed=false` | → 显示受限状态 | Official |

派生：`remaining_percent = 100 − usedPercent`（Derived）。`resetsAt` 为 epoch 秒。

## 9. 查询成本

每次刷新 1 次 stdio JSON-RPC 调用（本机进程内，无网络成本——网络由 CLI 池化处理）。后台轮询建议带 `excludeResetCreditDetails: true`（schema 明确：availableCount 仍会返回，只是省略明细查询）。

## 10. 推荐刷新频率

- app-server 常驻 + 以 `account/rateLimits/updated` 推送为主，兜底轮询 15 min
- 无推送场景：活跃 45–60 s / 空闲 5 min；下限 30 s

## 11. 失败模式

1. CLI 未安装/未登录 → `NotConfigured`/`AuthRequired`（引导官方登录）。
2. `planType` 新枚举 → unknown 字符串展示（CLI 自身曾因 `prolite` 崩溃，我们必须容忍）。
3. 桶缺失/null（`secondary: null` 实测出现过——`base_model_inference` 桶）→ 该桶显示"暂无数据"，不显示 0%。
4. app-server 协议演进（v1→v2 方法名变化）→ 解析失败归 `ProviderChanged`。
5. token 过期：CLI 自行恢复；监控端只见短暂错误，退避等待。

## 12. 数据可靠性

**Official（全套）**：字段结构来自官方 schema + 本机真实响应；窗口长度运行时显式给出；无 Estimated 数据。

## 13. 法律/服务条款风险

**低**（Gate A.1 后进一步下降）：v1 唯一通道是官方 CLI 的官方 IPC 面（app-server），请求形态与官方客户端一致、无未公开 web 端点依赖。红线保持：不调用 consume/refresh 方法、不读写 auth.json、不做页面解析、不绕过任何保护。

## 14. 最终推荐方案（已运行时验证）

**`codex app-server` 为正式主通道**：
1. 启动：`codex app-server`（Windows 实测路径 `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`）。
2. 握手：`initialize`（params: `clientInfo{name, version}`）。
3. 快照：`account/rateLimits/read`（params `{supportsLunaReserve:false, excludeResetCreditDetails:true|false}`）。
4. 归一化：`rateLimitsByLimitId` 全部桶 → QuotaBucket（`windowDurationMins` 直接决定 periodType：300→rolling 5h，10080→weekly，其他值→Custom）；`rateLimitResetCredits.availableCount` → Reset ×N；`credits.balance` → Balance。
5. 长期运行：订阅 `account/rateLimits/updated` 推送合并快照；轮询仅兜底。

实测记录：codex-cli 0.158.0-alpha.2.1；initialize 与 read 一次成功；响应含上述全部字段。

## 15. 备用方案

**高级 fallback / 诊断通道（仅排障用，非 v1 依赖）**：直连只读 `GET https://chatgpt.com/backend-api/wham/usage`（Bearer access_token + `chatgpt-account-id` 头，来自官方 CLI 代码）。触发条件：app-server 通道协议性失效且短期无新 CLI 版本。**v1 不调用** `wham/rate-limit-reset-credits`（availableCount 已足够）；**永不调用** consume。

## 附：运行时验证清单状态

| 项 | 状态 |
|---|---|
| app-server 在 Windows 可用、握手与 read 成功 | ✅ 已验证 |
| 真实响应字段全集与 fixture | ✅ `fixtures/codex-rate-limits.redacted.json` |
| `windowDurationMins` 实际值（300/10080） | ✅ 已验证（primary=5h、secondary=weekly 显式化） |
| `availableCount` 可从 app-server 获得 | ✅ 已验证（实测 2） |
| credits/balance 与 reset credits 概念分离 | ✅ 已验证（同一响应并列出现） |
| 文档未预期字段 | ✅ 记录：`base_model_inference` 桶、`ordinaryUsageAllowed`、`rateLimitUpsell`、`spendControlReached` |
| 长期常驻 app-server 的内存开销 | ⏳ UNVERIFIED（Phase 4 性能测量） |
| `account/rateLimits/updated` 推送频率/行为 | ⏳ UNVERIFIED（长会话观察） |
| 多账户/工作区（workspace）场景 | ⏳ UNVERIFIED（本机为个人 plus 账户） |
| `account/usage/read`（token 用量）可用性 | ⏳ UNVERIFIED（schema 存在；v1 不接入） |

## 来源

官方：developers.openai.com/codex/pricing、/codex/auth；openai.com/policies/terms-of-use；github.com/openai/codex（codex-rs backend-client / app-server-protocol）；本机 `codex app-server generate-json-schema`（v2 协议）。
运行时：`fixtures/codex-rate-limits.redacted.json`（本机实测）；探测脚本 `scripts/codex-appserver-probe.mjs`。
