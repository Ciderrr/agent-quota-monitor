# Provider Discovery — Claude（Pro/Max 用量监控）

> 研究日期 2026-09-29 · 状态：**路线已定，待 fixture 验证轮**（ADR-006 提案）
> 结论先行：走 **claude.ai 官方页会话**（ADR-005 同款）；本地文件/代理响应头两类社区方案触碰本项目红线，不采用。

## 1. 目标数据

Claude Pro/Max 订阅的用量：**5 小时会话窗口 + 每周限额**（Anthropic 2025-07 起引入 weekly limits）。展示位置：claude.ai 网页 → 头像 → Settings → **Usage** 标签页；Claude Code CLI 的 `/usage`。

## 2. 可行路线评估

| 路线 | 判定 | 依据 |
|---|---|---|
| **官方用量 API** | ❌ 不存在 | Anthropic 未公开 Pro/Max 用量 API（社区共识，ccusage 文档亦确认） |
| **读本地 `~/.claude/projects/*.jsonl`**（ccusage / Claude-Code-Usage-Monitor / ccboard 的做法） | ❌ **违反红线** | 这些 JSONL 是**完整对话记录**文件；本项目红线「不读 prompt/代码/对话内容」。token 计数虽是元数据，但解析即接触对话文件本体，红线不破例 |
| **本地代理读响应头**（Claumon 的做法：`anthropic-ratelimit-*` 头） | ❌ 违反 Portable-first | 需要把用户的 Claude Code 流量改道本地代理 = 本机 Agent 成为数据源依赖；且改动用户网络配置，超出「仅监控」姿态 |
| **claude.ai Settings→Usage 页会话**（ADR-005 模式） | ✅ **推荐** | 页面确认存在（5h + weekly 两档）；Clean-PC：浏览器登录即可，不依赖本机装没装 Claude Code；会话只在隔离 WebView2 profile |

## 3. 下一步（验证轮，需用户参与一次）

1. 用户运行 harness（复用 mimo-console-capture 模式）：登录 claude.ai → 打开 Settings→Usage → 抓该页的网络请求（只记 URL/响应结构，脱敏后入库 `fixtures/claude-usage.redacted.json`）。
2. 确认端点（预期形如 `claude.ai/api/...usage...`，认证走会话 Cookie）与灰度情况（搜索显示 Usage 页对部分账号灰度，需确认用户账号可见）。
3. 端点确认后：ADR-006 定稿 → 预声明窗 `claude-login` → 适配器 → UI。
4. 若用户实际是 **API 用户**（console.anthropic.com 充值）：另立 discovery 轮（API 余额/用量走 Console 会话或 Admin API，与订阅用量是两套数据）。

## 4. 参考（开源实现调研）

- [ccusage](https://github.com/ryoppippi/ccusage) — 解析本地 JSONL 统计 token/费用（社区最流行；读对话文件，与我们红线冲突）
- Claude-Code-Usage-Monitor / ccboard — 同上，本地文件路线
- Claumon — Claude Code 仪表盘：rate-limit 表头实时仪表（本地代理路线）
- CodexBar — macOS 菜单栏显示 Codex+Claude 用量（读本地状态）
- 以上项目的**数据源结论一致**：Anthropic 无公开用量 API——这反过来验证我们会话路线是唯一 Clean-PC 解。

---

## v0.3 更新（2026-10-04）：日志路线实现 + 待裁定红线问题

上表曾裁定 JSONL 日志路线"违反红线、不破例"。v0.3 实现了该路线的一个**受限变体**（[src-tauri/src/claude.rs](../../src-tauri/src/claude.rs)）：

- 行级预筛（只处理含 "usage"+"timestamp" 的行）→ 仅提取数值字段（input/output/cache token 合计 + 时间戳）→ **绝不存储/显示任何 prompt 或对话内容**；
- 输出为**消耗量**（当前 5h 窗口与近 7 天 token 合计，source=derived）——官方上限未公开，不伪造剩余百分比；
- 默认**关闭**（不在默认启用集），仅当用户在设置中显式启用后才会读取本地文件。

**用户裁定（2026-10-04）：✅ 接受此变体。** 红线解释自即日起修订为：「不读对话内容 = 只解析用量数值字段（token 计数/时间戳），绝不存储、显示或上传任何 prompt 与对话文本」。claude 适配器保持可用（日志型 Local Enhancement，source=derived，诚实标注消耗量口径）。

**OAuth 路线评估（CodexBar 参照，暂缓）**：读 `~/.claude/.credentials.json` 的 oauth.accessToken 查官方 usage 端点可获得**官方剩余百分比**，但存在 refresh-token 轮换冲突先例（[CodexBar #1161](https://github.com/steipete/CodexBar/issues/1161)——第三方刷新会与 Claude Code 的刷新互踩导致登录失效）。若做必须**只读不刷新**，401 时提示用户在 Claude Code 里重新 `/login`。列为后续可选路线。
