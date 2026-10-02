# CHANGELOG — Phase 2 / Gate D（DeepSeek 垂直切片 + Tauri 壳）

- 日期：2026-09-28
- 范围：真实 Rust 后端 + 浮窗壳 + DeepSeek 端到端；**停止在 Gate D 等待审查**。未进入 Phase 3（Codex Managed Runtime / ZCode 实测 / MiMo fixture）。

---

## 1. 工具链（开发机一次性安装；最终用户不需要）

- rustup + stable-x86_64-pc-windows-msvc（rustc 1.98.1）
- VS Build Tools 2022 + MSVC 14.44（winget 静默安装）
- 最终用户只需 NSIS 安装包；运行时唯一依赖 WebView2（Win11 预装）

## 2. Tauri 2 壳（src-tauri/）

| 能力 | 实现 |
|---|---|
| 浮窗 | 透明、无边框、skipTaskbar、置顶可切、右上角定位（主显示器 -24px）、尺寸随视图层级调整（300×250 ↔ 360×660） |
| 材质 | window-vibrancy：Mica → Acrylic → 纯透明 降级链 |
| 托盘 | 显示 / 全部刷新 / 窗口置顶 ✓ / 退出；单实例插件（二次启动唤起窗口） |
| 安全基线 | CSP `default-src 'self'`；IPC 域名白名单（open_external）；HTTP 白名单硬校验（http.rs，仅 https） |
| 事件 | `snapshot-updated` → UI 被动刷新（零轮询） |

## 3. core（Rust）

- **credentials.rs**：Windows Credential Manager（keyring v3，`AgentQuotaMonitor/<provider>/<slot>`）
- **http.rs**：15s 超时客户端 + `assert_allowed` 主机白名单 + redact 脱敏
- **store.rs**：SQLite（WAL）—— kv / snapshots / balance_samples（十进制 TEXT 存储）
- **scheduler.rs**：30s 节拍事件驱动 tick；per-provider 退避 30s→1m→2m→5m→10m（成功清零）；±10% 抖动；余额阈值通知（notification_state 去重）
- **deepseek.rs**：官方 `GET /user/balance`（Bearer key）→ Balance DTO（Official）；401/429/5xx/网络 → 九种错误态映射；**仅余额 + 余额历史，不做差值推算**
- **zcode.rs**（提前实现最小面）：`GET /api/monitor/usage/quota/limit` 裸 key + 区域族主机；HTTP 200 包体判错；未知 type/unit → `Custom(raw)` + 通用标签（Gate A.1 规则）
- codex / mimo：NotConfigured 占位快照（Phase 3 / ADR-005 fixture 后实装）

## 4. UI 接线（零破坏切换）

- `PlatformBridge` 双实现：MockBridge（浏览器原型）↔ TauriBridge（真实壳，invoke + event），`isTauri` 自动选择
- 凭证输入（Connect DeepSeek/ZCode）→ IPC 直通 keyring；React 不保留
- History：DeepSeek 余额折线来自**真实 SQLite 序列**
- MiMo 演示读取按钮仅在浏览器原型显示（真实壳不提供假流程）
- 原型控制条在真实壳自动隐藏

## 5. 运行方式

```bash
npm install
npm run tauri dev     # 需先关闭占用 5173 的其他 vite 实例
# 或在 5173 已有 vite 时直接运行编译产物：
# src-tauri/target/debug/agent-quota-monitor.exe
```

## 6. 性能基线（dev 构建，详见 docs/performance.md）

- 常驻进程 1 个；进程内存 ≈ 35 MB（dev 含调试符号）
- 完整指标矩阵 Gate F 出正式报告

## 7. 已知边界与残余事项

1. Codex/ZCode/MiMo 快照在真实壳中为"未配置"占位（按计划 Phase 3 实装）。
2. `set_settings` 的阈值/默认视图持久化到 SQLite 已实现，启动恢复已接（kv "settings"）。
3. 前端沿用手工同步的 TS 镜像类型（Phase 3 引入 ts-rs/specta 生成）。
4. cargo 编译 3 个 unused 警告（Gate F 清理）。
5. 通知 仅实现 DeepSeek 余额阈值；额度百分比阈值随各 Provider 实装启用。

## 8. 状态

**停止在 Gate D。** 请审查：真实浮窗外观与 Mica 材质、DeepSeek 凭证录入 → 余额显示 → 余额历史全链路、托盘与置顶、错误态（错误 key / 断网）。通过后进入 Phase 3（Gate E）。
