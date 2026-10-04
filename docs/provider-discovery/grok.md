# Provider Discovery — Grok（Lite / SuperGrok / Heavy）

> 研究日期 2026-10-04 · 状态：**暂不可实现（BLOCKED）**
> 结论先行：SuperGrok 系订阅**无任何公开用量查询 API**，也未发现成熟第三方监控方案。

## 1. 事实

- 订阅档位：Lite $10 / SuperGrok $30 / Plus $100 / Heavy $300/月；额度为**每周用量池**（[社区口径](https://blog.laozhang.ai)）。
- 用量提示只存在于 grok.com 页面内的「rate limit reached」提示，**无官方 endpoint**。
- xAI API（console.x.ai）的积分/余额是另一套体系（开发者 API 计费），与网页订阅不互通；也未见社区封装的余额端点。
- 未发现 GitHub 上的 grok 用量监控工具（多轮检索无果）。

## 2. 可能的未来路线（均为推测，无参照实现）

- grok.com 会话路线（WebView2 登录抓取页面余量）——页面无结构化余量展示，仅有触顶提示，可行性低。
- xAI console API 路线——需 xAI 官方开放相关端点。

## 3. 结论

**暂不实现**。待官方开放端点或社区出现可参照实现再评估。
