# Agent Quota Monitor

一个 **完全开源**、**Local First** 的 Windows 桌面浮窗，实时监控你的 AI 订阅额度与积分：Codex（ChatGPT）、MiMo Token Plan、WorkBuddy Credits、DeepSeek 余额、ZCode·GLM Coding Plan。

A **fully open source**, **Local First** Windows desktop widget that monitors your AI subscription quotas and credits: Codex (ChatGPT), MiMo Token Plan, WorkBuddy Credits, DeepSeek balance, ZCode·GLM Coding Plan.

![tech](https://img.shields.io/badge/Tauri%202-Rust-blue) ![ui](https://img.shields.io/badge/UI-React%20%2B%20TS-cyan) ![license](https://img.shields.io/badge/License-Apache--2.0-green)

## 特性 / Features

- **玻璃质感浮窗**：精简/详细/统计三视图，置顶、拖动、深浅色、中英文
- **动态额度模型**：`quotaBuckets[]` 统一表达任意周期（5h 滚动 / 每周 / 每月 / 积分包），未知语义自动降级 `Custom(raw)`，绝不猜测
- **智能刷新**：事件驱动调度 + 指数退避 + ±10% 抖动；HTTP 型自动刷新，会话型一键重登
- **Local First**：无云后端、无遥测；凭证只存 Windows 凭据管理器；会话只存应用专属隔离 WebView2 Profile
- **Portable-first**：Clean PC 即装即连，不依赖本机安装任何 Agent

## 支持的 Provider / Supported Providers

| Provider | 数据 | 接入方式 | 说明 |
|---|---|---|---|
| Codex (ChatGPT) | 5h/weekly 额度桶 | 官方 Managed Runtime | 隔离 `CODEX_HOME`，不触碰用户 `~/.codex` |
| MiMo Token Plan | 月度百分比 | 官方页会话（隔离 WebView2） |  undocumented 接口，低频保守刷新 |
| WorkBuddy Credits | 积分包余额/用量 | 官方页会话（隔离 WebView2） | 同上 |
| DeepSeek | 余额 + 余额历史 | 官方 Balance API | 仅余额，不做差值推算 |
| ZCode · GLM Coding Plan | 额度桶 | API Key（凭据管理器） | 适配器就绪，待真实 Key 验证 |

## 安装 / Install

**普通用户无需配置任何环境**：前往 [Releases](https://github.com/Ciderrr/agent-quota-monitor/releases/latest) 下载安装包，双击安装即可（WebView2 为 Win11 系统组件，无需额外安装）。

安装包特性：中英双语选择、品牌开场动画、安装前自动关闭运行中的实例。

## 从源码构建 / Build from Source（仅开发者需要）

前置：Node 18+、Rust (MSVC)。以下命令只服务于"从源码编译"这一件事：

```bash
npm install          # 安装前端开发依赖（React/Vite/TypeScript 等，装入 node_modules/；不是安装 Node，也不是安装本软件）
npm run tauri dev    # 开发模式运行：Rust 后端 + 前端热更新（localhost:5173），改代码即时生效
npm run tauri build  # 生成 NSIS 安装包（src-tauri/target/release/bundle/nsis/），产物需手动安装
```

## 安全与隐私 / Security

- 凭证只入 Windows Credential Manager；日志零明文
- 仅 HTTPS + 主机白名单硬校验；SQL 参数绑定
- 会话 Cookie 只存应用专属隔离 WebView2 Profile，永不落盘/入日志
- 安全模型与威胁分析见 [SECURITY.md(SECURITY.md)

## 文档 / Docs

| 文档 | 用途 |
|---|---|
| [PORTABLE_FIRST](docs/PORTABLE_FIRST.md) | 最高产品原则：账户级接入、Clean-PC 即装即连的架构依据 |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | 系统架构：模块划分、数据流、Codex Managed Runtime 设计，动手改代码前先读 |
| [DATA_MODEL](docs/DATA_MODEL.md) | 统一数据模型：额度桶/余额/用量字段语义，涉及快照或历史表改动时查这里 |
| [PROVIDER_INTERFACE](docs/PROVIDER_INTERFACE.md) | 新增/修改 Provider 的接入契约（适配器 trait、连接方式、IPC 面） |
| [REFRESH_STRATEGY](docs/REFRESH_STRATEGY.md) | 刷新调度设计：退避、抖动、活动联动的依据，调刷新参数前读 |
| [UI_SPEC](docs/UI_SPEC.md) | 浮窗视觉与交互规格：视图布局、主题、i18n、§12 验收清单 |
| [SECURITY](SECURITY.md) | 安全模型与威胁分析：凭证存储、会话隔离、网络白名单 |
| [docs/README](docs/README.md) | 文档总索引：含 ADR 决策记录、各 Provider 端点调研证据与 Gate 交付记录 |

## 免责声明 / Disclaimer

MiMo / WorkBuddy / Codex 相关功能依赖各官方站点的非公开接口，接口变更可能导致对应功能失效（界面会如实提示）。本项目独立开发，与腾讯、OpenAI、Anthropic、DeepSeek、ZCode 无关。仅供个人额度监控使用——请遵守各服务商条款。

## License

[Apache-2.0](LICENSE)
