# Provider Discovery — DeepSeek API

- 证据等级标注：**[官方文档]** / **[UNVERIFIED]** / **[未找到 NONE FOUND]**
- 结论速览：**可监控性：高（五个数据源中最确定）**。存在官方、文档化的余额查询 API；响应 schema 完整验证。v1 垂直切片（Gate D）首选。

---

## 1. 官方目前的额度结构

**[官方文档]** https://api-docs.deepseek.com/api/get-user-balance（中英文同构）

DeepSeek 是按量计费 API，没有套餐窗口概念，账户数据 = **余额**：

- `is_available`：当前账户是否有余额可供 API 调用（服务端判定，勿本地复算）。
- `balance_infos[]`：`currency`（CNY / USD）、`total_balance`（总额 = 赠金 + 充值）、`granted_balance`（未过期赠金，可能随过期而下降，非消耗）、`topped_up_balance`（充值余额）。
- 消耗/用量明细**无官方 API**，仅控制台（platform.deepseek.com"用量信息"页）可见。

### 产品规格修正（Gate A.1）

**官方 Balance API 只用于余额。** 在没有官方 Usage API 的情况下：

- ❌ **禁止**把两次余额快照差值标记为 Today spend / Monthly spend / Token usage（差值受充值、赠金过期、退款等干扰，推算出的"消费"是伪数据）。
- ✅ **允许**保存并展示 **Balance history / 余额变化**（时间序列曲线/列表，如实呈现 total/granted/topped_up 随时间的变化）。
- 未来若引入用户手动导入的官方 usage 数据（控制台导出），消费统计作为**独立功能单独实现**，不与余额快照差值混用。

## 2. 官方文档证据

- 余额接口：https://api-docs.deepseek.com/api/get-user-balance 与 https://api-docs.deepseek.com/zh-cn/api/get-user-balance
- Base URL 约定：https://api-docs.deepseek.com/（OpenAI 协议 `https://api.deepseek.com`；Anthropic 协议 `https://api.deepseek.com/anthropic`）
- 错误码表：https://api-docs.deepseek.com/quick_start/error_codes
- 限流说明：https://api-docs.deepseek.com/quick_start/rate_limit（基于并发的推理限流；余额接口无限流文档）
- 完整 API 参考索引：https://api-docs.deepseek.com/api/list-models（侧边栏全集 = Chat/Completion/Models/Balance/Files，可确证无用量端点）

## 3. 可用数据源（按优先级框架）

| 优先级 | 数据源 | 状态 |
|---|---|---|
| P1 官方公开 API | `GET https://api.deepseek.com/user/balance` | ✅ **[官方文档]** 唯一且足够的官方账户数据端点 |
| P1b 官方公开 API | 用量/消费历史 API | ❌ **未找到**（完整参考索引确证）；明细仅控制台可见 |
| P2–P5 | CLI/本地状态/会话端点/页面解析 | 均不需要——官方 API 已覆盖需求；不采用控制台抓取 |

## 4. 是否需要认证

需要：`Authorization: Bearer <API_KEY>`（platform.deepseek.com/api_keys 创建的 key）。

## 5. 认证从哪里得到

用户自己的 DeepSeek API Key（用户在应用内粘贴；存储走 Windows 凭据管理器，见 SECURITY.md）。本应用绝不代登录平台控制台。

## 6. 是否可以自动发现

否（无本地状态可发现）。用户必须配置 API Key——属预期内的用户配置项，UI 需展示凭证安全提示文案。

## 7. 是否必须用户配置

是：粘贴 API Key 即完成配置；支持"测试连接"。

## 8. 数据字段映射

**[官方文档]** 响应示例（占位值）：

```json
{
  "is_available": true,
  "balance_infos": [
    {
      "currency": "CNY",
      "total_balance": "110.00",
      "granted_balance": "10.00",
      "topped_up_balance": "100.00"
    }
  ]
}
```

| 通用模型 | 来源字段 | 置信度 |
|---|---|---|
| Balance `deepseek/main`：currency=CNY/USD，total/granted/topped_up | `balance_infos[]` 同名字段 | Official |
| `available_flag` | `is_available`（false → 视为耗尽/受限状态，即使 total>0） | Official |
| 数值精度 | 字符串编码十进制（`"110.27"`），必须用 Decimal 解析，禁用 float | Official |

## 9. 查询成本

每次刷新 1 个 GET。无文档化限流；5 min 周期 ≈ 288 次/天，单用户本地工具负载可忽略。

## 10. 推荐刷新频率

- 默认 **5 min**（+ 15–60 s 抖动）
- 事件驱动加速：检测到本地 402（推理余额不足）或用户完成充值后立即刷新一次
- 429/5xx 指数退避；401 停止轮询并提示换 key

## 11. 失败模式

| HTTP | 语义 | 监控端错误态 |
|---|---|---|
| 401 | key 错误/被删 | `AuthenticationRequired`（提示重新配置） |
| 402 | 余额耗尽（推理接口） | 正常数据态：余额 0 / 不足告警，非连接错误 |
| 429 | 限流 | `RateLimited` → 退避 |
| 500/503 | 服务端故障 | `TemporarilyUnavailable` → 退避（可对照 status.deepseek.com） |
| — | 余额更新时机官方未文档化 | UI 始终带"更新于 Xm 前"时间戳，不声称实时 |

## 12. 数据可靠性

**Official（全套）**：字段、类型、语义均来自官方文档。余额新鲜度官方无承诺 → UI 按"最终一致"呈现。

## 13. 法律/服务条款风险

**低**。平台条款页面为登录后客户端渲染，未能机器分析（残留未知）；但未发现任何限制查询自身余额的条款；文档化限流仅针对推理并发。以自有 key、单用户、低频、退避友好的方式轮询属于保守使用。不抓取控制台。

## 14. 最终推荐方案

**唯一方案（也是 v1 垂直切片方案）**：轮询 `GET https://api.deepseek.com/user/balance`（Bearer key），映射为 Balance 对象 + `is_available` 状态；本地保存并展示 **Balance history / 余额变化**（时间序列，如实呈现，不做消费推算——见 §1 产品规格修正）；详情页提供 `Open Usage Page` → platform.deepseek.com。消费统计（Today/Monthly spend、Token usage）仅在引入用户手动导入的官方 usage 数据后作为独立功能实现。

## 15. 备用方案

无需备用官方方案。增强型备用：用户手动导入控制台用量导出文件做本地统计（Derived，非自动抓取）。

## 来源

- https://api-docs.deepseek.com/api/get-user-balance（EN/ZH）
- https://api-docs.deepseek.com/（Base URL）、/quick_start/error_codes、/quick_start/rate_limit、/api/list-models（参考索引）
- platform.deepseek.com/terms-of-service（客户端渲染未能读取，残留未知）
