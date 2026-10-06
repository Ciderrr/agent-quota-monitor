# Provider Discovery — opencode CLI（v0.3 已实现）

> 状态：**已实现（DB 型 Local Enhancement Layer）**
> 注意：本文是 **opencode CLI 本地数据**接入；此前调研的「opencode Go 订阅」（opencode-go.md）是另一回事（订阅路线，仍搁置）。

## 1. 数据源（本机实测确认）

- SQLite：`~/.local/share/opencode/opencode.db`（新版本；旧版本为 storage/ 目录 JSON——检测到 DB 时优先用 DB）。
- `session` 表直接携带聚合列：`tokens_input / tokens_output / tokens_reasoning / tokens_cache_read / tokens_cache_write / cost / model / time_created / time_updated`（epoch 毫秒整数）。
- 本机样本：tokens 列为整数、cost 为实数、model 为 JSON 字符串。

## 2. 红线对照（本适配器的安全设计）

- SQL **列级选择**：只 SELECT 数值列（tokens/cost/时间），结构上不可能触达标题、prompt、对话内容（message/part 表根本不查）。
- 绝不触碰 `account` / `credential` 表（opencode 自身的登录凭据）。
- 只读打开（`SQLITE_OPEN_READ_ONLY`），失败安静降级。

## 3. 输出

- 日 token（今日/7 天，in+out+reasoning 合计）——官方无剩余上限概念（配额由各模型供应商决定），**只展示消耗量**。
- 7 天无用量 → not_configured；24h 无活动 → stale。
- 实现见 [src-tauri/src/opencode.rs](../../src-tauri/src/opencode.rs)。

## 4. 本机验证状态

✅ 本机有真实 opencode.db（schema + 样本已核），适配器按真实 schema 实现；待用户使用 opencode 产生新数据后即可看到非零用量。
