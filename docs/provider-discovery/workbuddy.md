# Provider Discovery — WorkBuddy（腾讯办公 AI，Credits 计费）

> 研究日期 2026-09-29 · 状态：**数据源存在性强，端点待 fixture 验证轮**（ADR-006 提案）
> 结论先行：社区生态已证明「积分余额可程序化查询」；端点未公开，走**用户参与式 harness 抓包**（MiMo 同款）后按 ADR-006 会话路线实装。

## 1. 产品与计费事实

- [WorkBuddy](https://www.workbuddy.cn/)：腾讯推出的办公 AI（AI Agent 办公），桌面客户端 + CLI（`workbuddy-cli login --code <code>`，浏览器登录后授权 CLI）。
- 计费单位 **Credits（积分）**：新用户注册赠 5000；企业版支持管理员统一管控 Credit 用量；官方更新日志多次提及「模型积分用量展示」优化（客户端内有按模型的积分用量界面）。
- **无公开的用量/余额查询 API 文档**（公开资料检索结论）。
- 社区侧：腾讯云控制台可查看 Credits 消耗并设置告警；存在签到送积分的社区脚本（Qoder CN / Trae CN / WorkBuddy）。

## 2. 关键情报：余额可程序化读取已被三方证明

DSH 插件生态存在 **`dsh-plugin-workbuddy-gateway`**（[dsh.fish](https://dsh.fish) 插件市场，2026-09 上架）：

- 功能包括：「从桌面端导入账号，或通过浏览器 OAuth 授权登录」→「**显示账号积分余额**」、网关进程管理。
- 含义：WorkBuddy 的桌面客户端本地保存了账号凭证，且官方后端存在**可返回积分余额的接口**（插件/gateway 在调）。
- 另有 `dsh-qwen-connect` 等插件把「WorkBuddy 桌面 App 包含的模型」接入第三方 Harness——进一步证明桌面客户端持有可用凭证与模型网关。

## 3. 候选路线评估

| 路线 | 判定 | 说明 |
|---|---|---|
| 官方公开用量 API | ❌ 暂无 | 未检索到文档 |
| **harness 抓包（客户端或网页）** | ✅ 推荐 | 用户登录 WorkBuddy（桌面或网页）查看积分页 → 抓网络请求 → 端点 + 会话/凭证形态确认 → 走 ADR-006 会话路线（隔离 WebView2 打开官方页面） |
| 读桌面客户端本地凭证直接调接口 | ⚠️ 待验证 | 模式同 ZCode（其凭证已证伪）；WorkBuddy 的本地凭证形态未知。若 harness 显示凭证是长效 token 且接口稳定，可评估「用户粘贴 Key」路线；当前默认不读第三方客户端文件 |
| 本地网关中转 | ❌ 不采用 | 需要运行/接管 gateway 进程，超出「仅监控」姿态 |

## 3.5 静态分析成果（2026-09-29，官网 JS 包 1.6MB 全量分析）

- **API 形态确认**：axios 实例 `create({timeout:20000, withCredentials:true})` 且**无 baseURL** → 接口为 **www.workbuddy.cn 同源 + Cookie 会话认证**——与 ADR-005（MiMo）形态完全一致，会话路线适配成本极低。
- 已确认端点（GET）：`/console/accounts`、`/console/login/type`、`/console/logout`、`/v2/geoblock`；（POST）：`/billing/pay/get-billing-account-inner`、`/billing/pay/get-price`、`/billing/ide/trial`、`/console/user/from`。
- `/profile/plans-usage` 页面为懒加载分包，积分/用量端点在静态包中未露出 → 由 harness 捕获（`scripts/workbuddy-capture.mjs`，已提交；输出脱敏结构骨架：数值保留、字符串脱敏、零 Cookie/请求头）。
- 登录疑似经 `LoginIframeDialog`（SSO iframe，关联 CodeBuddy 腾讯云体系）；文案确认「WorkBuddy accounts and credits are shared with CodeBuddy」。

## 3.7 端点确认 ✅（2026-09-29，用户 DevTools 手动抓包）

用户在已登录的浏览器里用 Network→Fetch/XHR→Copy all URLs 完成捕获（纯 URL，零凭证）。过滤遥测（galileo/beacon/trace 均为腾讯埋点，忽略）后，`/profile/plans-usage` 页面的数据接口全部现形：

| 页面区块 | 端点 |
|---|---|
| 积分综合 | `GET /billing/meter/get-user-resource-summary` |
| 用量（多次调用，疑按模型/维度） | `GET /billing/meter/get-user-request-usage` |
| 购买积分 | `GET /billing/meter/get-user-resource-paid-packages` |
| 平台奖励积分 | `GET /billing/meter/get-user-resource-free-packages` |
| 订阅计划 | `GET /billing/pay/get-price` |
| 补偿/赠礼状态 | `GET /billing/meter/compensation-status`、`GET /billing/meter/check-gift-claimed` |
| 账号 | `GET /console/accounts`、`GET /console/account` |

- 基础设施：Keycloak SSO（`/auth/realms/copilot`，client_id=console）→ APISIX 网关（`.apisix/redirect` 回调）；与 §3.5 静态分析（同源 + withCredentials Cookie）互证。
- **待补**：上述接口的响应结构（字段名/单位/是否百分比）→ 用户复制 Response JSON 后定映射，随后 ADR-006 WorkBuddy 小节转 Accepted。

## 4. 下一步（验证轮）

1. ~~告知积分页入口~~ ✅ 用户已给：https://www.workbuddy.cn/profile/plans-usage（含订阅计划/购买积分/平台奖励积分/积分综合）。
2. ~~运行 harness 抓端点~~ ✅ 已改为用户 DevTools 手动捕获（专用窗口方案在其机器上不稳定，已弃用；端点清单见 §3.7）。
3. **待办**：用户复制 4 个关键接口的 Response JSON（`get-user-resource-summary` / `get-user-request-usage` / `get-user-resource-paid-packages` / `get-user-resource-free-packages`）→ 定字段映射 → ADR-006 转 Accepted → 按 MiMo 模式实装。

## 5. 风险与红线对照

- 私有接口、国内大厂风控：低频（10–15 min 级）、官方同源端点、失败退避——REFRESH_STRATEGY 已覆盖（同 MiMo 的保守策略）。
- 会话只进隔离 WebView2 profile；快照只存数值；不读对话/文档内容（WorkBuddy 是办公 AI，红线「不读对话」同样适用）。
- endpoint_stability 预记为 `undocumented_first_party`（与 MiMo 同级），UI 不再展示该标签（用户已反馈去掉此类文案）。
