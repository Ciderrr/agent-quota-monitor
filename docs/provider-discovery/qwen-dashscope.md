# Provider Discovery — Qwen / 阿里云百炼（DashScope）

> 研究日期 2026-10-04 · 状态：**部分可行（P2，需阿里云 AccessKey + ACS3 签名）**
> 结论先行：余额查询有官方 OpenAPI（[获取账号详情](https://help.aliyun.com)，含余额），但采用 **ACS3-HMAC-SHA256 AccessKey 签名，不支持 Bearer API Key**；通义灵码订阅无公开用量 API。

## 1. 事实

- 余额：阿里云 OpenAPI「获取账号详情」——需 AccessKey（AK/SK），签名算法 ACS3-HMAC-SHA256（官方文档含参数示例）。
- Qwen 模型 token 用量：百炼控制台「用量管理」可设告警；API 拉取需 OpenAPI 签名同上。
- 通义灵码（Lingma）订阅额度：无公开 API。
- Qwen Code CLI（gemini-cli 分叉）：本地会话数据格式与 gemini-cli 同源——若未来做日志型接入可与 Gemini 路线共用解析器。

## 2. 实现代价评估

- ACS3 签名比 V4 简单（单步 HMAC），工作量可控。
- 凭据敏感度：阿里云主账号 AK/SK 权限极大——建议 RAM 子账号，需用户知情。

## 3. 结论

**P2 待办**：技术可行、有官方文档，但凭据敏感度高。待有百炼/灵码订阅的用户需求出现再启动。
