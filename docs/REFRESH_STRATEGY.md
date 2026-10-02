# REFRESH_STRATEGY.md — 智能刷新策略

> 版本 0.2（Portable-first 修订）· 2026-09-28
> 目标：数据足够新鲜、系统几乎无感、绝不无休止高频请求。所有间隔都叠加 **±10% 抖动**避免固定节拍。
> **Portable 规则**：基线间隔完全不依赖本地 Agent；活动检测只是优化（PORTABLE_FIRST §6）——`Process detection = Refresh optimization`，绝不是 `Data source requirement`。

---

## 1. 基线间隔

| 场景 | 间隔 |
|---|---|
| Collapsed + idle（无活跃 Agent） | 5 min |
| Collapsed + 对应 Agent 活跃 | 45 s |
| Expanded（浮窗展开） | 60 s |
| DeepSeek 余额 | 5 min（不随活动加速；可用"充值事件"触发立即刷新） |
| 手动刷新 | 立即执行；之后进入 **10 s 冷却**（core 侧执行，UI 按钮置灰） |

用户全局覆盖设置：`Smart / 1 min / 5 min / 10 min`（Smart 为上表逻辑；固定档覆盖 idle 间隔，活动加速与展开加速仍生效但不低于 Provider `min_refresh`）。

### 每 Provider 修正（capabilities.recommended_refresh）

| Provider | 基线 | 说明 |
|---|---|---|
| Codex | 45–60 s（活跃）/ 5 min（空闲） | Managed runtime 推送为主、轮询兜底；**Clean PC（无本机 Agent）同样适用基线** |
| ZCode | 45–60 s / 5 min | 与官方插件同级负载；无本机 Agent 时相同 |
| MiMo Token Plan | 10–15 min | 会话型第一方接口（Undocumented），低频保守 |
| DeepSeek | 5 min 固定 | 官方余额，低频足够 |

## 2. 活动联动

- 活动信号：`ActivityState = Active | Idle | Unknown`（ARCHITECTURE §5，仅进程名/文件 mtime）。
- `Unknown`（如探测失败）按 Idle 处理，不惩罚。
- 状态切换到 Active 时：若距上次刷新 > 30 s，立即补一次（受 10 s 冷却约束）。
- 活动检测器自身节流 30 s；失败退避到 60 s。**活动状态不落库、不展示。**

## 3. 失败退避

连续失败序列（每 Provider 独立）：

```
30 s → 1 min → 2 min → 5 min → 10 min（封顶，之后保持 10 min 直至成功）
```

- 成功一次即清零回基线。
- 尊重 `Retry-After`（若 > 计算值则取较大者）。
- `AuthRequired/LoginExpired` 不视为可重试失败：停止自动重试，进入等待用户处理状态（错误角标 + 设置入口）。
- `RateLimited` 按退避序列并记录，避免触发 Provider 风控。
- 退避期间 UI 正常显示缓存 + stale。

## 4. 系统事件触发

| 事件 | 动作 |
|---|---|
| 系统唤醒（resume） | 全部启用 Provider 立即刷新一次（单次，10 s 内合并） |
| 网络恢复（connectivity 变化） | 同上 |
| 凭证更新/测试连接成功 | 该 Provider 立即刷新 |
| 设置更改刷新间隔 | 按新间隔重排（不清零冷却） |
| 笔记本电池 < 20% | 活动加速关闭，全部退到 ≥ 5 min（Smart 模式下） |

## 5. 去重与合并

- 同一 Provider 的触发（定时、活动、手动、系统事件）在 10 s 窗口内合并为一次执行。
- `Refresh all` 同理：10 s 内多次触发合并。
- 手动刷新冷却对"Refresh all"同样生效。

## 6. 与通知的耦合

刷新是唯一产生新快照的时机，通知判定在快照入库时执行（阈值 + 去重见 ARCHITECTURE core/notifications 与 DATA_MODEL `notification_state`）。退避不会导致重复通知（去重键独立于刷新次数）。

## 7. UI 呈现义务

- 设置页 Smart 说明文案：
  - 中文："根据 Agent 活跃状态自动调整刷新频率，以兼顾数据及时性和系统资源占用。"
  - English："Automatically adjusts refresh frequency based on agent activity to balance freshness and system resource usage."
- 详情页显示 "Updated Xs/Xm ago" + 下次刷新（可省略具体秒数，仅显示"约 N 分钟后"）。
- stale 状态（> 2× 当前间隔）必须可见（DATA_MODEL §2.6）。

## 8. 性能守则

- 调度器是**事件驱动**的：仅"到点"与"事件"两个入口，无忙等循环；睡眠期（全部间隔 ≥ 5 min 且无活动）完全静默。
- 禁止：固定 1 s tick 的"检查是否到点"循环（用 tokio `sleep_until` 精确挂起）、刷新期间阻塞 UI、后台无限队列（同一 Provider 同时只允许一个在途请求）。
