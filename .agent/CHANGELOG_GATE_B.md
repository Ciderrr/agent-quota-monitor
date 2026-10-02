# CHANGELOG — Gate B 修订（Portable-first）与 Phase 1 UI Prototype

- 日期：2026-09-28
- 范围：产品原则修正 + MiMo Token Plan Round 2 专项研究 + 文档修订 + Phase 1 UI Prototype（Mock）。
- 状态：**停止在 Gate C，等待用户 UI 验收。未接入任何真实 Provider。**

---

## 1. 核心原则修正：Portable-first（PORTABLE_FIRST.md，新增）

- 产品定位修正：**Account-level AI Quota Monitor**（非 Local Agent Companion）。
- 双层架构：Remote Account Layer（OAuth / API Key / Account Session / Official API / Managed Runtime，决定可用性）+ Local Enhancement Layer（agent 检测/登录复用/进程活动/本地库，只优化体验）。
- Clean-PC Acceptance Test 成为产品级验收：全新 Windows 11 只装 Monitor 即可连接全部四家。
- Provider 状态 ≠ 安装状态（两个独立维度）；`connectionMethods[]` 与 `localEnhancements[]` 分离。
- Smart Refresh 基线不依赖本地 Agent；活动检测 = 刷新优化。

## 2. MiMo Token Plan Round 2（专项研究，结论：数据源已定位）

- **无登录态真实捕获**（`fixtures/mimo-console-network-observations.redacted.json`）：Console 启动即调 `GET /api/v1/userProfile`（401）→ `GET /api/v1/genLoginUrl`（302，登录 URL 由官方后端生成）→ 小米账号 SSO（account.xiaomi.com）→ callback 回跳。API 全部同源 `/api/v1/*`。
- **代码层端点定位**（官方 SPA bundle 的 HTTP 客户端封装与渲染组件取值表达式，非字符串猜测）：
  - `GET /api/v1/tokenPlan/usage`：个人版 `items[]{name, percent, used, limit}`（`percent` 即控制台显示的月度用量百分比；`compensation_total_token`=补偿积分条目）；团队版对象含 `usedPercent` + `nextResetTime`
  - `GET /api/v1/tokenPlan/detail`：`currentPeriodEnd`（有效期/续期）、`baseGift*`/`enterpriseGift*`（补偿积分）、`autoRenew*`
  - 配套：`/tokenPlan/subscription/status`、`/balance`、`/userProfile`
- **认证路线（ADR-005）**：Route A 专用 WebView2 隔离 profile（与 Console 自身会话同构）选定；Route B 系统浏览器 OAuth 不适用（小米 SSO 为网页会话制）；DOM scraping 不采用。
- **数据可信度两维度**：DataQuality = Official-source（小米官方服务端）；EndpointStability = **Undocumented first-party**（如实披露，不隐藏）。
- **剩余缺口**：登录态响应 fixture（量纲 0–100 vs 0–1、items 完整条目集）→ 用户参与式 harness 已就绪：`node scripts/mimo-console-harness.mjs`（用户在官方页亲自登录；harness 不接触凭据，输出彻底脱敏的 `fixtures/mimo-token-plan.redacted.json`）。
- **UX 诚实原则**：fixture 完成前，Connect MiMo 显示 "Automatic usage monitoring is being validated / 自动额度监控验证中"，**无假登录按钮**。

## 3. Codex：Managed Runtime（ADR-004）

- License 核实：openai/codex = **Apache-2.0**（GitHub + npm 双确认）→ 再分发合法。
- 决策：**首次连接从官方源按需下载**（npm `@openai/codex` tarball + registry sha512 integrity 校验，版本固定、仅官方源、支持更新、来源与版本可追溯）；本机已有 Codex = Optional Enhancement；installer 内置（方案 A）保留为离线可选。
- Clean-PC 登录：`account/login/start{type:"chatgpt"}` → 官方 ChatGPT 页 → `account/login/completed` 通知 → `account/rateLimits/read`；用户零 token 接触；`chatgptAuthTokens` 变体禁用。

## 4. MiMo 范围调整

- **MiMo Desktop Membership = OUT OF V1 SCOPE（Deferred）**：不入 Registry、无 UI 卡片、无安装/运行检测、无研究投入；Discovery 文档归档保留。
- v1 Provider 列表 = Codex / ZCode / MiMo Token Plan / DeepSeek。

## 5. 文档变更清单

| 文件 | 变更 |
|---|---|
| PORTABLE_FIRST.md | 新增（原则 + 双层 + Clean-PC + Gate B 自审） |
| ADR-004-MANAGED-CODEX-RUNTIME.md | 新增 |
| ADR-005-MIMO-CONSOLE-SESSION.md | 新增 |
| docs/provider-discovery/mimo-token-plan-round2.md | 新增 |
| fixtures/mimo-console-network-observations.redacted.json | 新增（真实网络观测） |
| scripts/mimo-console-harness.mjs | 新增（用户参与式采集，研究专用） |
| PRODUCT_SPEC / ARCHITECTURE / DATA_MODEL / PROVIDER_INTERFACE / SECURITY / REFRESH_STRATEGY / UI_SPEC | Portable-first 修订（双层、Managed Runtime、会话隔离与固定文案、能力模型、连接/安装状态分离、Connect 页面规范与 Mock 场景） |
| IMPLEMENTATION_PLAN.md | Phase 重排（见下） |

## 6. Phase 1 UI Prototype（本轮交付，全部 Mock）

- 技术形态：Vite + React + TS 纯前端原型；**PlatformBridge 抽象层**保证 Phase 2 换 Tauri IPC 时 UI 零改动；Mock 引擎快照结构与 DATA_MODEL 同形。
- 界面：Collapsed / Expanded overview / Provider detail（动态桶 + Reset ×N + 余额明细 + 来源与接口稳定性披露）/ Connect×4（Codex 浏览器登录三步流、ZCode/DeepSeek key+测试+安全文案、MiMo 验证中状态）/ Settings 六节（含"连接状态 vs 本机程序"双维展示、凭证列表仅 credential_id）/ History（Today/7d/30d，Tokens/Credits/Money/Quota% 分列，余额折线）/ 错误·stale·未配置·空态 / Light+Dark / zh+en / 125%+150% DPI。
- 截图 27 张：docs/ui/screenshots/。
- 运行：`npm install && npm run dev` → http://localhost:5173（控制条可切场景/主题/语言/Connect）。

## 7. Gate B Self-Audit 结果（详见 PORTABLE_FIRST §7）

- Portable：无任何 `!installed → unsupported` 路径 ✅
- Secrets：React 拿不到 key/token/cookie/session；凭证直通 native ✅
- Dynamic Quota：无 Provider 固定字段，动态 quotaBuckets + Custom(raw) ✅
- Provider Isolation：UI 源码零 Provider 域名/鉴权细节 ✅

## 8. 已知 UI 未解决问题（提交 Gate C 评审时如实列出）

1. 壁纸为 CSS 渐变替身；Mica 为 backdrop-filter 模拟——真实材质在 Phase 2 Tauri 壳中落地（window-vibrancy）。
2. Overview 次级桶 chip 文案 "5 小时 90%" 语义可再打磨（是否加"剩"字消歧）。
3. 图标为占位单色字母 monogram，正式版需为每 Provider 设计 16px 单色标识。
4. 折叠行副标题在窄宽度长倒计时下会截断（ellipsis 已处理，视觉可再优化）。
5. Connect 流为 Mock 交互（Codex 登录步进为演示节奏），真实流程 Phase 3 接入。

## 9. 状态

**停止在 Gate C。** 不接入真实 DeepSeek、不实现完整 Codex Provider、不进入 Phase 2——等待用户 UI 验收（用户本项目的主要职责；UI 不够漂亮 = Gate C FAIL）。

---

## 10. Gate C 反馈修订（第一轮，2026-09-28）

用户验收反馈 → 修复对照（9 项自动化交互验证全部 PASS，`scripts/ui-check.mjs`）：

| 反馈 | 修复 |
|---|---|
| ① Connect Codex 无完成态、不自动关闭 | 连接完成 → 显示"已完成"+「N 秒后自动关闭」倒计时，3s 自动关闭（Codex/Key 流程一致）。注：Gate C 为纯 Mock，Codex 不打开真实网页——真实登录在 Phase 3 由 Managed Runtime 驱动（ADR-004） |
| ② MiMo 周期与真实套餐不符 | Mock 对齐真实账户：Standard · 11B Credits · 本期至 **2026-10-23**（详情页显示"24天X小时后重置"）；剩余 % 仍为占位，待 harness 登录态 fixture 替换。补充"验证通过后完整流程"说明：官方页登录 → 自动读取 → 提示已获取 → 3s 自动关闭 |
| ③ 点击 Provider 无二级详情 | 修复根因：拖拽区 pointer capture 吞掉了子元素 click。重写拖拽（>4px 位移判定 + window 级监听 + 拖后误触拦截），点击链路 折叠行→展开→详情→返回 全部验证通过 |
| ④ 开机自启/窗口模式不可点 | 设置页全部控件接入状态（switch/seg 均可交互，Mock 持久化） |
| ⑤ 智能刷新 seg 不可点且过宽 | 可点击选择 Smart/1/5/10；seg 重排（缩内边距、nowrap、flex-shrink:0） |
| ⑥ 通知开关不可点、阈值需自定义 | 开关可切换；提醒/严重/余额阈值改为**自定义数字输入**（带单位、范围钳制，严重阈值上限自动跟随提醒阈值） |
| ⑦ 期望 iOS 液态玻璃涟漪 | 新增 GlassSurface：鼠标高光跟随（specular sheen）+ 按下涟漪（radial scale+fade），覆盖浮窗与全部模拟窗口；仅 transform/opacity 合成器属性，prefers-reduced-motion 下禁用涟漪 |

隔离断言复查：UI 组件层（widget/connect/settings/i18n）零 Provider 域名 ✅（connect-mimo 的硬编码 URL 改为从 Provider 元数据读取）。

---

## 11. Gate C 反馈修订（第二轮，2026-09-28）

| 反馈 | 修复 |
|---|---|
| ① 玻璃高光刺眼 | sheen/涟漪 alpha 调暗：dark 0.10→0.055 / 涟漪 0.20→0.09；light 同步下调；观感为"隐约反光"而非打光 |
| ② 测试连接无反馈 | 点击后 spinner（测试中）→ 0.9s 后显示"✓ 连接成功"内联反馈，3.2s 自动消退 |
| ②' "本机程序：未安装"困惑 | 按用户意见从 Providers 行移除（真实实现中安装发现会周期自动更新，但它不承担任何功能角色，仅作为活动检测增强存在，不再在 UI 占位） |
| ③ 阈值改预设+自定义 | 三个阈值均改为 [预设×3 + 自定义] 分段控件：提醒 25/20/15%、严重 10/5/3%、余额 ¥30/50/100；点"自定义"显示数字输入框（范围钳制） |
| ④ 展开后无法回到精简 | 展开概览头部新增"收起"按钮（⌃，title=收起）→ 折叠；Esc 亦可逐级收起 |

交互验证 11/11 PASS（`scripts/ui-check.mjs`，新增收起按钮、阈值预设+自定义、本机程序移除三项断言）。截图矩阵同步重生成。

---

## 12. Gate C 反馈修订（第三轮，2026-09-28）

| 反馈 | 修复 |
|---|---|
| ① MiMo 命名 | 折叠行/详情统一显示 **MiMo Token Plan**；详情页小字注明"MiMo Desktop 会员为独立订阅，其额度暂无法获取（v1 范围外）"。**确认依据**：mimo-desktop.md Round 1 研究定论——无 API、无公开端点、无社区逆向资料，已归档为 OUT OF V1 SCOPE |
| ② 导航逻辑重构 | 新信息架构：**精简层点谁 → 直接进谁的详情**（不再强制经过全体层）；详情 ‹ → 全体概览（全局视角）；概览 ⌃ → 收起。统计（History）入口在**概览与详情两层头部都有**，且从哪层打开、返回时就回哪层（来源记忆）。Esc 沿 统计→来源 / 详情→概览→精简 逐级回退 |

导航全链路自动化验证 13/13 PASS（新增：直进详情、概览↔详情、详情统计入口、统计来源记忆返回）。截图矩阵同步重生成。

---

## 13. Gate C 反馈修订（第四轮，2026-09-28）

| 反馈 | 修复 |
|---|---|
| ① 导航模式改为用户可选 | 设置→通用新增**默认视图**：精简 / 详细两张模式卡片（内嵌主题化迷你预览图，自动跟随 dark/light）；精简=行列表为主界面，详细=全体概览为主界面，两种模式下点击条目都直达单个 Provider 详情；详情 ‹ 恒定回到全体概览；⌃ 收起按钮仅在默认视图=精简时显示 |
| ② Connect MiMo 登录后无反应 | 原因：原型为纯前端 Mock，**无法跨进程读取你浏览器里的会话**（真实读取在 Phase 3 由隔离 WebView2 profile 实现）。本轮新增**演示读取流程**：点"我已在官方页面完成登录（演示读取流程）" → 读取动画 → "✓ 已获取信息 · N 秒后自动关闭"，并明确标注"演示数据：正式版将显示你的真实数据"；读取完成后浮窗显示 MiMo（Standard · 2026-10-23 周期）。真实数据仍以 harness（`scripts/mimo-console-harness.mjs`）fixture 为解锁条件 |

另修复：Vite 文件监听在本环境失效导致 HMR 提供旧代码（此前"改了没变化"的根因）→ vite.config 开启 usePolling 轮询。

交互验证 15/15 PASS（新增：MiMo 演示读取闭环、默认视图切换生效）。截图 30 张同步重生成。

---

## 14. Gate C 反馈修订（第五轮，2026-09-28）

| 反馈 | 修复 |
|---|---|
| ① 默认视图区域字体与其他不一致 | 根因：`.label`/`.desc` 样式被限定在 `.set-row` 作用域内，默认视图区块脱离该层级后落入浏览器默认 16px 字体。改为全局类，设置页全部文字统一 |
| ② 详细视图"不详细"且长短无规律 | 概览块重设计：chips（宽窄不一）替换为**统一两列栅格明细行**（左标签右数值、tabular 数字右对齐）——每家展示全部桶（5 小时/GPT Reserve/Reset ×2 含过期时间）、MiMo 已用 3.6B/11B Credits、DeepSeek 赠金/充值金额；主桶保留唯一进度条。信息密度显著高于精简层且节奏对齐 |

交互验证 15/15 PASS。截图矩阵同步重生成。
