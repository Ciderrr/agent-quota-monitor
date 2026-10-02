# ADR-005 — MiMo Token Plan 控制台会话接入（Round 2 结论）

- 状态：Accepted（Route A 选定）；**Authenticated fixture pending**
- 日期：2026-09-28

## 背景

Portable-first 要求：Clean PC 上无 MiMo Desktop 也能读取 Token Plan 月度额度百分比。用户已确认控制台登录后可见 Monthly Usage %。Round 2（docs/provider-discovery/mimo-token-plan-round2.md）已在代码层定位数据源并观测了 Console 真实网络行为。

## 决策

**Route A：专用 WebView2 Session（隔离 profile）**。

1. `Connect MiMo` → Monitor 打开隔离的 WebView2 窗口，加载官方 Console 页（platform.xiaomimimo.com）。
2. 用户**在官方页面**完成小米账号登录（Console 自身流程：`/api/v1/genLoginUrl` → account.xiaomi.com SSO → callback 回跳；均由官方驱动，Monitor 不构造认证请求、不读取凭据输入）。
3. 会话 Cookie 保存在 Monitor 专属 WebView2 profile（native 层域），React 前端零接触；Cookie/session 永不 serialize（SECURITY.md 约束）。
4. 监控会话有效性：同源 `GET /api/v1/userProfile`（401 = Login required）。
5. 数据抓取：同源只读 `GET /api/v1/tokenPlan/usage` + `/tokenPlan/detail` → 归一化为 ProviderSnapshot。

**EndpointStability 披露**：这些是官方第一方但未公开文档化的接口。UI 数据徽标显示 Official（数据源为小米官方服务端），详情页数据说明如实标注"官方未文档化接口"。

**UX 现状（诚实原则）**：登录态响应 fixture 尚未采集 → v1 原型中 `Connect MiMo` 页面显示"Automatic usage monitoring is being validated / 自动额度监控验证中"状态，**不提供假的登录按钮**；harness（`scripts/mimo-console-harness.mjs`）完成一次用户参与式采集并确认 schema 后，切换为上述 Sign in 流程（设计已完成）。

## 否决路线

- **B（系统浏览器 OAuth/callback）**：观测显示小米 SSO 是网页会话制（Console 页面 callback 回跳），无适用于第三方的公开 OAuth flow → 不适用；禁止自造 flow。
- **C（手动导入会话）**：仅最后备用，不默认。
- **D（DOM scraping）**：API 数据源已定位，无必要。

## 验证清单（解锁正式接入）

1. 用户运行 harness → `fixtures/mimo-token-plan.redacted.json`（usage/detail/subscription/status/userProfile 响应）。
2. 确认 `percent`/`usedPercent` 量纲（0–100 vs 0–1）、`items[]` 条目集、detail 中套餐名字段。
3. 会话有效期观察（决定默认刷新频率上限与 Login required 提示策略）。
4. 通过后：PORTABLE_FIRST 矩阵 MiMo 状态 Pending → Ready；启用 Connect 流程；`connectionMethods: [WebAccountSession]`。

## 风险

| 风险 | 缓解 |
|---|---|
| 未文档化接口变更 | `Endpoint changed` 错误态 + 曾成功快照 + stale 展示；低频轮询（10–15 min） |
| 会话过期 | userProfile 探测 → `Login required` → 重新打开官方登录窗 |
| WebView2 profile 污染/泄露 | profile 目录仅 native 可访问；设置页"清除 MiMo 会话"= 删除整个 profile；退出登录可先调官方 logout |
| ToS | 只读同源接口、用户自己的会话与数据、低频；无 DOM 抓取、无凭据接触 |
