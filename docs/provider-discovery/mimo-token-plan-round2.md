# Provider Discovery — MiMo Token Plan Round 2（控制台数据源定位）

（Portable-first 修订轮）
- 目标：找到 MiMo 官方控制台（platform.xiaomimimo.com）显示 **Monthly Usage %** 的真实数据源——**不允许**只凭 JS 字符串猜接口。
- 结论：**数据源已在代码层定位 + 控制台真实网络行为已无登录态观测**。剩余缺口仅为登录态响应 fixture（由用户参与式 harness 采集）。

---

## 1. 证据等级声明

| 标记 | 含义 |
|---|---|
| [观测·真实请求] | 无登录态 headless 浏览器捕获的 Console **真实发出**的网络请求（`fixtures/mimo-console-network-observations.redacted.json`） |
| [代码层] | 官方控制台 SPA bundle 中的 url+method 定义与响应字段消费代码（非字符串猜测：来自 HTTP 客户端封装与渲染组件的取值表达式） |
| [登录态待验证] | 需要用户参与式 harness（`scripts/mimo-console-harness.mjs`）采集登录态响应后确认 |

## 2. Console 真实网络行为（[观测·真实请求]）

无登录态加载 `platform.xiaomimimo.com/#/console/plan-manage` 时，Console 自己发出：

1. `GET https://platform.xiaomimimo.com/api/v1/userProfile` → **401**（会话检查，首个 API 调用）
2. `GET https://platform.xiaomimimo.com/api/v1/genLoginUrl?currentPath=[Q]` → **302**（**登录 URL 由 Console 自家后端生成**，非前端拼装）
3. 302 → `account.xiaomi.com/pass/serviceLogin?callback=[Q]&sid=[Q]` → `account.xiaomi.com/fe/service/login/password?…&callback=[Q]`（小米账号 SSO；登录完成后经 callback 回跳 Console）

**架构含义**：
- Console 的全部业务 API **同源**（`platform.xiaomimimo.com/api/v1/*`），鉴权即小米 SSO 会话 Cookie → **专用 WebView2 profile 中保住该 origin 的会话，等价于 Console 自身会话**（Route A 与官方行为同构）。
- 登录流程完全由官方页驱动（genLoginUrl → SSO → callback）→ Monitor 只需"打开官方页"，不构造任何认证请求。

## 3. 端点清单（[代码层]，url+method 来自官方 HTTP 客户端封装）

全部同源 `/api/v1` 前缀。**与额度监控相关**：

| 端点 | 方法 | 作用（按消费代码推断） |
|---|---|---|
| `/tokenPlan/usage` | GET | **月度用量（核心）**：个人版返回 items 列表；团队版返回 usedPercent/nextResetTime 对象 |
| `/tokenPlan/detail` | GET | 套餐详情：套餐信息、有效期 `currentPeriodEnd`、补偿/赠送积分、自动续费 |
| `/tokenPlan/subscription/status` | GET | 订阅状态 |
| `/balance` | GET | 账户余额（按量侧） |
| `/usage` | GET | 按量用量（非 Token Plan） |
| `/userProfile` | GET | 会话/账户信息（[观测·真实请求] 401 形态已确认） |

其余（监控不需要，列入禁采清单）：`/tokenPlan/apiKey*`（key 管理）、`/tokenPlan/purchase|cancel|deductRedirect|managementUrl`（交易）、`/teamTokenPlan/*`（团队管理）、`/usage/token-plan/list|export`（明细/导出）、`/auth/*`、`/genLoginUrl`。

## 4. 响应字段（[代码层] 字段名，值待登录态 fixture）

### `/tokenPlan/usage`（个人版）

渲染组件直接消费（chunk 279，`items.map`）：

- `items[]`，每项：`name`（字符串；已知值 `"compensation_total_token"`=补偿积分，limit=0 时 UI 隐藏；其余条目名由服务端下发）、`percent`（**用量百分比**——UI 以 toFixed(1) 显示为 `{{value}}%`，即控制台可见的 Monthly Usage %）、`used`（数值）、`limit`（数值）→ UI 显示 `{{used}} / {{limit}}`
- 团队概览对象形态：`usedPercent`（数值）+ `nextResetTime`（时间，UI 转倒计时）
- 分数→百分比钳制工具 `f(e)=clamp(100e,0,100)` 存在于同一 API 模块（提示部分字段可能是 0–1 分数；登录态 fixture 将确定 `percent` 的量纲）

### `/tokenPlan/detail`

消费代码中的字段名：`currentPeriodEnd`（→ UI "有效期至 {{date}} (UTC)"）、`baseGiftAmount / baseGiftAmountCny / baseGiftExpireTime / baseGiftStatus`、`enterpriseGift*`、`autoRenew / autoRenewPrice / priceInfoWithAutoRenew / priceInfoWithoutAutoRenew`。

**映射预览（待 fixture 确认量纲后定稿）**：

| 通用模型 | 来源 | 置信度 |
|---|---|---|
| QuotaBucket `mimo-token-plan/monthly` | usage items 主条目：`percent`（→ used%）与 `used/limit`（可互推另一项 → Derived） | Official-source / Undocumented first-party |
| reset/renew 日期 | detail `currentPeriodEnd` | 同上 |
| 补偿积分 Balance | usage `compensation_total_token` 条目（used/limit）或 detail `baseGift*` | 同上 |
| 套餐名 | detail（plan name 字段待 fixture 确认） | 同上 |

## 5. 认证路线结论（对应 Portable-first 目标）

- **Route A（专用 WebView2 Session）— 选定**：Monitor 专属 profile 打开官方 Console → 用户在官方页登录（genLoginUrl→SSO→callback 全官方）→ 同源会话 Cookie 留在该 profile → Monitor 用同一会话只读调用 §3 端点。与 Console 自身网络行为同构，无任何自造认证。**待办：登录态 fixture 确认响应 schema 与量纲。**
- Route B（系统浏览器 + OAuth callback）：小米 SSO 是网页会话制而非标准 OAuth（观测到 callback 为 Console 页面回跳）→ 无公开 OAuth flow，**不适用**（不自行创造）。
- Route C（手动导入会话）：仅最后备用，不做默认 UX。
- Route D（DOM scraping）：不作为正式方案。

## 6. 安全设计（ADR-005 配套）

- 会话仅存在于隔离 WebView2 profile（native/provider backend 域），React 前端永远拿不到 Cookie/session token；UI 只消费 ProviderSnapshot。
- Cookie/session 永不 serialize 到 SQLite/JSON/localStorage/log/crash dump；监控请求由 native 层持有会话发出。
- 首次连接固定文案（逐字实现）：
  - 中文："登录将在小米 MiMo 官方页面完成。Agent Quota Monitor 不会读取或保存你的账号密码；登录会话仅保留在本机，用于读取你自己的 Token Plan 用量信息。"
  - English："Sign-in is completed on the official Xiaomi MiMo page. Agent Quota Monitor never reads or stores your password. Your sign-in session remains on this device and is used only to retrieve your own Token Plan usage."

## 7. 数据可信度（两个维度分开）

- **DataQuality：Official-source / Account data**（数据来自小米官方服务端，属用户自己的账户数据）。
- **EndpointStability：Undocumented first-party API**（官方但未公开文档化的第一方接口）——UI 的数据来源徽标展示为 Official，同时在详情页数据说明中如实标注"官方未文档化接口"，不得隐藏。

## 8. 失败状态

Not connected / Login required / Session expired（userProfile 401）/ Endpoint changed（曾成功、持续解析失败）/ Temporarily unavailable（5xx）/ Unsupported。曾成功后失败 → 显示最后快照（如 `67% remaining · Updated 2h ago`）+ Stale 标记，绝不变 0%。

## 9. 剩余验证步骤（一次用户参与式运行）

1. 运行 `node scripts/mimo-console-harness.mjs`；在官方页登录并进入 plan-manage。
2. Harness 自动采集 `tokenPlan/usage|detail|subscription/status|balance|userProfile` 的请求形态与脱敏响应 → `fixtures/mimo-token-plan.redacted.json`。
3. 确认 `percent`/`usedPercent` 量纲（0–100 vs 0–1）、`items[]` 完整条目集、detail 套餐名字段。
4. 确认后：Connect MiMo 启用"Sign in to Xiaomi MiMo"流程（UX 已在原型中设计）；PORTABLE_FIRST 矩阵中 MiMo 状态从 Pending → Ready。
