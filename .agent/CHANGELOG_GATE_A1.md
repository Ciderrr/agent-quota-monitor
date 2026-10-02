# CHANGELOG — Gate A.1 修正与运行时验证

- 执行日期：2026-09-28
- 范围：仅 Gate A.1 指定项。**未进入 Phase 1，未开始 UI 或正式 Provider 实现。**
- 前置状态：Gate A = CONDITIONAL PASS；本变更完成后停止，等待审查。

---

## 1. 运行时验证（本机只读实测）

### 1.1 Codex — `codex app-server` 主通道 ✅ 打通

- 环境：本机官方 Codex CLI `codex-cli 0.158.0-alpha.2.1`（`%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`）。
- 方法：spawn `codex app-server`（JSON-RPC over stdio，行分隔）→ `initialize`（`clientInfo{name,version}`）→ `account/rateLimits/read`（params `{supportsLunaReserve:false, excludeResetCreditDetails:false}`）。
- 结果：一次成功。真实响应（脱敏）见 **`fixtures/codex-rate-limits.redacted.json`**。探测脚本：`scripts/codex-appserver-probe.mjs`（无凭证内容，可复查）。
- 协议方法名以本机 `codex app-server generate-json-schema`（v2 协议）输出为准，未猜测。

**实测确认的关键事实**：

| 项 | 实测值 |
|---|---|
| quota buckets | `rateLimitsByLimitId` 含 **2 个桶**：`codex`（5h+weekly）与 **`base_model_inference`**（`limitName: "gpt-reserve"`，关联 `gpt-5.6-luna`，周窗口，`secondary: null`）——文档未预期字段，适配器必须渲染全部桶 |
| limitId | `"codex"`、`"base_model_inference"` |
| primary window | `usedPercent:10, windowDurationMins:300, resetsAt:<epoch秒>` → **5h 显式化** |
| secondary window | `usedPercent:24, windowDurationMins:10080, resetsAt:<epoch秒>` → **weekly 显式化** |
| windowDurationMins | 300 / 10080（不再需要推断，窗口语义升级为 Official 运行时实证） |
| usedPercent / resetsAt | 如上；`resetsAt` 为 epoch 秒 |
| rateLimitResetCredits | `availableCount:2`，明细 `[{resetType:"codexRateLimits", status:"available", grantedAt, expiresAt, title:"Full reset (Weekly + 5 hr)"}]` |
| availableCount | **2** → `Reset ×2` 无需任何额外端点 |
| credits/balance | `credits:{hasCredits:false, unlimited:false, balance:"0"}` ——与 reset credits **并列出现、语义独立**（概念分离的实证） |
| 计划类型 | `planType:"plus"` |
| 文档未预期字段 | `base_model_inference` 桶、`ordinaryUsageAllowed:true`、`rateLimitUpsell:null`、`spendControlReached:false`、`individualLimit:null` |
| 观察到的通知 | `account/updated`、`remoteControl/status/changed`（`account/rateLimits/updated` schema 存在，短会话未触发） |

**v1 设计后果（已写入文档）**：
1. `codex app-server` 正式确定为主数据通道（Windows 实测可用）。
2. **Reset ×N 只来自 `account/rateLimits/read` 的 `availableCount`**；v1 不调用 `wham/rate-limit-reset-credits`。
3. HTTP `wham/usage` 降级为**高级 fallback / 诊断通道**，非 v1 依赖。
4. 协议中存在但**禁用**的方法：`account/rateLimitResetCredit/consume`（消费 Reset）、`ChatgptAuthTokensRefresh`（token 刷新）。不自行刷新 OAuth token、不写 auth.json。

### 1.2 ZCode / GLM — `GET /api/monitor/usage/quota/limit` ⚠️ 接口通、凭证不通

- 方法：从 `~/.zcode/v2/credentials.json` 自动发现 3 条 `account-provider:coding-plan:account:*:api-key`（bigmodel-team / zai-team / bigmodel-individual，各 113 字符复合串，含 `: . - _`），按区域映射对官方端点做只读 GET；失败后各补一次 Bearer 对比；另补测 `oauth:bigmodel:access_token`（509 字符非 JWT）。脚本：`scripts/zcode-quota-probe.mjs`、`scripts/zcode-quota-probe-oauth.mjs`。
- Fixtures：**`fixtures/zcode-quota-limit.redacted.json`**、**`fixtures/zcode-quota-limit-oauth.redacted.json`**（凭证值、条目名中的账户 id 均未写入）。

**实测结果**：

| 尝试 | 结果 |
|---|---|
| 3 条 api-key × raw（无 Bearer 前缀） | HTTP 200 + `{"code":401,"msg":"令牌已过期或验证不正确"（bigmodel）/ "token expired or incorrect"（z.ai），"success":false}` |
| 3 条 api-key × Bearer（对比） | 完全相同的 401 信封 |
| `oauth:bigmodel:access_token` × raw / Bearer | 相同 401 信封 |

**结论**：
1. **接口与信封结构已验证**：两区域主机可达、HTTP 200 包体判错（code/msg/success）形态确认、区域映射确认（bigmodel 中文错误 / z.ai 英文错误）。
2. **credentials.json 自动发现的凭证不可直接使用（已证伪）**——这些是 ZCode 内部凭证形态（当前 ZCode 会话正以它们工作，"过期"可能性低，更可能是凭证类型不匹配）。旧文档"从 credentials.json 自动发现可用 key"的表述作废。
3. **Authorization 裸 key vs Bearer：仍无法运行时区分**（无被接受的凭证可比对）；裸 key 结论维持"官方插件代码 + 社区"证据等级。
4. **v1 认证路径**：用户在 Settings 粘贴**控制台签发的 Coding Plan API Key**（输入前展示强制安全提示）；key 族决定主机；禁止读取 oauth/zcodejwttoken 值打 monitor 接口。
5. **`limits[]` 字段级结构未观察到**（type/unit/percentage/remaining/usage/currentValue/nextResetTime/level/usageDetails 全部 UNVERIFIED）。按指令：**不猜测**——未知 type/unit 映射为 `PeriodType::Custom(raw)`，UI 使用服务端 label（若有）或通用额度标签；原 `TOKENS_LIMIT unit3→5h / unit6→weekly / TIME_LIMIT unit5→MCP` 表降级为"待验证映射假设"，语义确认前不用于 UI 标签。

## 2. 概念与规格修正（覆盖旧表述）

1. **Credits 概念拆分（Codex）**：付费 Credits/balance 与 Rate Limit Reset Credits 是两个独立概念；分别映射 `balances[]` 与 `resetOpportunities[]`。全文清除 `Credits = banked rate-limit resets` 混写（codex.md §0 专设修正节；DATA_MODEL §2.5 增加概念边界）。
2. **Reset 仅监控**：`Reset ×N` 只读展示；`MonitorOnly` 类型约束不变；consume/refresh 方法在适配器中禁止出现。
3. **MiMo Token Plan v1 策略**：不实现浏览器 Cookie 导入 / SSO session 读取 / SPA 私有 endpoint 轮询 / DOM scraping / 用 `tp-` key 发推理请求试探额度。默认显示"暂不支持自动额度监控 / Usage monitoring unavailable" + `Open Usage Page`；套餐结构、总 Credits、档位名来自官方静态资料（Official）；可选手动输入剩余比例/用量（**Manual / Estimated**，整数显示）。SPA endpoint 调研移入未来独立 MiMo Provider Research，不阻塞 v1。
4. **MiMo Desktop Membership**：维持 v1 Unsupported；允许仅检测"是否安装/是否运行"；禁止读取用户对话、prompt、登录凭证、session、应用内部账户数据。
5. **DeepSeek**：官方 Balance API 只用于余额；**禁止**用两次余额快照差值生成 Today/Monthly spend 或 Token usage；允许保存并展示 **Balance history / 余额变化**；未来消费统计仅在用户导入官方 usage 数据后独立实现。

## 3. 变更文件清单

| 文件 | 变更 |
|---|---|
| `fixtures/codex-rate-limits.redacted.json` | 新增（真实响应，脱敏：accountId→[REDACTED_UUID]、reset credit id→[REDACTED]、codexHome→[LOCAL_PATH]） |
| `fixtures/zcode-quota-limit.redacted.json` | 新增（6 次尝试记录，凭证值/账户 id 未写入） |
| `fixtures/zcode-quota-limit-oauth.redacted.json` | 新增（OAuth 补充验证，token 未写入） |
| `scripts/codex-appserver-probe.mjs` | 新增（可复查的只读探测脚本，内含递归脱敏函数） |
| `scripts/zcode-quota-probe.mjs` / `scripts/zcode-quota-probe-oauth.mjs` | 新增（同上；主机白名单硬校验，仅 https） |
| `docs/provider-discovery/codex.md` | 重写：概念拆分、app-server 实证、wham 降级、字段映射运行时化、验证清单更新 |
| `docs/provider-discovery/zcode.md` | 重写：凭证结论反转、Custom(raw) 规则、验证清单更新 |
| `docs/provider-discovery/mimo-token-plan.md` | 重写：v1 降级支持形态与红线 |
| `docs/provider-discovery/mimo-desktop.md` | 编辑：存在性检测边界（允许/禁止清单） |
| `docs/provider-discovery/deepseek.md` | 编辑：余额专属规则 + Balance history，禁止差值推算 |
| `PRODUCT_SPEC.md` | 支持矩阵按上述结论更新 |
| `DATA_MODEL.md` | Balance/ResetOpportunity 概念边界、余额差值禁令、Manual+Estimated 标注 |
| `docs/README.md` | 状态与 fixtures 索引 |
| `.tmp-gate-a1/` | 临时 Schema 目录已删除，不入库 |

## 4. 仍然存在的 UNVERIFIED 项（汇总）

**Codex**
- [ ] 长期常驻 `app-server` 子进程的内存开销（Phase 4 性能测量）
- [ ] `account/rateLimits/updated` 推送的实际频率与稀疏更新行为（需长会话观察）
- [ ] 多账户 / workspace（团队）场景下 `chatgpt-account-id` 语义与桶形态
- [ ] `account/usage/read`（token 用量，schema 已存在）的真实响应——v1 不接入，仅登记
- [ ] wham/usage 直连通道的实际可用性（仅 fallback，未实测）

**ZCode / GLM**
- [ ] 控制台签发 Coding Plan API Key 的实际可用性（需用户提供 key；Gate E 前验证）
- [ ] Authorization 裸 key vs Bearer 的运行时区分
- [ ] `limits[]` 字段级结构（type/unit/percentage/remaining/usage/currentValue/nextResetTime/level/usageDetails）
- [ ] `TOKENS_LIMIT unit3→5h`、`unit6→weekly`、`TIME_LIMIT unit5→MCP` 语义确认（确认前 v1 用 Custom(raw)+通用标签）
- [ ] `model-usage` / `tool-usage` 明细接口 schema
- [ ] `zcode.z.ai/api/v1/zcode-plan/billing/*` OAuth 通道（独立调研）

**MiMo Token Plan**（全部移入未来独立 MiMo Provider Research，不阻塞 v1）
- [ ] `/api/v1/tokenPlan/usage` 等控制台 SPA 碎片端点
- [ ] 年付池进度条语义；赠送积分展示；用户协议反自动化条款；SSO 会话有效期

**MiMo Desktop Membership**
- [ ] 全部额度数据源（v1 维持 Unsupported；§14 取证计划未执行）

**DeepSeek**
- [ ] 无（Discovery 通过；余额更新时机官方未文档化——UI 按最终一致呈现，非阻塞）

## 5. 状态

Gate A.1 全部指定项完成。**停止，不进入 Phase 1**，等待审查确认后进入 Gate C（UI 原型，Mock 数据）。
