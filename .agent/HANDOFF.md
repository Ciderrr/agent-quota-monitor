# HANDOFF.md — 开发交接文档（MiMo Desktop → ZCode / GLM-5.3-Flash）

> 交接日期：2026-09-29  
> 交出方：Xiaomi MiMo Desktop  
> 接手方：ZCode Coding Agent（模型 GLM-5.3-Flash）  
> 阅读顺序：**本文件** → `PORTABLE_FIRST.md` → `IMPLEMENTATION_PLAN.md` → `CHANGELOG_GATE_D.md` → `CHANGELOG_GATE_E.md` → `docs/README.md`

---

## 0. 30 秒速览

- **项目**：AI Agent 用量监控桌面浮窗（Win11；Tauri 2 + Rust + React/TS；Local First；计划开源）。
- **位置**：`C:\Users\14798\Desktop\monitor`（**已有本地 git**，`master`，未接 GitHub）。
- **进度**：Gate D 已用户验收通过；**Phase 3 / Gate E 主体已完成并多轮实测**（DeepSeek / Codex / MiMo 可用；ZCode 待真实 Key）。
- **运行**：桌面快捷方式 `Agent Quota Monitor.lnk`；或 `src-tauri\target\debug\agent-quota-monitor.exe`（需 5173 上有 `npm run dev`）。
- **验证基线**：`node scripts/ui-check.mjs`（当前 **18/18 PASS**）；Rust `cargo check/build` 零错误（少量 unused 警告）。

---

## 1. 产品与最高原则（勿改）

1. **Portable-first**：Clean PC 只装 Monitor 也能连全部 Provider；本机 Agent 仅 Optional Enhancement。
2. **Local First / 安全**：无云后端；凭证只入 Windows 凭据管理器；日志/fixture 零明文凭证；仅 https + 主机白名单；SQL 参数绑定。
3. **动态数据模型**：`quotaBuckets[]` + `Custom(raw)`，禁止猜未知语义。
4. **UI**：Apple Control Center × Widget × Win11 材质；UI 不漂亮 = 不通过。
5. **Gate 制**：每阶段停下等用户验收。

**红线摘要（无例外）**：不上传数据；日志只留 `credential_id`；拒 localhost/私有地址做 Provider 请求；Reset 仅监控；不读 prompt/代码/对话；UI 层零 Provider 域名/鉴权；演示数据必须标注；**不碰用户本机 Codex 的 `~/.codex` 登录**（见 §5）。

---

## 2. 当前可运行能力

| 模块 | 状态 | 说明 |
|---|---|---|
| 浮窗 UI | ✅ | 透明圆角玻璃；精简/详情/统计/设置/托盘；拖动、置顶、玻璃透明度可调 |
| DeepSeek | ✅ | API Key → 余额 + 余额历史；测试连接为真请求；清除连历史一并清 |
| Codex | ✅ | Managed Runtime 下载 + `codex app-server`；ChatGPT 登录；额度桶/Reset/Credits |
| MiMo Token Plan | ✅ | 隔离登录窗 + 会话读取 `tokenPlan/usage|detail`；自动读额度 |
| ZCode / GLM | ⚠️ | 适配器已写（裸 key + 双区域 + Custom(raw)）；**无订阅无法真测** |
| 托盘 | ✅ | 左键呼出；右键自绘菜单（刷新/置顶/设置/退出）；置顶切换不关菜单 |

---

## 3. Phase 3 / Gate E 本轮实测结论

### Codex（ADR-004）
- 官方 npm `@openai/codex@0.158.0-win32-x64`（约 161MB）按需下载 + **sha512**；解压整个 `bin/` 到  
  `%LOCALAPPDATA%\AgentQuotaMonitor\runtimes\codex\0.158.0\`
- **CODEX_HOME 隔离**：`%LOCALAPPDATA%\AgentQuotaMonitor\codex-home`（与用户 `~/.codex` 分离）
- `codex login`（专用 HOME）→ 浏览器 OAuth → `auth.json` 写入隔离目录 → `account/rateLimits/read`
- **坑**：
  1. RPC 后**不可 drop stdin**，否则 app-server 不回包（曾误报 `network_unavailable`）
  2. `codex login` 进程必须活到 OAuth 回调完成（曾 3 秒杀进程 → `127.0.0.1` 拒绝连接）
  3. 普通浏览器登 chatgpt.com **≠** Codex CLI 登录
  4. 登录成功后必须**立刻拉额度并写快照**，否则设置仍显示「登录已失效」
  5. `granted`/`toppedUp` 可为 `null`，前端须 `!= null` 与 `money()` 空值兜底

### MiMo（ADR-005 + fixture）
- `fixtures/mimo-token-plan.redacted.json`：`monthUsage.percent` 为 **0–1**；`detail.planCode/currentPeriodEnd`
- 预声明窗 `mimo-login` → 官方登录 → 同源 fetch → 多通道回传（IPC / `aqm://` / event）
- **坑**：动态建 WebView 会白屏卡死 → **一律用 tauri.conf 预声明窗**；远程页 IPC 需 `dangerousRemoteDomainIpcAccess`；刷新按钮必须走会话读取而非调度器 tick

### DeepSeek
- 真实测试连接、余额阈值通知、隐私清除含历史；**无用量 API**（禁止余额差冒充消费）

---

## 4. 环境与命令

```powershell
cd C:\Users\14798\Desktop\monitor
npm install
npm run dev                 # 5173（usePolling 勿关）
node scripts/ui-check.mjs   # 期望 18/18
node scripts/screenshot.mjs http://localhost:5173
# 真实壳
src-tauri\target\debug\agent-quota-monitor.exe
# Rust
cd src-tauri; cargo check; cargo build
```

**环境坑**（与前次交接相同）：
1. Vite 文件监听失效 → `usePolling` 保持开启  
2. 5173 残留 vite → `netstat -ano | findstr :5173` + `taskkill /F /PID`  
3. cargo 不在 PATH → ` $env:Path += ";$env:USERPROFILE\.cargo\bin"`  

---

## 5. 架构与安全注意（接手必读）

- **窗口**：`widget` / `settings` / `tray-menu` / `mimo-login` 均在 `tauri.conf.json` **预声明**；关闭用 `hide()` **禁止 `close()`**（close 会销毁预声明窗，之后打不开）。
- **二次动态 Webview 在本机会白屏/卡死**，不要再 `WebviewWindowBuilder::new` 动态建 UI 窗。
- **`data-tauri-drag-region` 不可靠** → `start_window_drag` 显式 `start_dragging()`；行/按钮须排除，否则点不进详情。
- **改窗口尺寸**须保持**右边缘**固定，否则浮窗向右漂。
- **Codex 登出** = 仅清隔离 `codex-home` + 快照回「登录已失效」；**绝不 `account/logout` 用户 `~/.codex`**。
- **设置窗 X** 不能放进整条 title 拖拽区，否则点不到。
- **capability**：`windows` 含全部预声明窗；`core:event:allow-emit` 等；外部域 IPC 见 `dangerousRemoteDomainIpcAccess`。

---

## 6. 剩余工作（建议顺序）

1. **ZCode 真实 Key 验证轮**（用户提供控制台 Coding Plan API Key）：确认 `limits[]` 字段后把 `Custom(raw)` 升级为标准枚举；无订阅则保持现状。  
2. **Gate E 验收**：四家真实数据 + Clean-PC 说明 + 错误态演练 → `CHANGELOG_GATE_E.md` 定稿。  
3. **Phase 4 / Gate F**：`docs/performance.md` 全测、SECURITY §7 审计、CI grep、NSIS 打包 + GitHub 发布。  
4. **可选**：活动检测（进程名 + mtime，仅优化刷新）；`codex login status` 展示；zsh/bash 工具链 README。

---

## 7. 用户协作规范（多轮确认）

1. 全程中文；用户反馈按编号，回复逐条「哪条改了什么」。  
2. UI 验收优先；改 UI 后 `ui-check` + 截图 + 说明怎么看。  
3. 诚实第一：占位/演示必须标注；做不到直说。  
4. 每次改动后自检：UI → ui-check；Rust → cargo 零错误。  
5. 本地 git：有意义即 commit；**不** push（用户尚未要 GitHub）。

---

## 8. 仓库与 git

- 本地 `master` 已有完整提交历史（从 Initial commit 到 Codex/MiMo 各修复）。  
- `.gitignore` 含 `node_modules/`、`target/`、`.tmp-mimo/`（**浏览器 profile 绝不可入库**）。  
- Fixtures 均脱敏，可进库。

---

*交接结束。文档与代码不一致时，以代码 + 最新 CHANGELOG 为准，并在 `CHANGELOG_GATE_E.md` 或后续 CHANGELOG 如实记录。*
