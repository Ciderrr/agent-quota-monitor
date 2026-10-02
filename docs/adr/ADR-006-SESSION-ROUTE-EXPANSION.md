# ADR-006 — 会话路线扩展（Claude / WorkBuddy / OpenCode Go）

> 状态：**WorkBuddy 已 Accepted 并实装**（fixture 2026-09-30，端点/结构实测）；Claude、OpenCode Go 维持 Proposed（用户暂无订阅，搁置）
> 日期：2026-09-29（2026-09-30 更新）
> 关联：ADR-005（MiMo Console Session，本 ADR 的模式母本）、PORTABLE_FIRST §1/§3

## 背景

用户希望扩展监控范围：腾讯 WorkBuddy（Credits 计费）、Claude Pro/Max（5h+weekly 用量）、OpenCode Go（订阅用量）。调研结论（docs/provider-discovery/{claude,workbuddy,opencode-go}.md）：

- 三家均**无公开用量/余额 API**；
- 社区开源监控（ccusage、Claumon 等）的本地文件/本地代理路线均触碰本项目红线（读对话文件 / 依赖本机 Agent）；
- 三家的**官方网页/客户端均有用量展示**，证明官方后端存在可读接口。

## 决策（提案）

沿用 ADR-005 会话路线模板，为三家各建一个**预声明登录窗 + 隔离 WebView2 profile + 同源 fetch**：

| Provider | 登录页 | 数据形态（预期） | 桶映射 |
|---|---|---|---|
| claude | claude.ai（Settings→Usage） | 5h 窗口 + weekly 百分比 | rolling{300} / weekly |
| workbuddy | 官方桌面/网页积分页（入口待用户确认） | Credits 余额 + 按模型用量 | balances（Credits）+ 动态桶 |
| opencode-go | opencode.ai/auth 控制台 | 每模型 5h/周/月 美元额度 | rolling{300}/weekly/monthly（金额制） |

## 执行前提（每家独立）

1. **fixture 验证轮**：用户参与式 harness 抓目标页面网络请求 → `fixtures/<provider>.redacted.json`；opencode 可辅以开源控制台前端源码定位端点。
2. 端点确认后本 ADR 对应小节转 Accepted，再动 Provider Registry / UI / 适配器。
3. 注册上限策略：主界面同时可见 ≤4 个 Provider（用户要求），新增用现有显隐开关取舍。

## 红线对照（重申）

- 会话 Cookie 只存在于各家隔离 WebView2 profile，不落库、不进日志、不进 React 层；
- 仅 https + 白名单域名（claude.ai / workbuddy 域 / opencode.ai，待 harness 确认确切主机后写入 http 白名单）；
- 低频保守刷新（undocumented_first_party 同级：10–15 min 基线），退避与抖动沿用 REFRESH_STRATEGY；
- 不读对话/文档/代码内容——只取数值与周期。

## 备选与不采纳项

- ccusage 类本地 JSONL 解析：违反「不读对话」红线，否决；
- 本地代理读响应头（Claumon 类）：使本机 Agent 成为数据源依赖 + 改动用户流量，违反 Portable-first，否决；
- 读第三方客户端本地凭证直接调接口：默认否决；仅当 harness 证明凭证形态稳定且用户明示同意时，按 ZCode「用户粘贴 Key」模式重评。

## 后果

- 正面：三家新数据源全部满足 Clean-PC；复用 mimo-login 的窗口/回传/适配器骨架，边际成本低；quotaBuckets 动态模型无需变更。
- 负面/风险：私有接口可能变更（endpoint_stability=undocumented_first_party，退化时如实显示）；三家灰度/入口不同（Claude Usage 页有灰度、WorkBuddy 入口待确认、opencode 需订阅）；风控敏感（低频 + 官方同源端点缓解）。
