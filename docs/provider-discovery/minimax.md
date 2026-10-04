# Provider Discovery — MiniMax（v0.3 已实现）

> 研究日期 2026-10-04 · 状态：**已实现**（API Key 路由）
> 端点证据来源：[BurnRate](https://github.com/ziyuan888/BurnRate)（Apache-2.0）+ OpenClaw 中文文档（usage 语义）互证。

## 1. 端点

- `GET https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains`（Bearer API Key，国内域名）
- 响应：`base_resp.status_code == 0` 成功；`model_remains[]` 每模型一条：
  - `model_name`、`current_interval_total_count`、`current_interval_usage_count`、`end_time` 等重置字段。

## 2. 坑

- **`current_interval_usage_count` 语义是「剩余」而非「已用」**（OpenClaw 文档明确 + BurnRate 以 `(total - usage_count)` 计算已用互证）——按字段名想当然必错。
- 实现见 [src-tauri/src/minimax.rs](../../src-tauri/src/minimax.rs)：每模型一个桶（labelRaw = model_name），单位为请求数。

## 3. 本机验证状态

无 MiniMax 订阅 → **未真机验证**；解析器按 BurnRate 已验证字段实现。凭据 slot：`minimax/api-key`。
