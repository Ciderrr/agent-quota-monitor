# Provider Discovery — Kimi (Moonshot)（v0.3 已实现）

> 状态：**已实现**（双路由）
> 端点证据来源：[BurnRate](https://github.com/ziyuan888/BurnRate)（Apache-2.0，Tauri 2 + Rust 同栈，已运行时验证）+ KimiSwitch/dsh 社区工具互证。

## 1. 双路由（凭据形态自动识别）

| 路由 | 凭据 | 端点 | 数据 |
|---|---|---|---|
| API Key（充值型） | Moonshot API Key | `GET https://api.moonshot.cn/v1/users/me/balance`（Bearer） | `data.available_balance` + `currency` → 余额 |
| Coding Plan（订阅型） | kimi.com 控制台 token（JWT，点分三段） | `POST https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages`，body `{"scope":["FEATURE_CODING"]}` | `usages[].detail.limit/remaining/resetTime` → 周限额百分比 |

- 自动识别：token 含 ≥2 个 `.` 视为控制台 token（JWT），否则按 API Key。实现见 [src-tauri/src/kimi.rs](../../src-tauri/src/kimi.rs)。
- Coding 路由响应含 5 小时窗口子结构（BurnRate `extract_five_hour_window_usage`），v0.3 先实现周限额主桶，5h 子窗口待真实凭据验证后补充。

## 2. 坑与注意

- **两套额度体系互不相通**：API Key 余额 ≠ Coding Plan 用量（官方文档口径），路由按凭据形态分派而不是猜。
- Coding 路由请求头带 `Origin/Referer`（kimi.com），缺了会被网关拒（BurnRate 实测）。
- 凭据管理器 slot：`kimi/api-key`（两种凭据同槽）。

## 3. 本机验证状态

无 Kimi 订阅/API Key → **未真机验证**；解析器按 BurnRate 已验证字段实现。等用户提供凭据后走「测试连接」闭环。
