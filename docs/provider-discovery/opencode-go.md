# Provider Discovery — OpenCode Go（订阅用量）

> 研究日期 2026-09-29 · 状态：**数据维度已明确，端点待 fixture 验证轮**（ADR-006 提案）
> 结论先行：Go 是订阅制（非按量），用量=每模型「5h/周/月」三档美元额度；官方文档**无用量查询 API**，控制台网页可查 → 会话路线（ADR-006）。

## 1. 产品事实（[opencode.ai/zh/go](https://opencode.ai/zh/go)）

- **OpenCode Go / Go Plus**：$10/$40 每月的代理编程订阅；另有 **Zen**（按请求付费充值，余额可低于 $5 自动充 $20）。
- Go 用量限制（官方文档 `/docs/zh-cn/go/`）：**每个模型**按月度美元额度计——
  - 5 小时滚动窗口 = 月额度的 **20%**
  - 每周 = **50%**
  - 每月 = **100%**
  - 例：Kimi K3 档 $15/$60；部分模型 ∞ 免费。
- 查看位置：控制台 [opencode.ai/auth](https://opencode.ai/auth)（登录后跟踪当前用量）；超限后可启用 Zen 余额兜底。
- API 面（文档公开的）：仅**推理端点**（`opencode.ai/zen/go/v1/...`、`zen/v1/models`，Bearer API key）——是"用模型"的接口，**不是查额度的接口**。

## 2. 可行路线评估

| 路线 | 判定 | 说明 |
|---|---|---|
| 官方用量/余额 API | ❌ 文档未提供 | Zen/Go 文档均无 usage/balance 端点；推理端点不返回额度 |
| 读 opencode 客户端本地凭证调内部接口 | ⚠️ 不优先 | opencode 客户端开源（github.com/anomalyco/opencode），本地有 auth 状态；但读第三方 Agent 凭证文件与我们对待 ZCode 的结论一致（证伪/不采）——除非 harness 证明有稳定额度接口 + 用户同意 |
| **harness 抓控制台（opencode.ai/auth → 用量页）** | ✅ 推荐 | 会话 Cookie 同源 fetch；端点确认后走 ADR-006 隔离 WebView2 会话路线 |
| 数据模型匹配度 | ✅ 好 | 「5h/weekly/monthly」三档直接映射我们现有 `quotaBuckets[]`（rolling 300 / weekly / monthly），无需改模型；金额单位（USD 额度）→ bucket unit 可用 `money` 或 percent+total |

## 3. 生态旁证

- 监控同类项目已有 [feature request：把 OpenCode Zen 余额作为 provider](https://github.com)（GitHub issue，open）——需求存在、公开 API 缺位是行业现状，与我们调研一致。
- opencode 客户端本身开源（208K stars），其控制台前端的用量请求可在验证轮一并确认（读源码找 console 调用的 API 路径是合法捷径，不用抓包也能初步定位端点——下一轮做）。

## 4. 下一步（验证轮，需用户确认）

1. 用户是否已有 Go/Go Plus 订阅（无订阅则与 ZCode 一样挂起）。
2. harness：登录 opencode.ai → 控制台用量页抓请求 → `fixtures/opencode-go-usage.redacted.json`；同时对照开源仓库 console 前端源码定位端点。
3. 端点确认 → ADR-006 定稿 → 实装（沿用现有动态桶模型，预计改动最小）。
