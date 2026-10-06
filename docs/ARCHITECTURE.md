# ARCHITECTURE.md — 系统架构

> 版本 0.2（Gate B 修订：Portable-first 双层架构）
> 技术栈结论（ADR-001）：**Tauri 2 + Rust（后端）+ React + TypeScript（前端 WebView2）**
> 最高原则：**Account-level AI Quota Monitor，Portable-first**（PORTABLE_FIRST.md）——Clean PC 只装 Monitor 即可完成全部 Provider 连接；本机 Agent 检测只是 Local Enhancement Layer。

---

## 1. 总览

```
┌────────────────────────── Windows 11 进程 ──────────────────────────┐
│                                                                      │
│  Rust Core (src-tauri)                    WebView2 (React + TS)      │
│  ┌──────────────────────────┐            ┌───────────────────────┐   │
│  │ Remote Account Layer     │  events    │ Widget (Collapsed)    │   │
│  │  API Key / OAuth /       │ ─────────▶ │ Expanded/Detail       │   │
│  │  Account Session /       │  commands  │ Connect / Settings    │   │
│  │  Official API /          │ ◀───────── │ History               │   │
│  │  ManagedProviderRuntime  │            │ i18n / theme / stores │   │
│  │  (ADR-004: Codex)        │            └───────────────────────┘   │
│  │ Local Enhancement Layer  │                                        │
│  │  agent detection /       │                                        │
│  │  existing login reuse /  │                                        │
│  │  process activity        │                                        │
│  │ Scheduler / Quota Store  │                                        │
│  │ Credential Store(凭据管理器) + WebView2 isolated profile (MiMo)    │
│  │ History(SQLite)  Notifications(Toast)  Tray  Window Manager       │
│  └──────────────────────────┘                                         │
└──────────────────────────────────────────────────────────────────────┘
```

**双层规则**：Remote Account Layer 决定 Provider 能否使用；Local Enhancement Layer 只优化体验。任何 Provider 的基本可用性不得依赖第二层。UI 只消费 ProviderSnapshot。
分工铁律：**Rust 侧拥有一切 Provider 知识与调度；React 侧是纯快照渲染器**。UI 关闭/重载不影响数据采集；被监控 Agent 不运行不影响本应用（独立进程）。

## 1.1 ManagedProviderRuntime（ADR-004）

部分 Provider 由 Monitor 管理官方本地 runtime：

- Codex：首次连接时从官方源按需下载 `@openai/codex`（sha512 校验、版本固定、独立目录），或复用本机已有 Codex（Optional Enhancement）；登录走 `account/login/start{type:"chatgpt"}` 打开官方 ChatGPT 页，`account/login/completed` 通知收尾；runtime 自管 token 刷新，Monitor 零 token 接触。
- 通用约束：仅官方来源、完整性校验、版本与来源可追溯（About/诊断可见）；禁用协议中违反零 token 原则的方法。

## 2. 模块划分（目录结构）

```
src-tauri/src/
  main.rs / lib.rs            # Tauri 入口、插件装配
  core/
    scheduler/                # 每 Provider 刷新任务、jitter、backoff、手动冷却、活动联动
    quota/                    # 快照缓存、stale 推导、Derived 计算、事件广播
    credentials/              # Windows Credential Manager 封装（keyring crate）
    history/                  # SQLite 读写、聚合、保留策略
    activity/                 # 进程枚举 + 文件 mtime 探测（节流 30–60s）
    notifications/            # 阈值判定 + 去重（notification_state 表）
    http/                     # 共享客户端：超时 15s、强制 https、UA、redaction 中间件
    tray.rs  window.rs        # 托盘菜单、浮窗定位/置顶/Mica
  providers/
    registry.rs
    codex/  zcode/  mimo_token_plan/  deepseek/  mock/
    # mimo_desktop: OUT OF V1 SCOPE（不入 Registry；归档研究见 docs/provider-discovery/mimo-desktop.md）
src/                          # React
  widget/                     # Collapsed 浮窗
  detail/                     # Expanded 详情
  settings/  history/
  i18n/  theme/  stores/  types/
docs/                         # 本套文档
```

## 3. 关键数据流

1. Scheduler 按 `REFRESH_STRATEGY.md` 触发某 Provider 的 `fetch_snapshot()`。
2. 适配器：读凭证（内存）→ 请求官方端点 → 归一化为 `ProviderSnapshot` → 返回。
3. Quota Store：更新内存缓存；写 SQLite（snapshots/quota_samples/balance_samples）；计算通知阈值 → Notifications；广播 `snapshot_updated`。
4. WebView 收事件 → 从 store 取快照 → 渲染。UI 不发起任何轮询。
5. History 查询（Today/7d/30d）读 `metric_daily` 聚合表。

失败路径：适配器返回 `ProviderError` → Scheduler 进入 backoff → Quota Store 保留旧快照并标记 → 广播 `provider_error` → UI 显示缓存+stale+错误角标。

## 4. 窗口与系统集成（Tauri 2）

| 能力 | 实现 |
|---|---|
| 浮窗 | 单窗口 `transparent: true, decorations: false, shadow: true, skip_taskbar: true`；CSS 圆角 20–24px；拖动区 `data-tauri-drag-region` |
| Mica/亚克力 | `window-vibrancy` crate：优先 Mica（Win11），失败降级 Acrylic → 半透明纯色；设置项可关闭以省 GPU |
| Always on Top | 默认关；托盘/设置开启；窗口模式：Desktop Mode（普通层级，点击他处失焦）/ Always on Top |
| 位置记忆 | 关闭/拖动结束/退出时持久化 x、y、monitor、mode、expanded → `kv` 表；启动时校验显示器边界（多显示器结构预留：记录 monitor id 与 work area） |
| 托盘 | `tray-icon`：Show、Refresh all、Always on top ✓、Settings、Quit；关闭浮窗 = 隐藏到托盘（可设置改为退出） |
| 开机自启 | `tauri-plugin-autostart`，默认关，设置可开 |
| 单实例 | `tauri-plugin-single-instance`（二次启动 → 显示浮窗） |
| 通知 | `tauri-plugin-notification`（Windows Toast）；设置页可全局/按 Provider 关闭 |
| 打开官方页 | `tauri-plugin-opener`（系统默认浏览器，禁止内嵌渲染官方页） |

多显示器：第一阶段仅优化主显示器右上角默认位；数据结构（monitor id + 边界校验）不阻碍未来扩展。

## 5. 活动检测设计（只输出 active/idle）

| Provider | 信号（全部只读元数据） | 节流 |
|---|---|---|
| Codex | 进程名匹配（`codex.exe`、ChatGPT/ChatGPT.exe）+ `~/.codex/sessions/**` 最新 mtime | 进程枚举 ≤ 每 30 s |
| ZCode | 进程名（`ZCode.exe`、`zcode.exe`、node+脚本路径白名单匹配）+ `~/.zcode/cli/rollout`、`~/.zcode/cli/log` 最新 mtime | 同上 |
| MiMo Desktop | 进程名（MiMo*.exe，运行时确认实际名）+ `%APPDATA%\Xiaomi MiMo\logs` mtime | 同上 |
| DeepSeek | 无（API 型，无本地 Agent）→ 恒 Idle | — |

红线：不读任何文件内容；不做屏幕监控；不注入；结果只有 Active/Idle/Unknown 三态，仅用于刷新调度（REFRESH_STRATEGY §2），绝不持久化、绝不展示"工作时长"。

## 6. 性能设计（对应 docs/performance.md 的测量义务）

- **零常驻 JS 定时器轮询**：UI 仅两个低频 tick（"Xm 前"文案 60 s 一次；倒计时 1 s 一次但仅展开态存在时运行）。
- **无持续动画**：动效仅状态切换 160–240 ms（transform/opacity 合成器属性）；Mica 静态无动画；圆环为 SVG 静态描边，数值变化时 300 ms 过渡。
- **进程枚举** 30 s 节流、失败即退避；SQLite 写入合并（每快照一次事务）。
- **目标**（Gate F 实测验收，非感觉）：idle CPU ≈ 0%（任务管理器 0.0–0.1%）、idle 内存（Rust core + WebView 合计）≤ 120 MB、展开态 ≤ 160 MB、启动到浮窗可见 ≤ 1.5 s、刷新瞬时 CPU 峰值 < 3%。

## 7. 错误与降级总表

| 情形 | 行为 |
|---|---|
| 首次抓取失败且无缓存 | 卡片显示错误态（九种文案，DATA_MODEL §2.6） |
| 抓取失败但有缓存 | 缓存值 + stale 角标 + 错误角标；颜色/透明度降级 |
| Provider 接口改版（持续解析失败） | `ProviderChanged` + 引导打开官方页检查 |
| 网络恢复/系统唤醒 | 立即补一次刷新（带 10 s 节流） |
| 凭据失效 | `AuthRequired`/`LoginExpired` + 设置页跳转入口；不自动重试风暴 |

## 8. i18n 与主题

- react-i18next；语言 zh-CN / en，默认跟随系统，可手选；**组件内禁止硬编码文案**（CI 检查）。
- 主题：Auto/Light/Dark（`prefers-color-scheme` + Windows 设置），CSS 变量 token（UI_SPEC §4）；WebView2 下自动响应系统切换。

## 9. 构建与发布（Gate F）

- 打包：Tauri bundler → NSIS 安装包 + 便携 exe；应用签名（开源后可用 CI 签名或 SHA256 校验说明）。
- 更新：v1 不内置自动更新（避免云依赖），README 提供 GitHub Releases 检查指引。

## 10. 明确不做

- 云后端/账号体系/遥测上报（Local First 红线）。
- 内嵌浏览器渲染官方用量页（只 `opener` 跳转）。
- 自动消费 Reset、自动购买、修改 Provider 账号。
- 读取 prompt/代码/对话内容。
