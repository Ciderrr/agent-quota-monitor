# Provider Discovery — Xiaomi MiMo Desktop Membership

- 证据等级标注：**[官方文档]** / **[本机已验证]** / **[社区]** / **[UNVERIFIED]** / **[未找到 NONE FOUND]**
- 结论速览：**可监控性：低（当前无可用数据源）→ v1 标记"暂不支持"**。额度仅存在于桌面应用内部 UI；无官方 API、无公开端点、无社区逆向资料。本机已安装该应用，留有后续运行时取证入口。

---

## 1. 官方目前的额度结构

**[官方文档]** https://mimo.mi.com/static/docs/quick-start/faq/token-plan/desktop-guide.md、https://mimo.mi.com/static/docs/tokenplan/integration/mimo-desktop.md、https://mimo.mi.com/static/docs/updates/feature/desktop.md

- MiMo Desktop：小米首个个人桌面智能体应用（Windows + macOS ARM），V0.1.0 于 2026-09-01 发布，约 2026-09-22 随 MiMo-V2.6 正式版并推出会员订阅。
- 功能：模型智能路由（`mimo-v2.6-flash` / `pro` / `pro-ultraspeed`）、多会话协作、全模态 I/O、浏览器/电脑控制（海外版）。
- **会员档位：Basic / Intermediate / Premium / Elite**（官方文档验证档位名；Premium/Elite 含 UltraSpeed）；年付 88 折。
- 档位价格与额度数值：**官方静态文档未找到**。定价页 https://mimo.xiaomimimo.com/pricing/ 为客户端渲染（Next.js 壳，无静态数据）；媒体流传"¥59–¥1,199"**[社区，UNVERIFIED，未经官方确认]**。
- 会员额度**仅限 Desktop 应用内使用**，绑定登录的小米账号，不涉及 API Key；与 Token Plan 相互独立。

## 2. 官方文档证据

- Token Plan vs Desktop Membership FAQ（两订阅独立性）：`mimo.mi.com/static/docs/quick-start/faq/token-plan/desktop-guide.md`
- Desktop 安装/登录/自定义模型：`mimo.mi.com/static/docs/tokenplan/integration/mimo-desktop.md`
- 版本动态：`mimo.mi.com/static/docs/news/latest/mimo-desktop.md`、`mimo.mi.com/static/docs/updates/feature/desktop.md`
- Web 伴生页后端主机线索：`https://mimo.xiaomimimo.com/desktop/invite/runtime-config.js`（公开文件）→ `apiBase: "https://mimo-server-cn.xiaomimimo.com"` **[官方资源，主机已验证]**

## 3. 可用数据源（按优先级框架）

| 优先级 | 数据源 | 状态 |
|---|---|---|
| P1 官方公开 API | 会员状态/额度 API | ❌ **未找到** |
| P2 官方客户端本地信息 | 应用内额度 UI（无命令行/无导出接口） | ❌ **未找到** 可编程入口 |
| P3 官方客户端本地状态 | `%APPDATA%\Xiaomi MiMo` | ⚠️ **[本机已验证]** 应用为 Electron（目录含 Cache/Local Storage/Partitions 等）；值得注意的文件：`desktop-api.json`、`preferences.json`、`Partitions\xiaomi-account`（小米账号会话分区）、`db/`、`logs/`。**文件内容未读**（含凭证风险），是否存在可读的额度缓存 **[UNVERIFIED]** |
| P4 已登录会话端点 | `mimo-server-cn.xiaomimimo.com`（已验证后端主机）；社区传闻桌面客户端登录态可经本地代理 `127.0.0.1:13579` 读取（聚合站单源信息，无法确认） | ⚠️ **[UNVERIFIED]**，无公开端点证据 |
| P5 页面解析 | 额度显示在原生应用 UI，无稳定网页目标 | ❌ 不适用 |

## 4. 是否需要认证

（若未来可行）需要小米账号会话：Desktop 应用内登录态（`Partitions/xiaomi-account`）或 `mimo-server-cn.xiaomimimo.com` 的会话凭证——两者均未文档化。

## 5. 认证从哪里得到

当前**无可文档化来源**（NONE FOUND）。见 §14 的运行时取证计划。

## 6. 是否可以自动发现

**仅限存在性检测（Gate A.1 边界）**：
- 允许：检测是否安装（`%APPDATA%\Xiaomi MiMo` 等标准路径存在性 **[本机已验证]**）、是否运行（进程名枚举）——仅用于显示"已安装/运行中"元信息与活动检测。
- 禁止（红线）：读取用户对话、prompt、登录凭证、session、应用内部账户数据；`Partitions/xiaomi-account` 等会话数据一律不读。

额度监控本身：**不可发现**（无数据源，见 §3）。

## 7. 是否必须用户配置

无需配置（v1 固定为"暂不支持"形态）。卡片显示"暂不支持 / Unsupported" + `Open Usage Page`；若检测到应用已安装/运行，可附带该元信息（可选、默认不显示）。

## 8. 数据字段映射（前瞻设计，当前无数据源）

| 通用模型 | 来源 | 状态 |
|---|---|---|
| QuotaBucket `mimo-desktop/monthly`（档位月池，unit 推测 Credits） | 无 | ❌ 阻塞，等待数据源 |
| plan_name ∈ {Basic, Intermediate, Premium, Elite} | 官方文档 | Official |
| ultraspeed 标志 | 档位属性 | Official |

## 9. 查询成本

不适用（无数据源）。

## 10. 推荐刷新频率

不适用。若未来落地会话读取，建议 10–15 min。

## 11. 失败模式

- 产品上市仅数周，档位/价格/额度必然持续变动。
- 国内/海外版本功能集不同（如电脑控制仅海外），可能存在两套额度体系。
- 若额度由服务端计算且仅在原生 UI 渲染，无稳定解析目标；应用升级会击穿任何非官方本地读取。
- 会员绑定小米账号，读取对象是**账号状态**而非本地工件——失败模式等同会话失效。

## 12. 数据可靠性

当前无可获得数据。档位名/属性：Official；任何额度数字：不可得。

## 13. 法律/服务条款风险

**中高（若强行逆向）**。Desktop 应用自带用户与隐私协议（全文未能公开机器分析）；对全新原生客户端做本地状态逆向或会话 API 截取，比读取 Web 控制台更可能被认定为未授权访问；同族产品存在"安全校验"模式（如 MiMo Claw 的 key 校验）。在官方未提供任何数据源的情况下，**v1 不做任何逆向读取**。

## 14. 最终推荐方案

**v1：Unsupported（暂不支持）**。浮窗中显示该 Provider 卡片为"暂不支持"状态 + `Open Usage Page` 指向官方定价/控制台页。
**后续取证计划（Gate A 后、独立任务）**：仅做**被动、本地、只读**检查——
1. 检查 `%APPDATA%\Xiaomi MiMo\desktop-api.json` 是否描述本地 API 面；
2. 审查已安装 Electron 包的 app.asar 中的路由字符串（同 ZCode 取证方式）；
3. 观察应用自身对 `mimo-server-cn.xiaomimimo.com` 的正常流量中是否存在额度类 JSON（由用户自行决定是否配合抓包）；
4. 验证社区传闻的 `127.0.0.1:13579` 本地代理是否为官方客户端行为。
任何一步发现官方口径的可用端点，再评估实现；发现不了就维持 Unsupported。

## 15. 备用方案

- 无（v1 无备用形态；手动档位输入仅存在于 MiMo Token Plan 的 v1 形态中）。
- 引导有程序化额度查询需求的用户改用 Token Plan（官方为其设计了工具集成）。
- 后续取证（§14 计划）若发现官方口径数据源，再按新 Discovery 评估。

## 附：运行时验证清单

1. Windows 安装布局与数据文件语义（框架、token 存储机制、`desktop-api.json` 用途）。
2. Desktop 客户端与 `mimo-server-cn.xiaomimimo.com` 之间是否可观测到会员/额度 JSON。
3. 档位真实价格与额度池（媒体信息待官方确认）。
4. 是否存在展示剩余额度的网页（而非原生 UI）。
5. `127.0.0.1:13579` 传闻出处核实。

## 来源

官方：mimo.mi.com（docs/news/updates）、mimo.xiaomimimo.com（pricing 页、desktop/invite/runtime-config.js）、github.com/XiaomiMiMo/MiMo-Code（同族产品本地端点先例）。
本机：`%APPDATA%\Xiaomi MiMo`（Electron 数据目录，仅列目录名）、`%LOCALAPPDATA%\xiaomi-mimo-desktop-updater`。
社区（均 UNVERIFIED）：IT之家（beta 时间）、新浪科技转载微博（价格区间）、topic.fit（本地代理传闻）。

## v0.3 复查

多轮检索（同期调研 Grok/豆包/Qwen/混元等）仍未发现 MiMo Desktop 会员额度的可用数据源——**结论维持：可监控性低，标记"暂不支持"**。本机已安装该应用，保留运行时取证入口。
