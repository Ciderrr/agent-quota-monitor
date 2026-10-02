# Agent Quota Monitor

一个 **Local First** 的 Windows 桌面浮窗，实时监控你的 AI 订阅额度与积分：Codex（ChatGPT）、MiMo Token Plan、WorkBuddy Credits、DeepSeek 余额、ZCode·GLM Coding Plan。

A **Local First** Windows desktop widget that monitors your AI subscription quotas and credits: Codex (ChatGPT), MiMo Token Plan, WorkBuddy Credits, DeepSeek balance, ZCode·GLM Coding Plan.

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

## 构建 / Build from Source

前置：Node 18+、Rust (MSVC)、WebView2（Win11 预装）。

```bash
npm install
npm run tauri dev     # 开发（前端来自 localhost:5173）
npm run tauri build   # 产出 NSIS 安装包（src-tauri/target/release/bundle/nsis/）
```

安装包特性：中英双语选择、品牌开场动画、安装前自动关闭运行中的实例。

## 安全与隐私 / Security

- 凭证只入 Windows Credential Manager；日志零明文
- 仅 HTTPS + 主机白名单硬校验；SQL 参数绑定
- 会话 Cookie 只存应用专属隔离 WebView2 Profile，永不落盘/入日志
- 安全模型与威胁分析见 [SECURITY.md(SECURITY.md)

## 文档 / Docs

[ARCHITECTURE](docs/ARCHITECTURE.md) · [DATA_MODEL](docs/DATA_MODEL.md) · [PROVIDER_INTERFACE](docs/PROVIDER_INTERFACE.md) · [PORTABLE_FIRST](docs/PORTABLE_FIRST.md) · [REFRESH_STRATEGY](docs/REFRESH_STRATEGY.md) · [SECURITY(SECURITY.md) · 更多见 [docs/README](docs/README.md)

## 免责声明 / Disclaimer

MiMo / WorkBuddy / Codex 相关功能依赖各官方站点的非公开接口，接口变更可能导致对应功能失效（界面会如实提示）。本项目独立开发，与腾讯、OpenAI、Anthropic、DeepSeek、ZCode 无关。仅供个人额度监控使用——请遵守各服务商条款。

## License

[Apache-2.0](LICENSE)
