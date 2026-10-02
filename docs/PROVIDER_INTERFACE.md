# PROVIDER_INTERFACE.md — Provider 适配器接口规范

> 版本 0.1（Phase 0 / Gate B 评审稿）· 2026-09-28
> 原则：**UI 永远不知道任何 Provider 的 URL、凭证位置、字段名**。Provider 之间零依赖。新增 Provider = 新增一个目录 + 注册一行，不改任何既有 Provider 或 UI 分支。

---

## 1. 适配器契约（Rust trait）

```rust
#[async_trait]
pub trait ProviderAdapter: Send + Sync {
    /// 稳定 ID："codex"、"zcode"、"mimo-token-plan"、"mimo-desktop"、"deepseek"
    fn id(&self) -> &'static str;

    /// 展示元数据（全部走 i18n key + 内置图标资源，禁止联网取图标）
    fn metadata(&self) -> ProviderMetadata;

    /// 凭证规格：需要什么类型的凭证、是否可自动发现（不含任何凭证值）
    fn credential_spec(&self) -> CredentialSpec;

    /// 自动发现本地已有认证（如 ~/.codex/auth.json、~/.zcode/v2/credentials.json）。
    /// 返回"发现了什么、可用性如何"，绝不返回凭证值本体。
    async fn discover(&self, host: &dyn HostContext) -> DiscoveryStatus;

    /// 保存/更新用户提供的凭证（写入凭据管理器），并做连通性校验
    async fn authenticate(&self, host: &dyn HostContext, input: CredentialInput)
        -> Result<AuthOutcome, ProviderError>;

    /// 核心：抓取并归一化为 ProviderSnapshot（唯一允许网络访问的入口）
    async fn fetch_snapshot(&self, ctx: &FetchContext) -> Result<ProviderSnapshot, ProviderError>;

    /// 健康检查（Settings"测试连接"按钮）
    async fn health_check(&self) -> HealthReport;

    /// 活动探测：只允许返回 Active | Idle | Unknown；只读进程名/文件 mtime，
    /// 严禁读取任何文件内容、prompt、代码、对话
    fn activity(&self) -> ActivityState;

    /// 官方用量页（"Open Usage Page"按钮；系统默认浏览器打开）
    fn official_usage_url(&self) -> Option<Url>;

    /// 能力声明（调度器据此排程）
    fn capabilities(&self) -> ProviderCapabilities;

    /// 清除本 Provider 凭证与缓存
    fn disconnect(&self, host: &dyn HostContext) -> Result<(), ProviderError>;
}
```

### 1.1 支撑类型

```rust
pub struct ProviderMetadata {
    pub id: &'static str,
    pub name_key: String,        // i18n："provider.codex.name" -> "OpenAI Codex"
    pub vendor_key: String,
    pub icon: IconAsset,         // 内置 SVG 资源 ID
    pub docs_url: Option<Url>,
    pub vendor_url: Option<Url>,
    /// PORTABLE-first：Remote Account Layer —— 决定能否连接（与本地增强严格分离）
    pub connection_methods: Vec<ConnectionMethod>,
    /// Local Enhancement Layer —— 只优化体验，不决定可用性
    pub local_enhancements: Vec<LocalEnhancement>,
    /// EndpointStability 与 DataQuality 是两个维度（ADR-005）：
    /// 数据可以是 Official，接口同时是 Undocumented first-party
    pub endpoint_stability: EndpointStability,
}

pub enum ConnectionMethod { ApiKey, BrowserLogin, WebAccountSession, Manual }
pub enum LocalEnhancement { ExistingLocalSession, ExistingRuntime, ProcessActivity, LocalUsageDb }
pub enum EndpointStability { PublicApi, UndocumentedFirstParty, ReverseEngineered, None }

pub struct CredentialSpec {
    pub kind: CredentialKind,    // ApiKey | OAuthReuse | WebSession | None
    pub auto_discoverable: bool,
    pub prompt_text_key: String, // 凭证输入框上方说明（i18n）
    pub security_notice_key: String, // 固定的凭证安全提示（SECURITY.md §5 文案，不可自定义）
}

pub struct ProviderCapabilities {
    pub recommended_refresh: Duration,  // 如 DeepSeek 5min、Codex 60s
    pub min_refresh: Duration,          // 调度硬下限（防滥用）
    pub supports_activity_detection: bool,
    pub monitor_only_warnings: Vec<I18nKey>, // 如 Codex 的 "重置仅监控" 提示
}

pub struct FetchContext {
    pub http: SharedHttpClient,      // 统一超时/UA/重定向策略/redaction 中间件
    pub credentials: CredentialHandle, // 凭据管理器句柄（值仅在内存，禁落盘禁日志）
    pub cancel: CancellationToken,
}

pub enum DiscoveryStatus {
    Found { account_hint: Option<String>, ready: bool },
    NotFound,
    Indeterminate { reason_key: String },
}

pub enum AuthOutcome { Verified { account_label: Option<String> }, NeedsUserAction { reason_key: String } }
```

### 1.3 ManagedProviderRuntime（ADR-004，可选实现）

Provider 自带官方本地 runtime 时，实现此扩展接口（Codex v1）：

```rust
pub trait ManagedProviderRuntime {
    /// 确保 runtime 可用：优先复用本机兼容版本（Optional Enhancement），
    /// 否则从官方源按需下载（白名单 + sha512 校验 + 版本固定），绝不使用第三方源
    async fn provision(&self) -> Result<RuntimeHandle, ProviderError>;
    /// 官方登录流程（如 account/login/start{type:"chatgpt"} → 打开官方页 →
    /// account/login/completed 通知）；Monitor 零 token 接触，runtime 自管刷新
    async fn start_login(&self, handle: &RuntimeHandle) -> Result<LoginFlow, ProviderError>;
}
```

红线：禁用任何向 Monitor 暴露 access/refresh token 的协议变体（如 `chatgptAuthTokens`）。

### 1.4 Clean-PC 规则

任何适配器**不得**以本机 Agent 存在为可用性前提；本机检测只能填充 `local_enhancements` 与 `InstallationState`（独立于 ConnectionState）。`connection_methods` 为空的 Provider 才允许 Unsupported。

### 1.2 错误契约

`ProviderError` 是适配器与调度器的唯一错误通道：

```rust
pub struct ProviderError {
    pub code: ErrorCode,          // DATA_MODEL §2.6 九种
    pub http_status: Option<u16>,
    pub retry_after: Option<Duration>,   // 尊重 429 Retry-After
    pub detail: Option<String>,   // 已脱敏；日志中间件再过一道黑名单
}
```

适配器职责边界：
- **允许**：把 HTTP 4xx/5xx、反爬挑战、schema 解析失败映射到 ErrorCode；`ProviderChanged` 专用于"曾成功解析、现持续解析失败"（防止把改版误报为网络故障）。
- **禁止**：适配器内自行重试风暴、自行调 std::process 读文件内容、 panic、把凭证写进任何错误路径。

---

## 2. 注册表与生命周期

```rust
pub struct ProviderRegistry { adapters: Vec<Arc<dyn ProviderAdapter>> }

impl ProviderRegistry {
    pub fn builtin() -> Self {
        Self::new()
            .register(codex::CodexAdapter::default())                       // connection: BrowserLogin(+ApiKey); enhancements: existingRuntime, processActivity
            .register(zcode::ZCodeAdapter::default())                       // connection: ApiKey; enhancements: processActivity
            .register(mimo_token_plan::MimoTokenPlanAdapter::default())     // connection: WebAccountSession（fixture 验证前 UI 显示验证中状态）
            .register(deepseek::DeepSeekAdapter::default())                 // connection: ApiKey
            .register(mock::MockAdapter::new())                             // Gate C UI 原型专用，release 构建剔除
        // mimo_desktop: OUT OF V1 SCOPE —— 不注册、无 UI 卡片（归档研究：docs/provider-discovery/mimo-desktop.md）
    }
}
```

生命周期状态机（每 Provider 一个调度单元）：

```
NotConfigured ──discover/authenticate──▶ Ready
Ready        ──fetch_snapshot 成功──▶ Connected(展示 snapshot)
Ready/Connected ──可映射错误──▶ AuthRequired | RateLimited | TemporarilyUnavailable |
                              NetworkUnavailable | ProviderChanged
任意态       ──capabilities/用户禁用──▶ Unsupported | Disabled
任何错误态   ──成功刷新──▶ Connected（backoff 清零）
```

规则：
- 非 Connected 且**有缓存**：UI 显示缓存值 + stale + 错误角标（不显示 0%）。
- 非 Connected 且**无缓存**：显示错误态卡片（未配置/暂不支持/需要登录…）。
- `Unsupported` 是**一等公民状态**（MiMo Desktop v1 即此形态），显示"暂不支持 + Open Usage Page"，不做任何请求。

---

## 3. HostContext — 适配器能 touching 什么

`dyn HostContext` 由 core 提供，是适配器访问宿主能力的**唯一入口**（便于审计与测试替身）：

| 能力 | 说明 | 安全边界 |
|---|---|---|
| `credential_store()` | 凭据管理器读写 | 只暴露 get/set/delete by id；值不进日志 |
| `http()` | 共享 HTTP 客户端 | 强制 https、统一超时 15s、无系统代理绕过 |
| `settings()` | 只读设置快照 | — |
| `log()` | 结构化日志 | 自动 redaction（见 SECURITY §6） |
| `data_dir()` | Provider 专属缓存目录 | 严禁写凭证 |

**适配器不得**：直接 `std::fs` 任意路径（本地文件访问经 HostContext 白名单方法，如 `read_codex_home()`）、创建线程、修改系统状态、打开窗口。

---

## 4. IPC 面（Rust ↔ React）

| Command（UI → Core） | 语义 |
|---|---|
| `list_providers` | 元数据 + connection_state + 是否启用（无任何 Provider 内部细节） |
| `get_snapshot(provider_id)` | 最新快照（含缓存态与 stale 标记） |
| `refresh_now(target)` | target = provider_id / all；10 s cooldown 在 core 侧执行 |
| `test_connection(provider_id)` | health_check |
| `set_credential(provider_id, value)` | 值经内存直通凭据管理器，IPC 后即弃 |
| `clear_credential(provider_id)` | disconnect |
| `enable_provider(provider_id, bool)` | 启用/停用 |
| `get/set_settings` | 结构化设置对象 |
| `get_history(range)` | Today / 7d / 30d 聚合 |
| `set_window_state(x, y, monitor, mode)` | 拖动/模式持久化 |

| Event（Core → UI） | 语义 |
|---|---|
| `snapshot_updated(provider_id)` | 触发该 Provider 卡片重渲染 |
| `provider_error(provider_id, ErrorCode)` | 错误角标 |
| `schedule_changed` | 退避/活动变化导致的下次刷新时间（供"下次更新"提示） |

UI 侧对 Provider 的全部认知 = `list_providers` 的元数据 + `ProviderSnapshot`。**UI 源码中不允许出现任何 Provider 域名、路径、字段名**（CI 用 grep 断言，见 IMPLEMENTATION_PLAN）。

---

## 5. 新增 Provider 的标准流程（以 Claude Code 为例）

1. 调研并写 `docs/provider-discovery/claude-code.md`（15 节模板）。
2. 建 `src-tauri/src/providers/claude_code/`：`mod.rs`（Adapter 实现）+ `types.rs`（官方响应模型，serde，未知字段 `#[serde(flatten)] extra: Map`）+ `tests/`（真实响应样本 fixture，无凭证）。
3. 实现 trait；`credential_spec` 声明凭证类型与安全提示 key。
4. `registry.builtin()` 注册一行；新增 i18n key（zh/en）；新增图标 SVG。
5. 若周期类型/单位是新形态：先按 DATA_MODEL §2.3/§2.4 决定进枚举还是 `Custom`。
6. 更新 `docs/architecture/provider-matrix.md` 与 UI Provider 列表排序权重。

UI、History、Notifications、Scheduler **零改动**。

---

## 6. Mock Provider（Gate C 专用）

`providers/mock/` 从静态 JSON 场景文件生成快照（场景集见 UI_SPEC §9），支持运行时切换：正常 / login expired / unsupported / stale / low quota / 每种主题。它与其他适配器实现同一 trait，因此 UI 原型验证的就是最终数据管道形态。release 构建 `#[cfg(not(debug_assertions))]` 剔除。
