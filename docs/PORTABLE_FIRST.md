# PORTABLE_FIRST.md — Portable-first Provider Architecture（最高级产品原则）

> 版本 1.0 · 取代此前"依赖本机 Agent"的隐含假设
> 一句话：本产品是 **Account-level AI Quota Monitor**，不是 **Local Agent Companion**。

---

## 1. 核心原则

一台**全新的 Windows 11 PC**：没有 ChatGPT Desktop、没有 Codex CLI、没有 ZCode、没有 MiMo Desktop、没有任何 Agent 本地配置文件——用户只安装 Agent Quota Monitor，就应当能通过 **Browser login / OAuth / API Key / 官方 Account Session** 恢复全部 Provider 监控能力。

**本机 Agent 只能作为 Optional Enhancement**（进程检测、已有登录发现、已有配置发现、本地 usage 库、activity detection、Smart Refresh 优化）。这些能力只提高体验，**不得决定 Provider 能否基本使用**。任何 `if (!agentInstalled) → unsupported` 的逻辑都是架构违规。

## 2. 双层架构

```
┌────────────────────────────────────────────────────────┐
│ Remote Account Layer（核心，决定可用性）                  │
│  Browser OAuth · API Key · Account Session ·           │
│  Official API · Provider-controlled managed runtime    │
├────────────────────────────────────────────────────────┤
│ Local Enhancement Layer（可选，只提升体验）               │
│  Existing agent detection · existing login reuse ·     │
│  process activity · local history · local usage db     │
└────────────────────────────────────────────────────────┘
            两层统一输出 → ProviderSnapshot
```

实现映射：`PROVIDER_INTERFACE.md` 中每个 Provider 声明 `connectionMethods[]`（Remote 层怎么连）与 `localEnhancements[]`（Local 层有什么增强），两者严格分离，不得混写。

## 3. Clean-PC Acceptance Test（产品级验收）

| Provider | Clean PC 连接方式 | 本地 Agent 要求 |
|---|---|---|
| Codex | Connect Codex → **Sign in with ChatGPT**（Managed Codex Runtime + `account/login/start`，见 ADR-004） | 无 |
| ZCode / GLM | 粘贴 **Coding Plan API Key** → Test connection → 安全保存 | 无 |
| DeepSeek | 粘贴 **API Key** → 官方 Balance API | 无 |
| MiMo Token Plan | **MiMo Account / Console authentication**（专用 WebView2 官方页登录，ADR-005） | 无 |

验收红线：用户不应被告知"请先安装 Codex CLI / ZCode / MiMo Desktop"。

## 4. Provider 状态 ≠ 安装状态（两个独立维度）

| Provider 状态（账户维度） | Local Agent 状态（本机维度） |
|---|---|
| Connected / NotConnected / AuthRequired / Unavailable / Unsupported | Installed / NotInstalled / Running / NotRunning |

示例（合法且正常）：Codex 账户 **Connected**，本机 Codex **Not installed**，监控照常。UI 与数据模型都不得把安装状态混入连接状态。

## 5. v1 Provider Scope（正式）

| Provider | Target | Connection | Local Agent Required | 状态 |
|---|---|---|---|---|
| Codex | Full quota monitoring | Sign in with ChatGPT（+ API key 备选） | **No** | Ready（ADR-004） |
| ZCode / GLM Coding Plan | Full quota monitoring | Coding Plan API Key | **No** | Ready（key 需用户提供） |
| DeepSeek | Balance monitoring（余额 + 余额变化历史） | API Key | **No** | Ready |
| MiMo Token Plan | Monthly Token Plan quota percentage | MiMo account session（WebView2） | **No** | **Pending Round 2 verification**（数据源已定位，登录态 fixture 待采集） |
| MiMo Desktop Membership | — | — | — | **OUT OF V1 SCOPE（Deferred）**：不出现在 v1 Provider Registry、默认 UI 与 UI Prototype；Discovery 文档保留为 archived research（docs/provider-discovery/mimo-desktop.md） |

## 6. Smart Refresh 与本地 Agent 的关系

基准间隔（Collapsed 5 min / Expanded 60 s / Manual immediate+cooldown）**完全不依赖本地 Agent**；检测到本地 Agent 活跃时可临时提升到 45 s。即：

> Process detection = Refresh optimization，**绝不是** Data source requirement。

## 7. Gate B Self-Audit（修订后自查结果）

| 检查项 | 结论 |
|---|---|
| **Portable**：不存在 `!installed → unsupported` 逻辑 | ✅ 已清除：Codex 走 Managed Runtime（ADR-004），ZCode 走用户粘贴 key，MiMo 走 Console 会话（ADR-005），DeepSeek 走 API Key；本机检测全部降级为 `localEnhancements[]`。MiMo Desktop 从 Registry/UI 移除（其唯一依赖本机的形态本就不满足 Portable-first） |
| **Secrets**：React 前端无法读取 API key / OAuth token / Cookie / session token | ✅ 架构面：凭证输入经 PlatformBridge 直通 native（Keyring / WebView2 隔离 profile），React 状态中不保留凭证值；`ProviderSnapshot` 不含凭证字段；MiMo 会话仅存在于 native 层 profile |
| **Dynamic Quota**：无 Provider-specific 固定字段 | ✅ 复查 DATA_MODEL：不存在 `five_hour_remaining` / `weekly_remaining` / `monthly_remaining` 等字段；一切额度都是动态 `quotaBuckets[]`（periodType 开放枚举 + Custom(raw)）；Codex 新发现的 `base_model_inference` 桶无需改模型即可表达 |
| **Provider Isolation**：Provider URL / 认证逻辑不进入 React Component | ✅ UI 源码中禁止出现任何 Provider 域名、路径、鉴权细节（PROVIDER_INTERFACE §4 契约 + CI grep 断言列入 .agent/IMPLEMENTATION_PLAN）；UI 只消费 `list_providers` 元数据与快照 |

## 8. 对既有文档的效力

本文档优先级高于 ARCHITECTURE.md / PROVIDER_INTERFACE.md / PRODUCT_SPEC.md 中与此冲突的旧表述；各文档已在 Gate B 修订轮同步（变更清单见 .agent/CHANGELOG_GATE_B.md）。
