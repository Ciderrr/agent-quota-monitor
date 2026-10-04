# Provider Discovery — 豆包 / 火山方舟（Volcengine Ark）

> 研究日期 2026-10-04 · 状态：**部分可行（P2，需火山引擎 AK/SK + V4 签名）**
> 结论先行：豆包 App 订阅无 API；**火山方舟 Agent Plan 有官方套餐用量查询 API**（[dsh-volcengine-usage 插件](https://dsh.pub) 已封装）；Coding Plan 无公开余量 API；账户余额无公开接口。

## 1. 事实

| 目标 | 可行性 | 依据 |
|---|---|---|
| Agent Plan 套餐用量 | ✅ 有官方 API | dsh-volcengine-usage（DeepSeek Harness 插件）已封装；需火山引擎 IAM（AK/SK）V4 签名 |
| Coding Plan 余量 | ❌ 无公开 API | 控制台只有整体百分比（dsh.pub 插件文档明确） |
| 账户余额 | ❌ 无公开 API | 需控制台费用中心 |

## 2. 实现代价评估

- V4 签名（HMAC-SHA256 多步）需在 Rust 实现，工作量中等。
- 凭据敏感度：AK/SK 权限远大于单一 API Key（可操作整个火山账号）——需要用户明确知情。

## 3. 结论

**P2 待办**：有可抄实现（dsh-volcengine-usage），但凭据敏感 + 签名工作量使其优先级低于本轮目标。待有火山 Agent Plan 订阅的用户需求出现再启动。
