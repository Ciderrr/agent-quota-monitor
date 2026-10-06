# HANDOFF.md — 开发交接文档（v0.3.0 → 下一窗口）

> 交出方：ZCode（GLM-5.3-Flash）会话 · 接手方：新窗口
> 阅读顺序：**本文件** → docs/README.md（索引）→ docs/provider-discovery/*（按需）
> ⚠️ 本文件取代旧版 HANDOFF（历史见 git log 与 .agent/CHANGELOG_*）。

---

## 0. 30 秒速览

- **项目**：Agent Quota Monitor——Windows 11 AI 订阅额度监控浮窗（Tauri 2 + Rust + React/TS；Local First；Apache-2.0 开源）。
- **仓库**：github.com/Ciderrr/agent-quota-monitor（public）；本地 master = 远端 + **3 个未推送提交**（见 §4，用户指示暂缓推送）。
- **发布状态**：**v0.3.0 已发布（Latest）**——Provider 扩容至 9 家、4 家上限、开关即时反馈；v0.2.2 起内置自动更新（端点 latest.json 已验证）。
- **最新本地功能（已验证、未推送）**：Codex 本机优先（本机有 Codex+登录 → 零下载直读）+ 连接页模式选择卡 + 断开状态专属错误码。
- **基线**：ui-check 18/18 PASS；cargo test 7/7；tsc/cargo 零错误；签名安装包在 src-tauri/target/release/bundle/nsis/。

## 1. 产品与最高原则（勿改）

1. **Portable-first**：Account-level 接入，Clean PC 即装即连；本机 Agent 仅 Optional Enhancement。
2. **Local First**：无云后端、无遥测；凭证只入 Windows 凭据管理器；会话只存隔离 WebView2 Profile。
3. **动态数据模型**：`quotaBuckets[]` + `Custom(raw)`，禁止猜未知语义。
4. **主界面最多同时显示 4 家 Provider**（Rust cap + 设置页提示双保险，v0.3.0 起）。
5. **诚实原则**：区间+置信度而非伪精确值；数据不足/不在燃烧时如实不显示；演示数据必须标注。
6. **红线**：不读 prompt/代码/对话内容（**v0.3.1 用户裁定修订**：日志型 Provider 只解析用量数值字段=允许，见 docs/provider-discovery/claude.md）；绝不触碰用户 ~/.codex / ~/.claude 的登录凭据内容（存在性检查=允许）；仅 https+主机白名单；SQL 参数绑定；预声明窗关闭用 hide() 禁 close()。

## 2. 当前能力矩阵（9 Provider）

| Provider | 路由 | 状态 |
|---|---|---|
| Codex | 本机优先（新）→ Managed Runtime + 隔离登录 | ✅ 本机模式已验证 |
| DeepSeek | 官方 Balance API | ✅ |
| MiMo Token Plan | 官方页会话（隔离 WebView2） | ✅（用户需重登） |
| WorkBuddy Credits | 官方页会话（隔离 WebView2） | ✅（用户需重登） |
| Claude Code | **日志型**（~/.claude JSONL 字段级解析） | ✅（红线修订已获用户裁定） |
| opencode | **DB 型**（opencode.db 列级只读） | ✅（本机 schema 实测） |
| Kimi | 双路由（API Key 余额 / kimi.com 控制台 token 周限额） | ⚠️ 待凭据验证 |
| MiniMax | API Key → coding_plan/remains | ⚠️ 待凭据验证 |
| ZCode·GLM | API Key → quota/limit（BurnRate 实证语义） | ⚠️ 用户无订阅搁置 |

## 3. v0.3.0 未推送提交（用户指示：随下次发版一起推）

| 提交 | 内容 |
|---|---|
| 56f2b6c | Codex 本机优先（resolve_codex_context：本机二进制+~/.codex 登录优先，spawn 签名 Option<&Path>，login_status 加 localAuth/isolatedAuth，logout 断开标记） |
| 5517158 | latest.json 移出库 + gitignore（发布产物按需生成） |
| d930143 | 连接页模式选择卡（本机/浏览器登录二选一，set_codex_mode 持久化 kv codex/mode，fetch 尊重 prefer_managed，断开标记改专属错误码 disconnected） |

## 4. 发布流程（v0.2.2 起的完整闭环，严格按序）

1. 版本号四处：package.json / src-tauri/tauri.conf.json / src-tauri/Cargo.toml / codex.rs clientInfo（grep "0.3.0" 可定位）。
2. 先 `taskkill /F /IM agent-quota-monitor.exe`（否则链接器 os error 5）。
3. **签名构建**：`export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/agent-quota-monitor.key" && export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" && npm run tauri build`（.env 文件无效；密钥丢了将无法再发更新）。
4. `node scripts/gen-latest-json.mjs "release notes"` → 生成 latest.json（updater 清单，**必须随 Release 上传**，缺失=更新链路失效）。
5. `git push` → `git tag vX.Y.Z && git push origin vX.Y.Z` → `gh release create vX.Y.Z <安装包> latest.json --notes ...`（附 SHA256）。
6. 验证：`curl -x http://127.0.0.1:7890 https://github.com/Ciderrr/agent-quota-monitor/releases/latest/download/latest.json`（本机直连 GitHub 会挂，必须走 Clash 代理）。

## 5. 环境与命令速查

```powershell
cd C:\Users\14798\Desktop\monitor
npm install
npm run dev                 # vite 只绑 [::1]——探测一律用 http://localhost:5173，127.0.0.1 会拒连
node scripts/ui-check.mjs   # 期望 18/18
node scripts/hero-shot.mjs http://localhost:5173 tmp-hero/hero.png   # 主视觉图（用户审核后入库）
cd src-tauri; cargo check; cargo test   # predict 引擎 7 测试
src-tauri\target\release\agent-quota-monitor.exe   # 真实壳（构建后需 taskkill 旧实例）
```

**高频坑**：cargo 改代码后"Finished 0.4s"可能是缓存假绿——touch 源文件强制重验；运行实例不杀则 cargo build --release 报 os error 5；taskkill /F 强杀会留 Alt+Tab 幽灵条目（explorer 重启清除）；makensis 脚本禁中文（bad text encoding）；bash heredoc 中文进 NSIS/自动化脚本会编码损坏；node:sqlite 直查 DB 时用绝对路径。

## 6. 剩余工作（路线图）

1. **v0.4 多账号**（下一个主版本）：同 Provider 多账号（数据模型加 account 维度、调度器按账号实例化、设置页账号切换器）。
2. **P2 Provider**（调研已完成，见 docs/provider-discovery/）：Gemini CLI 日志型（红线修订后解锁，需本机装 CLI 验证）；Copilot（非官方 copilot_internal + 设备流）；豆包/火山（Agent Plan 有 API，需 V4 签名）；Qwen（ACS3 签名）；混元（TC3 签名，ModelCost_Monitor 可抄）。
3. **不可行备忘**：Grok（无 API）、MiMo Desktop（无数据源）、opencode Go 订阅（无订阅）。
4. **远期**：macOS 移植；LAN 只读看板；Claude OAuth 官方百分比路线（只读不刷新）；24h 定时更新检查（可选）。
5. **待用户**：MiMo/WorkBuddy 重登；Kimi/MiniMax 凭据（可选，免费试用额度即可闭环验证）。

## 7. 协作规范（多轮验证有效）

1. 全程中文；用户反馈按编号，回复逐条「哪条改了什么」。
2. UI 改动后必跑 ui-check + 截图说明；Rust 改动 cargo 零错误 + **真实壳冒烟**（cargo check 查不出运行时 panic）。
3. 大段代码写完立即编译验证；UI 自动化脚本勿含中文串；中文注释勿写 `*/`。
4. 有意义即本地 commit；**未经用户指示不 push GitHub**（当前明确指示：未推送提交暂缓）。
5. 诚实第一：做不到直说；占位标注；错误码语义单一（勿一码多用）。
