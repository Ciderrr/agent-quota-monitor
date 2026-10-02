# Provider Discovery — Xiaomi MiMo Token Plan

- 研究日期：2026-09-28（v1 策略修订：Gate A.1，2026-09-28）
- 证据等级标注：**[官方文档]** / **[本机已验证]** / **[社区]** / **[UNVERIFIED]** / **[未找到 NONE FOUND]**
- 结论速览：**可监控性：中低 → v1 定位为"静态套餐信息 + 手动额度"**。不存在官方额度查询 API；按 Gate A.1 决策，**v1 不做任何会话/端点/抓取类自动读取**，默认显示"暂不支持自动额度监控"，提供官方页直达与可选的手动输入（Manual/Estimated）。SPA endpoint 调研移入未来独立的 MiMo Provider Research，不阻塞 v1。

---

## 1. 官方目前的额度结构

**[官方文档]** https://mimo.mi.com/static/docs/price/token-plan.md 等（访问 2026-09-28）

- MiMo Token Plan：面向 AI 编程场景的订阅，通过**专属 API Key**（个人 `tp-xxxxx` / 团队 `ttp-xxxxx`，与按量 `sk-xxxxx` 不通用）在 MiMo Desktop、MiMo Code、Claude Code、Codex、Cline 等工具中调用 MiMo 模型。
- 个人档位（月 Credits 池）：**Lite ¥39/$6 — 4.1B；Standard ¥99/$16 — 11B；Pro ¥329/$50 — 38B；Max ¥659/$100 — 82B**；年付 = 12 个月额度 ×88 折（Lite 49.2B ～ Max 984B）。
- 按模型计费（每 token 折 Credits，文档完整给出）：如 mimo-v2.6-pro 命中缓存输入 2.5 / 未命中输入 300 / 输出 600；flash 为 2/100/200。非高峰（00:00–08:00 北京时间）0.8×。
- **无 5 小时/周窗口**（官方明确区别于 Claude 类产品）；月度周期口径。额度耗尽服务暂停，不滚动到赠送积分或现金余额。
- 官方 FAQ 明确：**Token Plan 与 MiMo Desktop Membership 是两个独立订阅**，权益、定价、额度互不相通。

## 2. 官方文档证据

- 定价：https://mimo.mi.com/static/docs/price/token-plan.md
- 订阅与密钥：https://mimo.mi.com/static/docs/tokenplan/Token%20Plan/subscription.md
- 用量与额度 FAQ：https://mimo.mi.com/static/docs/quick-start/faq/token-plan/Usage%26Quota.md
- 与 Desktop Membership 区别：https://mimo.mi.com/static/docs/quick-start/faq/token-plan/desktop-guide.md
- 官方控制台（额度查看入口）：https://platform.xiaomimimo.com/#/console/plan-manage（进度条）；用量明细/导出：`#/console/usage`
- 文档总索引：https://mimo.mi.com/llms.txt 与 /llms-full.txt

## 3. 可用数据源（按优先级框架 + v1 可用性裁定）

| 优先级 | 数据源 | 状态 | v1 裁定 |
|---|---|---|---|
| P1 官方公开 API | 额度/余额查询 REST API | ❌ **未找到**（API 参考仅含 Chat/Audio/Models/限流/错误码） | 不可用 |
| P2 官方 CLI 本地信息 | 不适用（Token Plan 是 key 而非客户端） | — | 不可用 |
| P3 官方客户端本地状态 | 不适用 | — | 不可用 |
| P4 Web 会话端点 | 控制台 SPA 内部 API（bundle 中见 `/api/v1` + `tokenPlan/usage` 等碎片） | ⚠️ **[UNVERIFIED]**，未验证 | **v1 不实现**（移入未来独立调研） |
| P5 页面解析 | `#/console/plan-manage` 进度条 DOM | ⚠️ 可行但脆弱 | **v1 不实现** |
| — | 用户手动输入剩余比例/用量 | 本地数据 | **v1 可选支持（Manual/Estimated）** |

## 4. 是否需要认证

自动监控：v1 无（不做会话类读取）。手动输入：无认证需求。

## 5. 认证从哪里得到

v1：不需要。（历史调研记录：控制台额度读取依赖小米账号 Web 会话 Cookie，无公开 OAuth/token 流程——该路径已按 Gate A.1 移出 v1。）

## 6. 是否可以自动发现

**不可以**。无本地额度凭证、无本地 API。本机可检测 MiMo Desktop 安装状态（见 mimo-desktop.md），但那属于另一个数据源，与 Token Plan 额度无关。

## 7. 是否必须用户配置

v1 可选配置项：档位选择（Lite/Standard/Pro/Max，决定显示的总额度常量）+ 可选的"当前剩余比例或已用量"手动输入。完全不配置时该 Provider 显示为"暂不支持自动额度监控"状态（不是隐藏）。

## 8. 数据字段映射（v1 形态）

| 通用模型 | 来源 | 置信度 |
|---|---|---|
| QuotaBucket `mimo-token-plan/monthly-credits`，unit=Credits | 档位常量（4.1B/11B/38B/82B，官方文档） | **Official**（total）；used/remaining 仅在用户手动输入时存在 → **Manual/Estimated** |
| periodType | `monthly` | Official（文档口径） |
| label | 档位原名（Lite/Standard/Pro/Max，不翻译） | Official |
| 自动剩余额度 | 无数据源 | 显示 `暂不支持自动额度监控 / Usage monitoring unavailable` |

规则：手动输入值必须标记 `Manual / Estimated`；整数显示（不给小数）；续期日可选填写用于"下次重置"展示（Estimated）。

## 9. 查询成本

零网络请求（纯静态 + 本地手动数据）。

## 10. 推荐刷新频率

不调度网络刷新。手动输入变更即时生效；续期日到期的本地计算每日一次即可。

## 11. 失败模式

- 手动数据过期：显示"手动录入于 X 天前"提醒，避免用户误当实时数据。
- 档位/价格变更（产品上市仅数周，迭代快）：以官方文档为准，随版本更新常量。
- 用户把"暂不支持自动额度监控"误解为错误：文案需中性、附 `Open Usage Page` 引导。

## 12. 数据可靠性

- 套餐结构/总额度/档位名：**Official**（官方文档）。
- 剩余额度：**无**（或 Manual/Estimated）——绝不伪装成自动获取的 Official 数据。

## 13. 法律/服务条款风险

**v1 形态下几乎为零**：不访问任何小米服务、不持有会话、不消耗任何额度。官方订阅条款中对"自动化脚本"的限制针对推理调用，v1 完全不涉及。

## 14. 最终推荐方案（Gate A.1 修订版）

**v1 落地形态**：
1. 默认状态：卡片显示"暂不支持自动额度监控 / Usage monitoring unavailable" + `Open Usage Page`（直达 `platform.xiaomimimo.com/#/console/plan-manage`）。
2. 可选配置：档位选择（显示 Official 的总额度与档位名）+ 可选手动输入剩余比例或已用量（Manual/Estimated，整数）。
3. **明确禁止（v1 红线）**：自动导入浏览器 Cookie、自动读取小米 SSO session、轮询 SPA 私有 endpoint、DOM scraping、用 `tp-` key 发推理请求试探额度。
4. SPA endpoint 调研（`/api/v1/tokenPlan/usage` 碎片验证）→ **未来独立的 MiMo Provider Research 任务**，不阻塞 v1，不进入 Phase 1–3 主线。

## 15. 备用方案

- 无自动备用方案（数据源不存在是事实，不是实现问题）。
- 引导有程序化查询需求的用户关注官方控制台用量导出（`#/console/usage`）功能；若官方未来开放额度查询 API，按新 Discovery 评估。

## 附：运行时验证清单（未来 MiMo Provider Research，非 v1）

1. `/api/v1/tokenPlan/usage` 等碎片端点的真实方法/参数/响应。
2. 年付池进度条语义（月度折算还是年池直读）。
3. 赠送积分是否单独展示。
4. 用户协议反自动化条款确认。
5. 小米 SSO 会话有效期。

## 来源

官方：mimo.mi.com（上列文档 URL）、platform.xiaomimimo.com 控制台公开资源（2026-09-28 访问）。
本机：`%APPDATA%\Xiaomi MiMo`（Electron 应用安装证据）。
