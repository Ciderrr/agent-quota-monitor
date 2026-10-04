# Provider Discovery — Gemini CLI（Google）

> 研究日期 2026-10-04 · 状态：**可实现（日志型，P2）——本轮未实现（本机无 Gemini CLI 数据可验证）**
> 结论先行：Gemini CLI 会话数据在 `~/.gemini/tmp/<project>/chats/session-*.json`，含 usageMetadata（token 计数）；官方上限未公开，与 Claude 同样只能做「消耗量」而非剩余百分比。

## 1. 事实

- 会话存储：`~/.gemini/tmp/<project>/chats/session-*.json`（[官方讨论 #3965](https://github.com/google-gemini/gemini-cli/discussions/3965)、[社区 viewer gist](https://gist.github.com/dpavlin/28eaa39a178bca8ee27ca17d560d9458)）；JSONL 化在提案中（[#15292](https://github.com/google-gemini/gemini-cli/issues/15292)）。
- `usageMetadata`（promptTokenCount/candidatesTokenCount 等）随消息记录；`/stats` 命令显示会话 token 统计。
- 已知坑：会话文件可能包含 base64 大对象导致体积膨胀（[#24432](https://github.com/google-gemini/gemini-cli/issues/24432)）——解析需容错大文件。
- OpenTelemetry 路线（[gemistat](https://github.com/ryoppippi/gemistat)）需改 gemini-cli 启动环境变量——侵入用户配置，不采用。
- **红线对照**：与 Claude 同类问题——会话 JSON 含完整对话内容。若做，必须只提取 usageMetadata 数值字段（SQL/字段级选择），并经用户对红线的重新裁定。

## 2. 结论

日志型解析技术上与 Claude/opencode 同构（可复用解析器骨架），但①本机无数据可验证、②同样的红线裁定问题、③官方无剩余百分比。**推迟至 P2**，与 Claude OAuth 路线一并决策。
