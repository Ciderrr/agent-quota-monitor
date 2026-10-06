# SECURITY.md — 安全与隐私规范（最高优先级约束）

> 版本 0.1（Phase 0）
> Local First：应用默认完全本地运行；**不存在、也永不建设**保存 API Key / Cookie / Token / Session / 余额 / 用量数据的自有云后端。本项目开源，安全机制必须可被社区轻松审计。

---

## 1. 凭证存储（唯一权威方案）

- **Windows Credential Manager**（`keyring` crate，Generic Credentials）：
  - 条目命名：服务名 `AgentQuotaMonitor`，账号名 `<provider_id>/<slot>`（如 `deepseek/api-key`、`zcode/bigmodel-individual`）。
  - UI 与日志中只出现 `credential_id`（如 `deepseek/api-key`），**永不出现凭证值**。
- 备选（同一 trait 的第二实现，设置页不做切换入口，供企业策略环境）：DPAPI 加密文件（`CryptProtectData`，CurrentUser 作用域，存于 `%APPDATA%\AgentQuotaMonitor\credentials.dpapi`）。
- 禁止落盘位置（红线，CI 扫描）：SQLite、JSON、config.toml、log、crash report、localStorage、前端任何 store 持久化。

## 2. 凭证生命周期

| 阶段 | 行为 |
|---|---|
| 输入 | UI 输入框 password 型；IPC 传值后 core 立即写入凭据管理器并丢弃内存副本；粘贴板不主动读取 |
| 使用 | 适配器经 `CredentialHandle` 取值 → 仅在内存中拼装请求头；请求对象随响应丢弃 |
| 展示 | Settings 显示 `已配置（···）` + credential_id + 更新时间；不回显任何值片段 |
| 清除 | "清除凭证" = 删除凭据管理器条目 + 该 Provider 缓存；UI 二次确认 |
| 迁移 | 永不导出/导入凭证（无备份功能即无泄露面） |

## 3. 复用官方客户端凭证的特殊规则（Codex / ZCode）

- **Codex**：只读使用 `%USERPROFILE%\.codex\auth.json` 的 token（内存、单次请求有效）；**绝不写回、绝不代为刷新**（并发刷新会使 refresh_token 轮换失效，导致用户被登出——比不刷新严重得多）。token 过期 → `LoginExpired`，引导用户打开 Codex CLI 自行刷新。主方案优先 `codex app-server`（token 完全不经手）。
- **ZCode**：优先直接使用用户在 ZCode 中配置的 Coding Plan API Key（自动发现自 `~/.zcode/v2/credentials.json`）。读取该文件仅提取 `account-provider:...:api-key` 值；**只提取、不存储副本**——每次刷新时实时读取，避免敏感数据二次落盘。
- 阅读官方客户端文件时只匹配已知键名，文件内容不进日志。

## 3.1 MiMo Token Plan 的 Web 账户会话（ADR-005）

- 会话只存在于 **Monitor 专属 WebView2 隔离 profile**（native/provider backend 域）。React 前端**绝对不得**获得 Cookie / session token / access token——UI 只消费 ProviderSnapshot。
- Cookie/session 永不 serialize 到 SQLite / JSON / localStorage / log / crash dump。
- 登录完全由官方页面驱动（Console 自身 `genLoginUrl` → 小米 SSO → callback）；Monitor 不读取、不记录、不代理账号/密码/短信码/2FA。
- 设置页提供"清除 MiMo 会话"= 删除整个隔离 profile。
- 首次连接固定文案（逐字实现，i18n key `security.mimo_session_notice`）：
  - 中文："登录将在小米 MiMo 官方页面完成。Agent Quota Monitor 不会读取或保存你的账号密码；登录会话仅保留在本机，用于读取你自己的 Token Plan 用量信息。"
  - English："Sign-in is completed on the official Xiaomi MiMo page. Agent Quota Monitor never reads or stores your password. Your sign-in session remains on this device and is used only to retrieve your own Token Plan usage."

## 4. 网络规范

- 仅 HTTPS；每 Provider 域名白名单硬编码在适配器内（`http` core 模块强制校验，适配器无法请求白名单外地址）：
  - deepseek: `api.deepseek.com`
  - codex: `chatgpt.com`（backend-api 路径）、`auth.openai.com`（仅 app-server 模式内由 CLI 使用，本应用不直连）
  - zcode: `api.z.ai`、`open.bigmodel.cn`（+备选 `zcode.z.ai`）
  - mimo: `platform.xiaomimimo.com`（若实验性 Web 会话方案获批）
- 统一超时 15 s；禁用系统代理绕过；无遥测、无崩溃上报外发、无"检查更新"请求（v1）。
- 请求与响应 body 不落盘（`snapshots.payload` 只存归一化后的脱敏快照）。

## 5. 凭证输入时的强制提示文案（逐字实现，不可改写省略）

> 触发时机：用户首次为任一 Provider 输入 API Key / Token / Cookie 或其他敏感信息前。

中文：

> 该凭证仅保存在你的 Windows 本机安全凭据存储中，不会上传到任何第三方服务器。本应用不会记录或同步你的完整凭证。

English：

> This credential is stored only in the secure credential storage on your Windows device. It is never uploaded to our servers, logged, or synchronized.

实现要求：i18n key `security.credential_notice`；模态确认（"我知道了"单按钮）；任何凭证输入路径（Settings、Onboarding、错误恢复）都必须先展示。

## 6. 日志与诊断

- 结构化日志（tracing），默认 info 级，文件轮转 5×2 MB，位于 `%APPDATA%\AgentQuotaMonitor\logs`。
- **禁止记录**：API Key、token、cookie、Authorization/Credential 头全文、prompt、代码、对话内容、官方客户端文件内容。
- 允许记录：`credential_id`、Provider id、HTTP 状态码、端点主机名（不含 query）、错误码、耗时、退避状态。
- `http` 模块内置 **redaction 中间件**：对 outgoing headers 与 error string 做正则/键名黑名单替换（`sk-…`、`Bearer …`、`tp-…`、`authorization:` 等 → `[REDACTED]`）；错误构造入口再过滤一道（双保险）。
- 示例——正确：`provider request failed: HTTP 401 (deepseek, credential_id=deepseek/api-key)`；错误示例（禁止出现）：`Authorization: Bearer sk-xxxxxxxx`。
- Crash report（若有）经同一 redaction 过滤器后仅本地保存，不自动上传。

## 7. 威胁模型摘要（开源审计指南）

| 威胁 | 缓解 |
|---|---|
| 凭证泄露（磁盘/日志/崩溃转储） | 凭据管理器；redaction 双层；日志与库表不含凭证字段（表结构可机械验证） |
| 恶意/被劫持依赖（供应链） | `cargo audit` + `npm audit` 进 CI；锁定 `Cargo.lock`/`package-lock.json`；适配器白名单域名限制爆炸半径 |
| 本机其他进程读取凭证 | 凭据管理器按用户作用域（Windows 标准）；不提供导出功能 |
| 被监控方感知/风控 | 低频、退避、官方同源端点与请求形态；MiMo 类脆弱源默认不启用 |
| UI 层 XSS 窃取内存数据 | 无远程内容渲染；CSP 限制 `default-src 'self'`；快照字段一律 React 文本节点（不 dangerouslySetInnerHTML） |
| 误导性数据（Estimated 冒充 Official） | Source 字段类型级标注 + UI 徽标（DATA_MODEL §4） |

**社区审计入口**：`core/credentials/`（≤200 行，无 IO 依赖）→ `core/http/redaction.rs`（黑名单表）→ `providers/*/`（域名白名单常量）→ CI 脚本 `scripts/security-grep.mjs`（`npm run audit:sec`，扫描禁落盘模式/UI 域名隔离/预声明窗红线）。审计路径在 README 有专节指引。

## 8. 发布安全（Gate F）

- 构建：可复现构建说明；安装包 SHA256 发布于 GitHub Release。
- 依赖最小化：审核每个新 crate/npm 包；禁止引入遥测 SDK。
- 权限最小化：不申请管理员；不注册全局热键（v1）；不写注册表（除卸载项与自启项）。

## 9. 用户数据权利

- 数据主库（设置、历史、快照）随安装目录：`<安装目录>\data\`（用户可见可删；若安装目录不可写则回退 `%APPDATA%\AgentQuotaMonitor\`，首次运行自动迁移旧库）。Codex 隔离运行时/HOME 与日志在 `%LOCALAPPDATA%\AgentQuotaMonitor\`；MiMo 会话在应用专属 WebView2 profile。
- 无账号、无同步、无云备份——用户数据天然不出本机；删除安装目录即删除数据主库（系统凭据管理器中的凭证条目需在应用内「隐私清除」或系统侧手动删除）。
