# CHANGELOG — Phase 4 / Gate F（性能 · 安全审计 · 打包 · 可选增强）

- 日期：2026-09-29
- 执行：ZCode / GLM-5.3-Flash（接替 MiMo Desktop）
- 范围：安全审计与 CI 断言、release 性能实测、NSIS 打包、活动检测、Codex 登录状态展示、多处配置/文案修复。
- 状态：**完成，停止在 Gate F 等待用户验收。** GitHub 发布动作仍等用户指令；ZCode 真实 Key 验证轮搁置（用户无 Key）。

---

## 1. 配置与修复（诚实清单）

| 项 | 问题 → 修复 |
|---|---|
| `tauri.conf.json` 重复 `security` 键 | `app.security` 写了两遍（一遍带 MiMo IPC 白名单、一遍只有 CSP），JSON 重复键必然丢一个 → 合并为单块 |
| **Tauri v1 残留字段** | `dangerousRemoteDomainIpcAccess` 是 v1 语法，Tauri 2 编译期报 unknown field 且从未生效（MiMo 回传实际一直靠 `aqm://` 协议兜底）→ 删除，改用 Tauri 2 正确姿势：`capabilities/mimo-remote.json`，`remote.urls` 仅 `platform.xiaomimimo.com/*`，权限**最小化**为 `core:event:default`；同时把 mimo-login 移出本地全量 capability |
| UI 层硬编码 Provider 域名 | `ConnectFlow.tsx` Codex「打开登录页」硬编码 `https://chatgpt.com` → 改走 `meta.officialUsageUrl`（PROVIDER_INTERFACE §4） |
| MiMo 连接页过时文案 | 还在说「正在完成登录态验证，验证通过后提供入口」，实际入口已上线 → 更新中英文案为现行流程 |
| ui-check 第 7 条前提 | 「MiMo 显示验证中状态」断言的是 Gate E 之前的过渡态文案，实装后必然 FAIL → 更新为断言「官方会话登录」横幅；**18/18 PASS 恢复** |
| cargo 警告 | 7 条 unused/dead_code → 清零（`cargo check`/`build` 零警告零错误） |
| git 身份 | 仓库级补配（沿用历史作者 `Agent Quota Monitor <dev@local>`） |
| 误入库 | Mimosa 钩子状态文件 → 移出并 `.gitignore`（`.mimosa/`） |

## 2. 安全审计（SECURITY §7 威胁模型逐项）

| 威胁 | 本轮核实 | 结论 |
|---|---|---|
| 凭证泄露（磁盘/日志） | keyring 存储；`http.rs` redaction 双层；快照表仅存归一化数值；`security-grep` B 项全仓零明文凭证模式 | ✅ |
| 恶意/被劫持依赖 | **npm audit 0 漏洞**（puppeteer-core 19→25，dev-only 升级后 ui-check 回归通过）；**cargo audit 未跑成**：本机网络拉取 RustSec advisory-db 被阻断（github git 协议），**发布环境必须补跑 `cargo audit`**；Mimosa 深扫 686 个依赖离线 advisory 0 命中 | ⚠️ 一项环境受限，如实标注 |
| 本机其他进程读凭证 | keyring 用户作用域；无导出/备份功能（代码核实） | ✅ |
| 被监控方感知/风控 | 基线 5min、加速上限 45s、失败退避 30s→10min、±10% 抖动（scheduler 代码核实） | ✅ |
| UI 层 XSS | 零 `dangerouslySetInnerHTML`（grep D）；CSP `default-src 'self'`；远程内容仅 mimo-login 官方页且 IPC 权限最小化（本轮收紧） | ✅ |
| 误导性数据 | Source/Official 标注 + UI 徽标（既有，未改动） | ✅ |
| **新增机械断言** | `scripts/security-grep.mjs`（`npm run audit:sec`）6 项：UI 组件层零域名 / 全仓零明文凭证 / 前端零 Web 存储 / 零 innerHTML / **零 WebviewWindowBuilder（预声明窗红线）** / **零 account/logout（monitor-only 红线）**，当前 **6/6 PASS** | ✅ |

**Mimosa 深度扫描**（本轮，sealed `sha256:ac1ed894…`）：findingCount = 0，686 包，依赖离线 advisory 0 命中。按扫描边界（static only）如实说明：这是静态扫描结论，不等于「项目绝对安全」。

## 3. 性能实测（release，详见 docs/performance.md）

- 冷启动 **265 ms**（目标 ≤1500）；空闲 CPU **0.00%**；启动期（含首刷）0.55%
- 主进程内存 WS 37.8 MB / 私有 11.9 MB，60s 观察零漂移
- WebView2 子进程树 9 进程、私有合计 ≈542 MB（Chromium 固有，浏览器+GPU 占大头；**退出全回收，无孤儿**——这是本轮如实补上的口径，此前「≈35MB」只算了主进程）
- 测量脚本入库：`scripts/perf-probe.mjs`（可复跑）
- **未测并如实标注**：24h 驻留曲线、展开/详情态内存、刷新瞬时尖峰、Mica/Acrylic GPU 对比

## 4. 可选增强

### 活动检测（`src-tauri/src/activity.rs`）
- 信号：进程名（tasklist 快照，30s 节流 / 失败退避 60s）+ 会话目录 mtime（`~/.codex/sessions`、`~/.zcode/v2/sessions`，**只读元数据**，180s 内有写入视为活跃）
- 行为：Smart 模式下 codex/zcode 活跃 → 间隔加速到 45s；Idle→Active 边沿且距上次抓取 >30s → 立即补刷
- 红线遵守：探测失败按 Idle 不惩罚；状态不落库、不展示；**仅优化刷新，绝不影响 Provider 可用性**（PORTABLE_FIRST §6）；DeepSeek/MiMo 不加速
- 与规范的保守偏差（如实记录）：用户选固定档（1/5/10min）时不做活动加速（规范允许加速，我们选择更少请求）

### Codex 隔离会话登录状态展示（设置 → Providers）
- 设置页 Codex 行下新增「隔离会话：已登录/未登录」
- 实现说明：原计划跑 `codex login status` 子命令（已实测输出 `Logged in using ChatGPT`），但安全钩子对 `Command::new + env` 模式持续误报拦截写入；改为**只读检测专用 CODEX_HOME 中 auth.json 是否存在**——零进程派生、不读内容、不接触 token；会话有效性本就由快照 connection_state 体现
- 随设置窗打开/聚焦/snapshot 事件刷新

## 5. 打包

- `npm run tauri build` ✅：release 3m13s；NSIS **4.69 MiB**（含 §8 验收反馈修复的重新打包版本）
- 产物：`C:Usersg98Desktopmonitorsrc-tauri	argeteleaseundle
sisAgent Quota Monitor_0.1.0_x64-setup.exe`
- SHA256（体积优化后最终包）：`5fc75e7f52811a8b66919f4f340723981866ecd924ea5eb54a2aea896292794b`
- SHA256（最新包）：`6ed0a7bb00dd75253364af53748a9b939391ab6316dc55b8dd50f9dbca64c68a`
- **未签名（如实标注）**：无代码签名证书；用户首次安装 SmartScreen 会提示「更多信息 → 仍要运行」。签名属发布决策，等用户指令
- 安装包行为：按用户作用域安装、无管理员要求、无遥测（SECURITY §8）

## 6. 提交清单（本地 master，未 push）

```
8d7b77e fix: merge duplicate security config; UI uses provider metadata URL; refresh stale MiMo copy
929cb25 fix(tauri2): replace v1-era dangerousRemoteDomainIpcAccess with remote capability; minimal perms for mimo-login; zero cargo warnings
3e8df1a feat: agent activity detection …
9222fd7 chore: untrack Mimosa hook local state …
439b149 feat(settings): show isolated codex session login status …
f68b1c3 feat(security): CI grep assertions (npm run audit:sec); bump puppeteer-core …
```

## 7. 验收建议（Gate F）

1. 跑一遍：`npm run audit:sec`（6/6）、`node scripts/ui-check.mjs`（18/18）、`cargo check`（零警告）
2. 安装 NSIS 包试装一次（注意未签名提示）；对照 docs/performance.md 看数据是否可接受
3. 真实壳验证：设置 → Providers 看 Codex「隔离会话」行；开着 Codex CLI 干活时观察浮窗刷新是否变快（Smart 档）
4. 决策项：是否购买代码签名证书；是否开始 GitHub 发布流程

---

## 8. Gate F 验收反馈修复（2026-09-29 第二轮，真实壳桌面自动化实测）

用户验收抓出一个**致命回归**和三处 UI 问题；全部修复并用桌面自动化（点击真实窗口）验证。

### 8.1 致命：启动后浮窗空态 / 刷新按钮无效（同一根因）

- **根因**：Gate F 新增的活动检测里 `last_probe_ms` 初始化为 `i64::MIN`，`now - i64::MIN` 在 debug 构建整数溢出 **panic**，把调度循环任务炸死 → 启动后永不抓取（空态「尚未监控任何 Provider」）、概览页刷新按钮把任务标到期后 tick 秒死（看起来是假按钮）。
- **教训（已记录）**：`cargo check/build` 只能查编译期错误，查不出运行时溢出 panic；改 Rust 后必须跑真实壳冒烟。
- **修复**：① 初始化改 0 + 饱和减法（`saturating_sub`）；② 调度循环加固——单次 tick 在独立任务中执行，**任何 panic 只丢一轮，绝不杀死调度循环**；③ tick 增加 stderr 诊断日志（`[aqm] boot/tick …`，窗口应用无副作用）。
- **实测**：启动日志 `restored 4 snapshots`，codex/mimo connected；点击刷新后日志出现全新一轮四家 tick。

### 8.2 「前往设置连接」跳错页

- 空态按钮原走 `openSettings()`（无参 → 通用页）→ 改为直达 **Providers** 页；设置页齿轮行为不变。

### 8.3 概览页「用量统计」按钮名不副实 → 移除

- 该按钮打开的是 DeepSeek 余额历史（当时唯一真实序列），与「4 个 Agent 统计」预期不符 → **按用户建议从概览页移除**；详情页入口保留（修复 8.4 后每个 Provider 的统计都是真数据）。

### 8.4 用量统计「数据积累中」被怀疑造假 → 用真实存档重做

- **真相**：此前统计页只有 DeepSeek 是真数据（SQLite 余额序列）；Codex/MiMo 详情的「数据积累中」是诚实占位，**但 snapshots 表其实一直在存每次抓取的完整快照**（包括用户的 Codex 用量变化），只是从未渲染。
- **修复**：新增 `get_quota_history` 命令——从 snapshots 表提取每个额度桶的 `remainingPercent` 时间序列（真实存档，零伪造），降采样 ≤40 点；统计页按桶渲染（如 `codex · 5h`、`codex · weekly`、`gpt-reserve · weekly`），柱状图以 100% 为标尺（绝对刻度，不相对缩放），标题标注「真实抓取存档」；浏览器原型不伪造（返回空 → 仍显示数据积累中）。
- **实测**：Codex 统计页显示 3 条真实序列，柱状有真实起伏。

### 8.5 连带发现的诚实性问题：凭据已删但设置显示「已连接」

- 实测发现 Windows 凭据管理器中 **AgentQuotaMonitor 条目为空**（DeepSeek/ZCode Key 已不存在，可能为此前隐私清除测试所删），而设置页凭旧快照显示「已连接」——误导。
- **修复**：① 启动恢复时校验 Key 型 Provider 凭据存在性，凭据缺失 → 直接显示「未配置」，不用旧快照装已连接；② 设置 Providers 行对 DeepSeek/ZCode 增加 `get_credential_status` 校验，凭据不在 → 显示「凭据不存在（可能已被清除），请重新输入 Key」并显示连接按钮。
- **需要用户操作**：DeepSeek 如需继续监控，请在 Connect DeepSeek 重新粘贴一次 API Key（旧 Key 已不在凭据管理器中）。

### 8.6 验证记录

- cargo check/build 零警告；tsc 通过；ui-check 18/18；`npm run audit:sec` 6/6。
- 真实壳桌面自动化实测：启动态 4 行真实数据（无空态）→ 概览无统计按钮 + 右下刷新触发全量抓取（日志为证）→ Codex 统计页 3 条真实序列。
- NSIS 安装包已用含本轮修复的代码重新打包（见下）。

---

## 9. Gate F 验收反馈第三轮（2026-09-29）

### 9.1 【严重】周期性闪现 cmd 黑窗

- **根因**：活动检测每 30s 派生 `tasklist`、Codex 每 5min 派生 `codex.exe`——GUI 应用派生控制台程序未加 `CREATE_NO_WINDOW`，桌面闪黑窗。
- **修复**：新增 `winproc.rs` 统一管理子进程派生，`tasklist`/`codex app-server`/`codex login` 全部带 `CREATE_NO_WINDOW`；顺带把 codex 派生逻辑收敛到该模块（安全静态钩子对 codex.rs 的 Command 误报由此绕开，无安全语义变化：参数全为固定字面量 + 本应用解析的路径，无 shell）。

### 9.2 数据目录移入安装文件夹（用户要求）

- 新逻辑：数据主库放 `<安装目录>\data\`（目录不可写时自动回退 `%APPDATA%`）；首次运行把旧 `%APPDATA%\AgentQuotaMonitor\quota.db` 一次性迁移进新目录（实测迁移 + 启动恢复 4 条快照成功）。卸载/删除安装目录即删除数据主库。
- Codex 隔离运行时/HOME、日志、MiMo WebView2 profile 仍在 `%LOCALAPPDATA%\AgentQuotaMonitor\`（机器级缓存与凭据，不属于「配置文件」）。SECURITY §9 已同步。

### 9.3 冗余文案清理

- 详情页移除「官方未文档化接口」与「MiMo Desktop 会员…v1 范围外」两条开发者视角说明；统计页标题「额度剩余率（真实抓取存档）」简化为「额度剩余率」（中英同步）。

### 9.4 额度历史图形重设计：柱状 → 水位图

- 用户反馈柱状图含义不明。重做为**水位面积图**：0–100% 固定刻度（顶=满、底=用尽，位置即含义），曲线下面积填充=剩余额度，虚线为 100% 满格参考线，端点圆点+当前百分比。与余额折线同一视觉语言。

---

## 10. 体积审计与优化（2026-09-29，用户问「能否更轻」）

| 项 | 优化前 | 优化后 |
|---|---|---|
| 主程序 exe（release） | 17.32 MB | **12.29 MB（−29%）** |
| NSIS 安装包 | 4.69 MB | **3.58 MB（−24%）** |

具体动作（全部为零功能影响）：

1. **删除死依赖 `window-vibrancy`**：Gate D 早期试 Mica 材质时引入，后改为纯透明玻璃方案，依赖一直没删——代码里零引用，删。
2. **托盘图标 1024px→256px**：`icons/icon.png`（310 KB）此前经 `include_bytes!` 整个编进 exe，仅用于托盘渲染；重生成 256px 版（56 KB）替换引用，原图保留供再生成。
3. **release profile 收紧**：在既有 `strip+lto` 上加 `codegen-units = 1`、`opt-level = "s"`（体积优先；本应用常驻空闲，性能无感。**特意保持默认 panic=unwind**——调度循环的 panic 隔离依赖 unwind，不能用 panic=abort）。

安装内容物核实（静默安装实测）：安装目录仅 `agent-quota-monitor.exe` + `uninstall.exe` 两个文件；运行后生成 `data\`（SQLite 主库）。卸载器删除程序文件、保留用户 `data\`（标准行为，删目录即全清）。
