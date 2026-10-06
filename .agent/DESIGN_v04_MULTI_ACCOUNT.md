# DESIGN v0.4 — 多账号（同 Provider 多账号）数据模型与调度器设计

> 状态：已拍板（用户逐项裁定，见 §8），进入 P1 实现

> 上游文档：docs/DATA_MODEL.md、docs/REFRESH_STRATEGY.md、docs/PROVIDER_INTERFACE.md、docs/ARCHITECTURE.md

---

## 1. 背景与目标

v0.3 已支持 9 家 Provider，但每家**仅一个账号**。真实场景存在同 Provider 多账号：

- 同一服务商有多个订阅（如个人 Plus + 团队号）；多个 DeepSeek API Key（自用/项目分离）；MiMo 多设备号。

**目标**：同一个 Provider 下可连接多个账号，各自独立轮询、独立历史、独立预测与通知；主界面与设置页能区分「哪个账号」。

**不目标**（本版不做）：

- 跨 Provider 的账号分组/合并视图；
- 账号间自动切换建议（切换建议仍是 Provider 粒度，v0.4.1 再议）；
- Codex 本机模式多账号（本机 `~/.codex` 天然单登录，见 §8 决策 2）。

## 2. 现状盘点：`provider_id` 是全局唯一键轴

| 层 | 现状（键 = provider_id） |
|---|---|
| Rust 运行态 `Runtime` | `snapshots` / `enabled` / `next_due_ms` / `fail_count` / `last_fetch_ms` / `read_in_progress` / `last_session_read_ms` 全部 `HashMap<String, _>` |
| 调度器 `tick()` | 遍历 `PROVIDER_IDS: [&str; 9]`；`fetch_provider(id)` 单例分发 |
| SQLite | `snapshots` PK(provider_id, fetched_at)；`balance_samples` PK(provider_id, ts, currency)；`quota_series` 按 provider_id 聚合 |
| 凭据管理器 | 槽位 `deepseek/api-key`、`zcode/coding-plan-key`、`kimi/api-key`、`minimax/api-key` |
| 通知去重 | kv key `notif::quota::{provider}::{bucket}`、`notif::burn::{provider}::{bucket}` |
| IPC | `get_snapshots()` / `refresh_now(id)` / `connect_with_credential(id)` / `get_quota_history(provider_id)` |
| Insights | `predictions` / `balance` / `alternatives` 均以 providerId 为 key |
| 前端 | `ProviderSnapshot.providerId`；`accountLabel?: string`（显示位已预留，无身份位）；主界面按 providerId 索引卡片 |
| 会话型窗口 | 预声明窗口 label `mimo-login` / `wb-login`，各绑一个隔离 WebView2 Profile |
| Codex | kv `codex/mode`、`codex/disconnected` 全局键；本机/托管二选一 |

## 3. 核心设计：实例键（InstanceKey）

引入**账号实例**为一等公民：

```rust
// 新增（types.rs）
pub struct AccountInstance {
    pub provider_id: String,   // 所属 Provider
    pub account_id: String,    // 实例标识，见下
    pub label: Option<String>, // 用户可改的显示名（缺省取快照 account_label）
    pub enabled: bool,         // 账号级开关（总闸仍为 Provider 级）
}
```

- **account_id 生成**：连接成功时生成短随机 ID（8 位 uuid 前缀，如 `a3f9c2d1`）。无语义、不可猜测、与凭据内容无关。
- **InstanceKey = `"{provider_id}/{account_id}"`**（如 `deepseek/a3f9c2d1`）。仅作运行态/存储键，UI 不直接展示该原始串。
- **迁移默认账号固定 id = `main`**：旧数据全部归入 `main`（见 §6）。
- `Snapshot` 增加字段：`accountId: Option<String>`（TS 同步）。为 None 时前端按 `main` 处理（兼容旧持久化快照）。

**为什么不用数组索引/自增序号**：序号在删除中间账号后漂移，会让历史序列、通知去重、凭据槽位全部错位；随机短 ID 稳定且删除安全。

## 4. 分模块改动

### 4.1 Rust 数据模型（types.rs）

- `Snapshot` + `account_id: Option<String>`；`not_configured()` 等构造点补参数。
- TS 镜像 `provider.ts` 同步（Gate D 手工同步惯例）。

### 4.2 存储（store.rs）——SQLite 迁移

- `snapshots`、`balance_samples` 两表**加列 `account_id TEXT NOT NULL DEFAULT 'main'`**（SQLite ALTER ADD COLUMN 直接支持；PK 不变——时间序列按 (provider, account, ts) 查询时带 WHERE account_id）。
- `quota_series` / `balance_series*` / `load_latest_snapshots` 全部加 account 维度参数与过滤。
- 通知去重 kv key 变更：`notif::quota::{provider}/{account}::{bucket}`；**升级时旧 key 清空**（一次性 `DELETE FROM kv WHERE key LIKE 'notif::%'`），代价仅是升级后首轮可能重发一次告警，可接受且诚实。

### 4.3 凭据（credentials.rs + 各适配器）

- 新槽位格式：`{provider}/{account_id}/{slot}`（如 `deepseek/a3f9c2d1/api-key`）。
- **读回退、写新槽**：`get_credential("deepseek/main/api-key")` 未命中时自动回退读旧槽 `deepseek/api-key`——老用户零迁移、零断连；新写入一律新格式。不做凭据管理器批量搬迁（不可逆操作风险大于收益）。

### 4.4 调度器（scheduler.rs）——核心改造

```rust
pub struct Runtime {
    // 键从 provider_id → instance_key（"{provider}/{account}"）
    pub instances: Vec<AccountInstance>,          // 新：实例目录（持久化到 kv accounts/list）
    pub snapshots: HashMap<String, Snapshot>,     // key = instance_key
    pub next_due_ms / fail_count / last_fetch_ms / read_in_progress: HashMap<String, _>,
    // enabled 保留 Provider 级总闸；账号级开关在 instances[i].enabled
    ...
}
```

- `tick()`：遍历由 `PROVIDER_IDS` 改为「instances 且其 Provider 总闸开启」。
- `fetch_provider(instance)`：按 provider_id 分发到适配器，但**凭据/上下文按实例取**。适配器 trait 签名统一加 `account: &str`（或传 ctx 结构）——API Key 型只需换 key 来源；日志型（claude/opencode）天然单账号，恒返回 `main`。
- 活动检测 `activity::poll(provider_id)` 保持 Provider 级：本机进程活动无法区分账号，同 Provider 多账号共享活动信号（保守且够用）。
- 每 Provider 账号数上限 **3**、总实例上限 **12**（防御性：请求频率与内存可控；超限 UI 禁止添加）。
- 退避/抖动/加速逻辑不变，逐实例独立。

### 4.5 会话型（MiMo / WorkBuddy）——动态登录窗

现状：预声明窗口 `mimo-login`（label 固定、Profile 隔离目录固定）。多账号方案：

- 登录窗改为**运行时动态创建**：label `mimo-login-{account_id}`，WebView2 隔离 Profile 目录按账号分目录（`profiles/mimo/{account_id}`）。
- 红线延续：动态窗同样在 `exclude_aux_windows_from_alt_tab`（show 后重调）+ 预声明关闭走 hide()；窗口清单改为「现存实例遍历」而非固定数组。
- `mimo_store_usage` / `session_read_mimo` 等 IPC 增加 account 参数；`read_in_progress` 按实例防重入。
- **单账号用户路径不变**：`main` 账号仍可复用现有 `mimo-login` 窗（避免为最常见场景引入动态窗复杂度）——实现时按「account_id == main 走预声明窗，否则动态窗」。

### 4.6 Codex（决策项，§8.2）

- **建议 v0.4 不做 Codex 多账号**：本机模式单登录是物理事实；托管模式多账号需每账号一套 Managed Runtime + 隔离 CODEX_HOME，成本/收益比最差（用户主用本机模式）。
- 代码上仅保证：Codex 恒单实例 `codex/main`，设置页不出现「添加账号」按钮；`codex/mode`、`codex/disconnected` kv 键不动。

### 4.7 通知 / 预测 / Insights

- `maybe_notify_quota/balance/burn`：去重 key 与正文均带账号区分（正文如「DeepSeek · 工作号 · 5小时限额：剩余 18%」；账号无自定义名时用 plan_label 或「账号 2」序称）。
- `predict.rs` 接口不变（吃快照序列）；`compute_insights` 改为按实例取序列，Insights 三个 map 的 key 改为 instance_key。`BucketPrediction/BalancePrediction/Alternative` 加 `accountId` 字段。
- 切换建议保持 Provider 粒度：代表桶取该 Provider「剩余最低的已连接账号」（诚实：换账号确实能续命时才建议切换 Provider）。

### 4.8 前端

- `provider.ts`：`ProviderSnapshot.accountId?`；Insights 类型同步。
- 主界面（widget）：卡片仍按 Provider 卡展示；同 Provider 多账号时**卡片头显示账号名/序号**，点击进详情后可切换该 Provider 的账号 Tab。
- **卡数上限可配置（1–8，默认 4）**：设置页提供档位；Rust `MAX_VISIBLE` 改为读配置 clamp 1–8（红线语义保持：浮窗空间约束，只是上限交给用户）。
- **超上限反馈**：启用/添加导致卡片数超过上限时，浮窗**自动回滚滚动区到顶部**并显示错误条——滚动带物理加速度与缓冲回弹（惯性衰减动画），错误条说明「已达上限 N 张，可在设置调整」。不用打断式弹窗。
- 设置页：每 Provider 卡内新增账号列表区（名称、余量、状态、重登、删除）+「添加账号」；添加流程 = 走该 Provider 现有 ConnectFlow（API Key 输入或登录窗），成功后落实例。
- 删除账号：删凭据 + 删实例 + **清该账号历史**（决策 §8.3）。
- i18n：新增账号相关词条（zh/en 同步）。

## 5. IPC 面变更

| 命令 | 变更 |
|---|---|
| `get_snapshots` | 返回含 accountId（无破坏，新增字段） |
| `refresh_now` | 参数 id → instance_key（后端兼容：裸 provider_id 视为该 Provider 唯一账号或 main） |
| `connect_with_credential` | 增加 account_id 参数（新连接由前端先生成 ID） |
| `set_provider_enabled` | 不变（Provider 总闸）；新增 `set_account_enabled` / `remove_account` / `rename_account` |
| `get_quota_history` | 增加 account 参数 |
| `get_credential_status` | 返回按实例的状态表 |

## 6. 迁移方案（一次启动完成，可回滚）

1. SQLite：`ALTER TABLE ... ADD COLUMN account_id ... DEFAULT 'main'`（幂等：先查 pragma table_info）。
2. kv：清空 `notif::*`（见 §4.2）；无其他破坏。
3. 凭据：不搬（读回退）。
4. 启用集：`DEFAULT_ENABLED` 不变；已有 kv 开关不动。
5. 老快照 JSON 无 accountId 字段 → 反序列化后按 None → `main` 处理，无需重写历史行。

## 7. 分阶段交付（每阶段独立可验证、可发版）

| 阶段 | 内容 | 验证方式 |
|---|---|---|
| **P1 核心闭环** | 实例键模型 + SQLite/凭据/调度器/通知/预测全链路 + **API Key 型 Provider 多账号**（DeepSeek/ZCode/Kimi/MiniMax） | cargo test + 真实壳；DeepSeek 双 key 实测（用户有凭据） |
| **P2 会话型** | MiMo/WorkBuddy 动态登录窗 + 按账号 Profile | 用户重登后双账号实测 |
| **P3 UI 完整** | 设置页账号管理 + 主界面账号标识 + i18n + Insights 展示 | ui-check 18/18 + 截图审核 |
| **P4（可选）** | Codex 托管模式多账号 | 视决策 §8.2 |

P1+P3 即可发 v0.4.0；P2 随 v0.4.1。

## 8. 拍板记录（用户已裁定）

1. **主界面卡数上限**：沿用「卡数」语义，但由固定 4 张升级为**用户可配置 1–8 张**（默认仍 4）。超过已选上限时反馈方式采用**自动回滚到顶部 + 顶部错误条提示**（带真实物理加速度与缓冲回弹的滚动动画，参照常见 App 的物理滚动手感），不做打断式弹窗。
2. **Codex 不参与多账号**：恒单账号（`codex/main`）；本机模式天然单登录，托管模式本版也保持单账号。
3. **删除账号时本地历史一并清除**（隐私优先，Local First 惯例）。
4. **账号数上限**：每 Provider 3 个、全局 12 个。
5. **通知默认不打扰**（已提前落地，随下次发版）：阈值预设首位与默认值均为「不提示」（0 = 永不触发）；`MAX_VISIBLE` 常量同步改为可配置（读 kv，clamp 1–8）。

## 9. 红线影响评估

- 凭据仍只入 Windows 凭据管理器（槽位改名不换介质）；
- 会话仍走隔离 WebView2 Profile（目录按账号细分，隔离性增强而非削弱）；
- 日志型 Provider（claude/opencode）不变，恒单账号，不新增解析面；
- 网络白名单、SQL 参数绑定不受影响（新增列均为参数绑定）；
- 无新增遥测；演示数据（mock）如展示多账号将明确标注。
