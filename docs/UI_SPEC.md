# UI_SPEC.md — 视觉与交互规范

> 版本 0.1（Phase 0）
> 一句话定位：**Apple Control Center 的克制 × Apple Widget 的信息密度 × Windows 11 Mica 的材质**。它应当像系统级 Widget，而不是被塞进小窗口的 Web 应用。
> 验收红线：功能完成但看起来像普通 Electron 管理后台 = 项目未完成（Gate C 一票否决项）。

---

## 1. 视觉原则

- 克制、留白、信息层级清晰、大圆角、柔和阴影、半透明、低饱和、极少边框、细腻短动画、高质量排版、零视觉噪声。
- **禁止**：传统后台管理系统 / Dashboard 卡片海 / 左侧 Sidebar / RGB 配色 / 五颜六色 Provider 卡 / 厚重 border / 密集表格 / Bootstrap 与 Material 风格组件 / Win98 质感 / "程序员工具"式粗糙 UI。
- 颜色永远不是唯一状态表达（§6 配色原则），必须伴随图标/文字/形态变化（无障碍要求）。

## 2. 窗口几何

| 项 | Collapsed | Expanded |
|---|---|---|
| 宽度 | 264 px | 320 px |
| 高度 | 24 + N×44 + 12（N = 启用 Provider 数） | 自适应，最大 72% 工作区高，内部滚动 |
| 圆角 | 20 px（外层统一；Expanded 24 px） | 同左 |
| 默认位置 | 主显示器右上角，边距 24 px（用户可拖动，位置持久化） | 展开动画从对应卡片位置生长（240 ms） |
| 材质 | Mica（降级：Acrylic → 半透明纯色），阴影 `0 8px 32px rgba(0,0,0,.14)`，1 px 内描边 `rgba(255,255,255,.06)`（仅 Dark） | 同左 |

两态切换为同一窗口内容重排（不新建窗口）；点击 Collapse 区域收起，Esc 收起，失焦是否收起由设置决定（默认收起，Desktop Mode 下可选保持）。

## 3. Collapsed（1 秒内知道"谁快没额度了"）

结构（每 Provider 一行，44 px 高）：

```
┌──────────────────────────────────────────┐
│ ◉ Codex            72% ▁▁▁▁▂▂▃▃▄▄▅▅░░░  │   ← 图标 + 名称 + 主数值 + 微型槽条
│ ◉ ZCode            81%  …                │
│ ◉ MiMo             67%  …                │
│ ◉ DeepSeek         ¥53.27                │   ← 余额型显示金额而非百分比
└──────────────────────────────────────────┘
```

- 图标 16 px 单色（跟随前景色，不用彩色 logo——避免花哨）；名称 12 px 次级色；数值 13 px 主色、`tabular-nums`。
- 主数值选择规则：多桶取**最紧急桶**（剩余 %最低；余额型直接显示金额）；悬停提示完整桶列表。
- 每行右侧 36×4 px 超细槽条（非进度条主角，纯辅助形态线索）；余额型无槽条。
- 异常行：错误角标（8 px 圆点或图标）+ 数值位显示错误短词（如"未配置"）；stale 时整行透明度 0.55 + 时间徽标。
- 空状态（全部 Provider 未启用）：居中一行"未监控任何 Provider → 前往设置"（16 px 高度留白呼吸感，不放插画）。
- 不放：标题栏、关闭按钮（右键菜单/托盘承担）、刷新按钮、图表。

## 4. 设计 Token（CSS 变量）

```css
/* 中性（主体）——低饱和，跟随主题 */
--bg-canvas:      mica / rgba(28,28,30,0.72) dark | rgba(249,249,251,0.78) light
--fg-primary:     rgba(255,255,255,0.92) dark | rgba(0,0,0,0.88) light
--fg-secondary:   58% alpha of fg-primary
--fg-tertiary:    36% alpha
--stroke-subtle:  rgba(255,255,255,0.06) dark | rgba(0,0,0,0.06) light

/* 状态——同一低饱和色相，靠明度分层；绝不整片色块 */
--state-warn:     #c9a227 → 实际用 alpha 12% 底 + 前景 85% 亮度版本
--state-critical: #c25b4e（低饱和赤陶色，非纯红）
--state-accent:   跟随系统 accent（仅焦点环与开关，不用于状态）

/* 字体 */
--font-ui: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif
--font-num: "Segoe UI Variable Display", tabular-nums
字号阶梯：11 / 12 / 13 / 15 / 20（详情页主数值 20 px Medium）

/* 间距：4 的倍数；行内 8、行间 4、区块 12、页边 16 */
/* 圆角：控件 8 / 卡内 12 / 窗口 20–24 */
/* 动效：fast 160ms / standard 240ms；ease-out cubic；仅 transform+opacity */
```

## 5. Expanded（点开 Provider 或"展开"）

单个 Provider 详情（默认展开 Collapsed 中最紧急者）：

```
┌────────────────────────────────────────┐
│ ←   OpenAI Codex            ⓘ Official │   ← 返回 + 名称 + 数据来源徽标
│                                        │
│ 5 小时                    Reset in 2h 14m │
│ 72%  ──────────────●────                │   ← 220px 细进度条（高 4px，圆头）
│                                        │
│ 本周                       Tue 09:18 重置 │
│ 43%  ──────────────●────                │
│                                        │
│ Reset ×2  （30 天后过期 1 次）            │   ← 只读文本，不可点击、无按钮
│                                        │
│ Updated 38s ago · Official              │
│ Open Usage Page ↗          Refresh ⟳   │   ← 次级文字按钮，非视觉主角
└────────────────────────────────────────┘
```

- 每个额度桶：标签（i18n 周期名或 Provider 原名）+ 剩余 %（大号）+ 重置时间相对表述（"2h 14m 后"/"周二 09:18"）+ 细进度条。
- 进度条 vs 圆环 vs 纯排版：默认**细进度条**（窄窗体下信息密度最优）；圆环保留给单桶 Provider（如 MiMo 月度）；纯排版用于余额型。不为"有图表"堆图表。
- Reset ×N：普通文本行 + "仅监控"微提示（首次出现时）；**任何状态下都不是按钮**。
- 数据来源徽标：默认只在详情页显示（Official / Derived / Estimated from local activity / 手动）；Collapsed 不放（信息噪声）。
- 底部操作：Refresh（次级）、Open Usage Page（次级、外链图标）。设置入口放 Collapsed 右键菜单与托盘。

## 6. 状态视觉

| 状态 | 表达（叠加使用，不只靠颜色） |
|---|---|
| 正常 | 前景色数值；槽条中性 |
| 剩余 < 20% | warn：数值染 --state-warn（85% 亮度）、槽条尾段 12% alpha warn 底、无图标变化 |
| 剩余 < 10% | critical：数值染 --state-critical + 数值后 8 px 空心圆点；槽条尾段加深 |
| Stale | 整行/整卡 opacity .55 + "18m 前" 徽标 |
| 错误 | 数值位替换为错误短词（11 px tertiary 色）+ 8 px 圆点（critical 色描边） |
| Unsupported / 未配置 | 单行卡片："暂不支持 · Open Usage Page ↗"（次级色，不占 44px 数值行） |
| 登录失效 | "登录已失效 · 重新登录"文字链接（跳设置对应页） |

对比度全部满足 WCAG AA（正文 ≥ 4.5:1；半透明底按最差底色校验）。可访问性：状态同时有颜色 + 形态（圆点/文字）+ 文本（详情页完整描述），不只靠颜色传达。

## 7. 动效规范

| 场景 | 规格 |
|---|---|
| Collapsed ↔ Expanded | 高度/宽度重排 240 ms ease-out + 内容 80 ms 淡入 |
| 数值变化 | 300 ms 数值滚动（仅展开态；折叠态直接切换避免常驻动画） |
| 进度条变化 | 300 ms width 过渡 |
| 通知/错误出现 | 8 px 上移 + 淡入 160 ms |
| Reduce Motion | 以上全部退化为 ≤ 80 ms 淡入或直接切换（`prefers-reduced-motion`） |

无任何循环/呼吸/加载常驻动画。加载态 = 内容区 shimmer 一次性（≤ 1s）或直接骨架静态显示。

## 8. 页面：Settings / History

**Settings**（单窗口 560×640，与浮窗同材质；左侧为纯文字锚点列表非 Sidebar）：
- General：开机自启（默认关）、语言（Auto/zh-CN/en）、主题（Auto/Light/Dark）、窗口模式（Desktop/Always on Top）
- Providers：每行 = 启用开关 + 名称 + 连接状态词 + "测试连接" + 凭证管理（输入框前置强制安全提示模态）
- Refresh：Smart / 1 / 5 / 10 min 单选 + Smart 说明文案（REFRESH_STRATEGY §7 逐字文案）
- Notifications：总开关、每 Provider 开关、阈值（20%/10% 预设 + DeepSeek 金额自定义输入）
- Privacy：凭证状态列表（credential_id + 清除按钮）、Local First 一句话说明、"打开数据文件夹"
- About：版本、GitHub 链接、开源许可

**History**（展开态内第三 tab 或独立窗口，v1 三个档位 Today / 7 Days / 30 Days）：
- 按 Provider 分组的极简条形（7/30 天）与大数字（Today）；维度分列：Tokens / Credits / Money / Quota %——**不同单位永不合列**；某 Provider 无某维度数据则该维度整组不显示（不显示虚假 total）。
- 空态："数据积累中，首次记录于 X"（有则显示）或"暂无数据"。

## 9. Mock 数据集（Gate C 原型固定场景，Portable-first 版）

| 场景 | 数据 |
|---|---|
| codex-ok | 5 Hours 90% remaining（Reset in 3h 12m）、Weekly 76% remaining（Reset in 4d）、GPT Reserve 94% remaining、Reset ×2、Official |
| zcode-ok | 5 Hours 81%、Weekly 64% + reset countdown、Official |
| mimo-ok | Pro · Monthly 67% remaining · 38B Credits total · renew date、Official-source（Undocumented first-party 披露） |
| deepseek-ok | ¥53.27 Available（Granted ¥3.27 / Topped up ¥50.00）、Official |
| codex-low | 5 Hours 8%（critical 态） |
| zcode-stale | 缓存 81% + "18m 前" + TemporarilyUnavailable 角标 |
| codex-login-expired | "登录已失效 · 重新登录" |
| deepseek-empty | 未配置（NotConnected）态 |
| mimo-validating | Connect MiMo 显示"Automatic usage monitoring is being validated"（无假登录按钮） |
| all-off | Collapsed 空状态 |
| light / dark | 以上全部 × 两主题 |
| zh / en | 以上全部 × 两语言 |

Provider 列表仅四个：**Codex / ZCode / MiMo Token Plan / DeepSeek**（MiMo Desktop Membership 不出现在任何界面）。

## 9a. Connect Provider 页面（首次连接，本轮新增强制项）

| 页面 | 内容 |
|---|---|
| Connect Codex | Codex 身份头（logo/monogram）+ 主按钮 **Sign in with ChatGPT** + 辅助说明 "No local Codex installation required."（中文："无需在本地安装 Codex。"）+ 次级"使用 API Key"入口 |
| Connect ZCode | Coding Plan API Key 输入框 + 安全提示（§32 克制文案）+ Test connection + Save securely |
| Connect DeepSeek | API Key 输入框 + 安全提示 + Test connection |
| Connect MiMo | Round 2 路线验证成功 → "Sign in to Xiaomi MiMo"（打开官方登录页 + §11 固定文案）；**尚未验证 → 显示 "Automatic usage monitoring is being validated."（不提供假的登录按钮）** |

安全提示规范（§32）：不用巨大警告框；Apple 风格克制辅助文案——"密钥只保存在本机（Windows 安全凭据存储），不会上传到任何服务器，也不会出现在日志中。"/ "Your key stays on this device in Windows secure credential storage — never uploaded, never logged."

## 10. i18n 键表（核心节选；组件零硬编码文案）

| key | zh-CN | en |
|---|---|---|
| period.rolling_5h | 5 小时 | 5 hours |
| period.weekly / monthly / billing_cycle | 本周 / 本月 / 本账期 | This week / This month / This billing cycle |
| quota.reset_in | {time}后重置 | Resets in {time} |
| quota.reset_at | {datetime} 重置 | Resets {datetime} |
| reset.opportunities | Reset ×{n} | Reset ×{n} |
| reset.monitor_only_note | 仅显示，不会自动使用 | Display only — never used automatically |
| state.updated_ago | {time}前更新 | Updated {time} ago |
| state.stale | 数据可能过期 | Data may be stale |
| source.official / derived / estimated | 官方 / 推算 / 估算 | Official / Derived / Estimated |
| error.* | 九种错误文案（DATA_MODEL §2.6 表） | 同左 |
| settings.refresh.smart_desc | 根据 Agent 活跃状态自动调整刷新频率，以兼顾数据及时性和系统资源占用。 | Automatically adjusts refresh frequency based on agent activity to balance freshness and system resource usage. |
| security.credential_notice | 该凭证仅保存在你的 Windows 本机安全凭据存储中，不会上传到任何第三方服务器。本应用不会记录或同步你的完整凭证。 | This credential is stored only in the secure credential storage on your Windows device. It is never uploaded to our servers, logged, or synchronized. |
| tray.show / refresh_all / always_on_top / settings / quit | 显示 / 全部刷新 / 窗口置顶 / 设置 / 退出 | Show / Refresh all / Always on top / Settings / Quit |
| history.today / 7d / 30d | 今天 / 近 7 天 / 近 30 天 | Today / 7 days / 30 days |

Provider 官方套餐名（"GLM Pro"、"Spark"、档位名）保留原文不翻译（`label_raw`）。

## 11. 可访问性与 DPI 验收矩阵

- 支持 125% / 150% / 175% 缩放：浮窗尺寸按逻辑像素自动放大；验收截图四档。
- 键盘：Tab 遍历行/按钮（焦点环 2 px accent，仅键盘导航时显示）；Esc 收起；`Ctrl+R` 刷新（注册为窗口快捷键而非全局）。
- 屏幕阅读器：每行 aria-label = "Codex，5 小时额度剩余 72%，2 小时 14 分后重置"；错误态有 role=status。
- 对比度 AA；Reduce Motion 生效；主题切换即时响应系统。

## 12. 视觉验收清单（Gate C 逐项打勾）

Collapsed / Expanded / Settings / History / 错误态（≥3 种）/ 空态 / Light / Dark / 125% / 150% / 175% / Reduce Motion / 键盘导航全流程 / 长期驻桌静默感（放置 24h 截图对比）。
评价维度：视觉层级、间距、字体、信息密度、材质、动效、交互、一致性、安静程度——"能用"不通过。
