# Provider Discovery — ZCode / GLM Coding Plan

- 研究日期：2026-09-28（Gate A.1 运行时验证：2026-09-28，本机实测）
- 证据等级标注：**[官方文档]** / **[官方代码]**（Z.ai 官方开源插件）/ **[运行时已验证]**（本机真实请求/响应）/ **[本机已验证]**（文件级证据）/ **[社区]** / **[UNVERIFIED]**
- 结论速览：**可监控性：高，但凭证路径反转**。接口本身可用（两区域主机实测可达、信封结构确认）；**ZCode 本机 `credentials.json` 中存储的凭证不能直接用于该接口**（实测 401）→ v1 需用户粘贴控制台签发的 Coding Plan API Key。`limits[]` 字段级结构未观察到 → 未知 type/unit 一律 `PeriodType::Custom(raw)`，不猜测。

---

## 1. 官方目前的额度结构

**[官方文档]** https://docs.z.ai/devpack/overview.md 与 https://docs.bigmodel.cn/cn/coding-plan/overview.md（镜像，访问 2026-09-28）

- 套餐 Lite / Pro / Max；双池积分制：5 小时池（Lite 2,000 / Pro 12,000 / Max 28,000，消耗后 5 小时滚动重置）+ 周池（10,000 / 60,000 / 140,000，自订阅日起 7 天）。
- 积分公式与模型系数文档完整（GLM-5.3：input 6.9 / cached 1.7 / output 24，÷10000）；MCP 调用按次数 × 输出系数 1.2 计入积分池（当前文档口径）。
- 非高峰（周一至五 14:00–18:00 UTC+8 外）积分 5 折。
- **注意**：以上是文档口径；monitor 接口返回的是百分比/剩余值 + `level`，字段级结构 **[UNVERIFIED]**（见 §8）。

## 2. 官方文档证据

- `docs.z.ai/devpack/*`、`docs.bigmodel.cn/cn/coding-plan/*`
- **官方用量查询插件**：https://github.com/zai-org/zai-coding-plugins → `plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs`（接口与鉴权方式的第一手官方代码）
- ZCode 客户端 app.asar 内含同一接口字符串 **[本机已验证]**
- **本机运行时验证**：两区域主机均实测可达，信封结构确认（见 fixtures）

## 3. 可用数据源（按优先级框架）

| 优先级 | 数据源 | 状态 |
|---|---|---|
| P1 官方公开 API | `GET /api/monitor/usage/quota/limit` | ✅ **接口运行时已验证可达**（api.z.ai 与 open.bigmodel.cn 均返回真实信封）；但**本机凭证形态不被接受**（实测 401，见 §5） |
| P1b 配套明细 API | `…/api/monitor/usage/model-usage`、`…/tool-usage` | **[官方代码]** 存在；schema **[UNVERIFIED]**；v1 不依赖 |
| P2 官方客户端本地信息 | `zcode.z.ai/api/v1/zcode-plan/billing/*`（OAuth JWT 通道） | **[本机已验证]** 客户端在用；但 monitor 验证表明本地 OAuth token 也不被 monitor 接受（见 §5），此通道留作未来调研 |
| P3 官方客户端本地状态 | `~/.zcode/cli/db/db.sqlite`（本机消耗记录）、`coding-plan-cache.json` | **[本机已验证]**；仅本机口径，备用/History 用 |
| P4 Web 会话端点 | 控制台用量页 | 社区反馈反爬问题 → 不采用 |
| P5 页面解析 | 同上 | 不采用 |

## 4. 是否需要认证

需要。鉴权方式 **[官方代码]**：`Authorization: <裸 API Key>`（无 `Bearer ` 前缀）——官方插件原样发送 authToken；社区工具一致佐证；社区另有"加 Bearer 得到空 200"的报告。
**运行时注记（Gate A.1）**：本次实测中 raw 与 Bearer 得到完全相同的 401，无法凭响应区分两者——因为没有任何凭证被接受。裸 key 结论保持"官方代码 + 社区"证据等级，**待用户持控制台签发的 key 后运行时确认**。

## 5. 认证从哪里得到（Gate A.1 实测结论：路径反转）

**实测结果**（fixtures/zcode-quota-limit.redacted.json、fixtures/zcode-quota-limit-oauth.redacted.json）：

| 凭证（全部来自本机 credentials.json） | 形态 | 结果 |
|---|---|---|
| `account-provider:coding-plan:account:*:api-key`（3 条：bigmodel-team / zai-team / bigmodel-individual） | 113 字符复合串（含 `: . - _`） | **HTTP 200 + `code:401`"令牌已过期或验证不正确 / token expired or incorrect"**（raw 与 Bearer 相同） |
| `oauth:bigmodel:access_token` | 509 字符非 JWT 串 | **HTTP 200 + `code:401`**（raw 与 Bearer 相同） |

解读：这些是 ZCode 内部使用的凭证形态（当前 ZCode 会话正以它们正常工作，"过期"可能性低）——**它们不是 monitor 接口接受的控制台 API Key**。区域映射本身已确认（bigmodel 主机返回中文错误、z.ai 主机返回英文错误，信封一致）。

**v1 认证设计**：
- 主路径：用户在 Settings 中粘贴**控制台签发的 Coding Plan API Key**（z.ai / bigmodel 控制台 API Keys 页），输入前展示强制安全提示文案；key 族决定主机（`zai→api.z.ai`、`bigmodel→open.bigmodel.cn`）。
- 自动发现：仅用 credentials.json 判定"用户是 ZCode/GLM 用户"（引导提示），**不再声称能自动取到可用 key**。
- 禁止：读取 `oauth:*` / `zcodejwttoken` 值用于 monitor 接口（实测无效且增大凭证接触面）；文档中原"从 credentials.json 自动发现可用 key"的表述作废。

## 6. 是否可以自动发现

部分：可自动发现"已安装 ZCode 且存有 coding-plan 账户"（credentials.json 键名层）**[本机已验证]**；但**可用凭证本身不可自动获取**（运行时实测），需要用户粘贴。

## 7. 是否必须用户配置

是（v1 变更）：粘贴 Coding Plan API Key；或选择跳过（显示未配置）。

## 8. 数据字段映射

**接口信封（运行时已验证）**：HTTP 200 + `{"code":401,"msg":"…","success":false}`——**必须检查 body 的 code/success，绝不能只看 HTTP 状态码**。成功信封预期为 `{"code":0,"data":{...},"success":true}`（据官方插件/客户端代码），但 `data` 内字段级结构**未实测观察到**（无有效 key）。

官方代码与社区工具描述的 `data` 预期结构（**全部降级为 UNVERIFIED 映射假设**）：`level`(lite/pro/max) + `limits[]{type, unit, number, percentage, nextResetTime(epoch ms), usage, currentValue, remaining, usageDetails[]{modelCode, usage}}`；桶匹配假设：`TOKENS_LIMIT+unit3→5h`、`TOKENS_LIMIT+unit6→weekly`、`TIME_LIMIT+unit5→MCP 月窗口`。

**v1 映射规则（按 Gate A.1 指令，不猜测）**：

1. 每个能解析出的 `limits[]` 条目 → 一个 QuotaBucket。
2. **`periodType` 仅当 type/unit 语义得到运行时确认后才映射到 Rolling/Weekly/Monthly**；在此之前一律 `PeriodType::Custom{ raw: "<type>#unit<unit>" }`。
3. **UI label 优先使用服务端返回的 label 字段（若存在）；否则用通用额度标签（"额度"/"Quota"），绝不显示猜测出的"5 小时/每周"字样**。
4. `percentage`/`remaining`/`nextResetTime` 等数值字段按实际存在渲染（Official）；`remaining_percent = 100 − percentage` 为 Derived。
5. 未知/缺失字段 → None → UI 显示"暂无数据"，不显示 0%。
6. unit/percentage 等数值语义确认后（用户提供真实 key 的验证轮），再把确认的桶升级为标准枚举映射。

## 9. 查询成本

每次刷新 1 个 GET。极低。

## 10. 推荐刷新频率

- 活跃 / 展开：45–60 s；折叠空闲：5 min；下限 30 s
- HTTP 200 但 body `code!=0` → 按失败退避（30s→1→2→5→10min），`code:401` → `AuthenticationRequired` 停止轮询等用户处理

## 11. 失败模式

1. **HTTP 200 + body `code:401`**（运行时实测复现）——必须按 body 判错，不能按 HTTP 状态码。
2. 凭证形态错误（ZCode 内部凭证 ≠ 控制台 API Key）——运行时实测复现；错误提示应引导用户取控制台 key 而非"重新登录 ZCode"。
3. `Bearer` 前缀可能致空 body（社区报告）——实现按官方插件用裸 key。
4. 区域/账户错配（z.ai key 打 bigmodel 主机或反之）——按 key 族硬绑定主机。
5. `limits[]` 字段漂移 / `level` 缺失 → 未知字段进 Custom、缺字段显示暂无数据。
6. 本地 `coding-plan-cache.json` 与服务端状态滞后（本机观察到）。

## 12. 数据可靠性

- 接口存在性、可达性、信封结构、区域划分：**Official（运行时已验证）**。
- 鉴权细节（裸 key）：**Official 代码 + 社区**，运行时待确认。
- `limits[]` 字段级结构与 type/unit 语义：**UNVERIFIED** → v1 按 §8 规则以 Custom/通用标签渲染，确认前不标注 Official 语义。

## 13. 法律/服务条款风险

**低**：Z.ai 官方插件与 ZCode 客户端均在用该接口，官方先例充分。用量政策限制的是共享/转售/中转/套利等代理行为，本地低频只读轮询不触及；凭证不得跨机器/跨用户共享。

## 14. 最终推荐方案（Gate A.1 修订版）

1. Settings：用户粘贴控制台签发的 Coding Plan API Key（安全提示前置）+ 选择账户族（z.ai 国际 / bigmodel 国内，默认按 ZCode 本机账户族预选）。
2. `GET {base}/api/monitor/usage/quota/limit`，`Authorization: <裸 key>`；15 s 超时。
3. 响应处理：`code!=0` → 错误态；`code==0` → 按 §8 规则渲染（Custom(raw) + 服务端/通用 label）。
4. Gate E 前（用户提供真实 key 后）补一轮运行时验证：确认 `limits[]` 全字段与 type/unit 语义，把验证通过的桶升级为标准枚举 + Official 语义。

## 15. 备用方案

- **备 A（零网络，Estimated）**：读 `~/.zcode/cli/db/db.sqlite` 本机消耗记录，按文档积分系数近似池消耗；标注 Estimated/本机口径。
- **备 B（未来调研）**：`zcode.z.ai/api/v1/zcode-plan/billing/*` OAuth 通道——本次实测证明本地 OAuth token 不被 monitor 接口接受，该通道需独立调研（不同主机/不同鉴权头），v1 不依赖。
- **不采用**：控制台网页解析。

## 附：运行时验证清单状态（2026-09-28）

| 项 | 状态 |
|---|---|
| 接口可达（两区域主机） | ✅ 已验证（真实信封返回） |
| HTTP 200 + body 错误信封形态 | ✅ 已验证（`code:401` 复现） |
| 区域映射（host → 服务/语言） | ✅ 已验证（bigmodel 中文 / z.ai 英文错误信息） |
| credentials.json `api-key` 条目可直接使用 | ❌ **已证伪**（3 条全部 401） |
| OAuth access_token 可直接使用 | ❌ **已证伪**（401，raw/Bearer 均） |
| Authorization 裸 key vs Bearer | ⏳ UNVERIFIED（无被接受的凭证可比对；官方代码证据维持） |
| `limits[]` 字段级结构（type/unit/percentage/remaining/usage/currentValue/nextResetTime/level/usageDetails） | ⏳ UNVERIFIED（需有效 key） |
| `TOKENS_LIMIT unit3→5h`、`unit6→weekly`、`TIME_LIMIT unit5→MCP` | ⏳ UNVERIFIED → v1 按 Custom(raw) 处理 |
| 控制台签发 key 的实际可用性 | ⏳ 待用户提供 key 后验证（Gate E 前） |

## 来源

官方：docs.z.ai/devpack/*、docs.bigmodel.cn/cn/coding-plan/*；github.com/zai-org/zai-coding-plugins（query-usage.mjs）；本机 ZCode app.asar 与 ~/.zcode 文件级证据。
运行时：`fixtures/zcode-quota-limit.redacted.json`、`fixtures/zcode-quota-limit-oauth.redacted.json`（本机实测，2026-09-28）；探测脚本 `scripts/zcode-quota-probe.mjs`、`scripts/zcode-quota-probe-oauth.mjs`。
社区：tokenmeter-mac、zai-rs、pi-zai-usage、coding-plan-monitor（接口路径与鉴权佐证）。
