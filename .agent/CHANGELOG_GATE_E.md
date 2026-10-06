# CHANGELOG — Phase 3 / Gate E（Provider 实装 + 会话/运行时）

- 范围：Codex / MiMo / DeepSeek 打磨 + 托盘/设置/玻璃等 Gate D 反馈；ZCode 待真实 Key。  
- 状态：**主体完成，待用户 Gate E 终验**。

---

## 1. Codex（ADR-004 Managed Runtime）

| 项 | 实现 |
|---|---|
| 下载 | npm `@openai/codex@0.158.0-win32-x64` + sha512；解压完整 `bin/` 至 `%LOCALAPPDATA%\AgentQuotaMonitor\runtimes\codex\0.158.0\` |
| 隔离 | `CODEX_HOME=%LOCALAPPDATA%\AgentQuotaMonitor\codex-home`（不碰用户 `~/.codex`） |
| 登录 | `codex login`（专用 HOME）+ 浏览器 OAuth；进程保持至回调完成 |
| 读额度 | `codex app-server` → `initialize` + `account/rateLimits/read`；stdin 保持打开 |
| 映射 | `rateLimitsByLimitId` 全桶；300→5h、10080→weekly；`credits`→balances；`availableCount`→Reset×N |
| 断开 | 只清隔离目录 + 快照回登录失效；条目不删除；**禁止 account/logout 用户 CLI** |

## 2. MiMo（ADR-005）

- fixture 确认：`monthUsage.percent` **0–1**；`detail` 含 planCode / currentPeriodEnd  
- 预声明窗 `mimo-login` + 官方登录 + 同源 GET usage/detail  
- 回传：IPC `mimo_store_usage` / 自定义协议 `aqm://` / `event.emit`  
- 刷新按钮走会话读取；启动从 SQLite 恢复快照，避免重启变「需要登录」

## 3. DeepSeek / ZCode

- DeepSeek：真测试、余额通知、隐私清除含历史；文案明确无用量 API  
- ZCode：适配器就绪（裸 key、zai/bigmodel、Custom(raw)）；无真实 Key 未做验证轮

## 4. UI / 壳（Gate D 与本轮反馈）

- 圆角玻璃即窗口边界；玻璃不透明度 50%–140%；Apple 齿轮与开关  
- 设置独立窗；托盘左键呼出 / 右键菜单（置顶不关菜单）  
- 导航：详情返回默认层；统计按 Provider 过滤；未配置可点进设置 Providers  
- 统一 `start_window_drag`；改尺寸固定右边缘；禁用 WebView 默认右键菜单  
- ui-check：**18/18 PASS**

## 5. 安全

- 凭证只入 keyring / 隔离 CODEX_HOME / mimo WebView profile  
- 修复误提交浏览器 profile（含 Cookies）并 ignore  
- 绝不 `account/logout` 用户本机 Codex（已纠正为 monitor-only 断开）

## 6. 已知边界

1. ZCode 无真实 Key，字段语义仍为 Custom(raw)  
2. Codex 偶发 app-server 读超时需重试；5h 窗 100% 时 UI 显示满额  
3. 活动检测未做；性能正式测量在 Gate F  
4. `codex login` 换账号 = 换隔离 HOME 内登录，非多账号并行  

## 7. 验证建议（Gate E）

1. 四家主界面数据与详情  
2. 断开/重连 Codex、MiMo 刷新、DeepSeek 错误 Key  
3. 重启后额度是否还在  
4. 设置 → 测试连接、隐私清除  
