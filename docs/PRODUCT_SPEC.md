# PRODUCT_SPEC.md — AI Agent 用量监控浮窗

> 版本 0.2（Gate B 修订：Portable-first） · 状态：Gate B 自审通过，进入 Phase 1 UI Prototype
> 最高级原则：**Account-level AI Quota Monitor，Portable-first**（见 PORTABLE_FIRST.md）——Clean PC 只装 Monitor 即可监控全部 Provider；本机 Agent 仅为 Optional Enhancement。

## 1. 一句话定位

常驻 Windows 11 桌面的轻量浮窗：**1 秒内看清每个 AI Agent / API 服务还剩多少额度、什么时候重置**，长期运行近乎无感，数据 100% 本地，账户级接入不依赖任何本机 Agent。

## 2. 要解决的问题

多 Provider（ChatGPT-plan Codex、GLM Coding Plan、小米 MiMo、DeepSeek API…）额度结构各异、查询入口分散（网页控制台、CLI、App 内），用户在深度工作流中被打断去逐个查额度，且常常"用超了才发现"。现有方案要么是网页要自己开，要么是通用监控面板（过重、过吵），没有一个"安静的、系统级的"聚合浮窗。

## 3. 目标用户

同时使用 ≥2 个 AI Coding/Agent 服务的重度个人用户（开发者为主）。v1 只做 Windows 11 + 简体中文/英文。

## 4. 核心功能范围（v1）

| 功能 | 说明 | 详见 |
|---|---|---|
| 桌面浮窗 | Collapsed/Expanded 两级、Mica 材质、可拖动、位置记忆、Desktop/置顶模式 | UI_SPEC |
| Provider 监控 | Codex / ZCode·GLM / MiMo Token Plan / DeepSeek（MiMo Desktop Membership = Deferred / Out of v1 scope） | provider-discovery/* |
| 首次连接 | Connect Codex（Sign in with ChatGPT，Managed Runtime）/ Connect ZCode（API Key）/ Connect DeepSeek（API Key）/ Connect MiMo（官方页登录，验证中） | PORTABLE_FIRST §3, ADR-004/005 |
| 统一数据模型 | 额度桶/余额/用量指标/重置机会/来源与置信度 | DATA_MODEL |
| 智能刷新 | 活动/展开感知 + 退避 + 手动冷却 | REFRESH_STRATEGY |
| 系统托盘 | Show / Refresh all / 置顶 / Settings / Quit；关窗=隐藏到托盘 | ARCHITECTURE §4 |
| Toast 通知 | 额度 <20%、<10% 两级；DeepSeek 自定义金额阈值；去重 | ARCHITECTURE core/notifications |
| 本地历史 | Today / 7 Days / 30 Days；按维度分列（Tokens/Credits/Money/Quota %），不伪造统一单位 | DATA_MODEL §3 |
| 凭证安全 | Windows 凭据管理器；Local First；强制安全提示 | SECURITY |
| i18n / 主题 | zh-CN + en；Auto/Light/Dark | UI_SPEC §4/§10 |
| 官方页直达 | 每 Provider "Open Usage Page"（系统浏览器） | ARCHITECTURE §4 |

## 5. 明确不做（Non-goals）

- 不做云后端/账号/同步/遥测（Local First 红线）。
- 不自动消费 Reset、不自动购买、不修改 Provider 账号（Reset 仅显示 ×N）。
- 不读取 prompt/代码/对话内容；不做屏幕监控；活动检测只输出 active/idle 且不落库。
- 不发送无意义 LLM 请求估算余额（明确禁止行为）。
- 不做数据源不可靠时的"硬抓"：显示"暂不支持"优于抓取（稳定可信 > 什么都能抓）。
- v1 不做 macOS/Linux、不做多显示器精细优化（数据结构预留）。

## 6. v1 Provider Scope（Portable-first 正式版，全文效力高于旧表述）

| Provider | Target | Connection | Local Agent Required | 状态 |
|---|---|---|---|---|
| Codex | Full quota monitoring（5h/weekly/动态附加桶/Reset ×N/credits.balance） | Sign in with ChatGPT（Managed Codex Runtime，ADR-004；API key 备选） | **No** | Ready（通道已实测） |
| ZCode / GLM Coding Plan | Full quota monitoring | Coding Plan API Key（用户粘贴） | **No** | Ready（字段级结构待有效 key 验证） |
| DeepSeek | Balance monitoring（余额 + 余额变化历史；不做消费推算） | API Key | **No** | Ready |
| Xiaomi MiMo Token Plan | Monthly Token Plan quota percentage | MiMo account session（专用 WebView2，官方页登录，ADR-005） | **No** | **Pending Round 2 verification**（数据源已定位：/api/v1/tokenPlan/usage + /detail） |
| Xiaomi MiMo Desktop Membership | — | — | — | **OUT OF V1 SCOPE（Deferred）**：不入 Registry、不入 UI Prototype；文档归档 |

Provider 状态（Connected/NotConnected/AuthRequired/Unavailable/Unsupported）与本机安装状态（Installed/NotInstalled/Running/NotRunning）是**两个独立维度**（PORTABLE_FIRST §4）。

## 7. 成功标准

1. 折叠态 1 秒内判断"谁快没额度"（用户测试）。
2. Idle CPU ≈ 0%、长期驻留内存 ≤120 MB（实测，docs/performance.md）。
3. 全程零云端依赖；凭证零明文（代码审计可验证）。
4. UI 通过 UI_SPEC §12 全清单；"像系统级 Widget"通过用户主观验收（Gate C）。
5. 新增一个 Provider（如 Claude Code）不需要改动任何既有 Provider/UI/History/通知代码。

## 8. 风险与对策（摘要）

| 风险 | 对策 |
|---|---|
| Provider 接口/字段漂移（尤其未文档化端点） | Discovery 文档登记证据与版本；`ProviderChanged` 错误态；未知字段透传不崩溃 |
| Codex/网页类通道被风控 | 官方 CLI 同源请求形态 + 低频退避；MiMo 类脆弱源默认关闭 |
| 凭证安全事件 | 凭据管理器 + 双层 redaction + CI 扫描（SECURITY §7） |
| UI 达不到"Apple 级"标准 | Gate C 专职评审 + Mock 数据先行（UI_SPEC §9） |
| Tauri/WebView2 平台坑 | ADR-001 已列缓解；Phase 1 第一周 spike 验证 Mica/托盘/置顶 |

## 9. 里程碑

Phase 0（本文档）→ Gate A/B 评审 → Phase 1 UI 原型（Gate C）→ Phase 2 DeepSeek 垂直切片（Gate D）→ Phase 3 其余 Provider（Gate E）→ Phase 4 性能/安全/发布审计（Gate F）。详见 .agent/IMPLEMENTATION_PLAN.md（开发过程归档）。
