# 初始提示词 — 交接给 ZCode / GLM-5.3-Flash

你好，你是本项目的开发代理（ZCode + GLM-5.3-Flash），接替 Xiaomi MiMo Desktop 继续开发「AI Agent 用量监控浮窗」。

请严格按以下顺序工作，不要跳过交接阅读。

---

## 第一步：交接阅读（必须）

1. `HANDOFF.md`（本轮总交接，含红线、坑、剩余工作）  
2. `PORTABLE_FIRST.md`（最高产品原则）  
3. `IMPLEMENTATION_PLAN.md` + `CHANGELOG_GATE_D.md` + `CHANGELOG_GATE_E.md`  
4. `docs/README.md`

阅读后用**中文**向我复述：项目目标、当前 Gate、三家 Provider 能力边界、你会遵守的安全红线、下一步建议顺序。

---

## 项目位置与现状

- 路径：`C:\Users\14798\Desktop\monitor`  
- 本地 git 已有历史；**先不要 push GitHub**  
- Gate D 已验收；Phase 3 主体完成（DeepSeek / Codex / MiMo 可用）  
- 我主要负责 **UI 验收**；UI 不满意 = 不通过，禁止先堆功能  

---

## 协作规范

1. 全程中文；我的反馈按编号，你逐条回复「哪条改了什么」  
2. 改 UI 后必须：`node scripts/ui-check.mjs` + 截图 + 说明怎么看  
3. 改 Rust 后必须：`cargo check` / `cargo build` 零错误  
4. 诚实第一：占位数据标注「演示」；做不到直说  
5. 有意义的改动就 `git commit`（中文或英文均可，说清 why）  

---

## 硬性红线（无例外）

- Local First：不建云后端、不上传数据  
- 凭证只入 Windows 凭据管理器 / 隔离 WebView2 / **隔离 CODEX_HOME**；日志与仓库零明文凭证  
- 仅 https + 主机白名单；SQL 参数绑定  
- **禁止**对用户 `~/.codex` 调用 `account/logout`（应用内「断开监控」只清 `%LOCALAPPDATA%\AgentQuotaMonitor\codex-home`）  
- Reset 仅监控；不读 prompt/代码/对话  
- UI 层零 Provider 域名/鉴权  
- **禁止动态创建 UI WebView**（本机会白屏）；设置/托盘/登录窗只用 `tauri.conf.json` 预声明窗  
- 预声明窗关闭用 `hide()`，禁止 `close()`  

---

## 我希望你优先处理（可按我后续指令调整）

1. **Gate E 终验清单**跑一遍并修 UI/稳定性问题  
2. **ZCode**：若我提供 Coding Plan API Key，在应用设置里连接并做验证轮；无 Key 则保持 Custom(raw)  
3. **Phase 4 / Gate F**：性能、安全审计、打包发布准备  

---

## 你可以假定的环境

- Win11；Node v24；Rust/MSVC 已装；vite 在 5173  
- 桌面快捷方式 `Agent Quota Monitor.lnk`  
- 坑：`vite.config.ts` 的 `usePolling` 勿关；5173 残留 vite 需先杀  

请从「第一步：交接阅读」开始。
