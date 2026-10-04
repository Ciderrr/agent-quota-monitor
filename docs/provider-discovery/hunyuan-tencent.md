# Provider Discovery — 腾讯混元

> 研究日期 2026-10-04 · 状态：**部分可行（P2，需腾讯云 SecretId/Key + TC3 签名）**
> 结论先行：无专门余额 API；可走腾讯云**账单/计费 API（Billing）**获取余额与消费明细，需 TC3-HMAC-SHA256 签名。

## 1. 事实

- 腾讯云无混元专用余额接口；Billing API 可取账户余额与消费明细（官方文档），需 TC3-HMAC-SHA256 签名（SecretId/SecretKey）。
- 开源参照：[ModelCost_Monitor](https://github.com/fwzm/ModelCost_Monitor)（桌面多厂商余额监控，含腾讯云）——签名与端点可抄。
- 混元 API 响应含 token 用量字段（每次调用自计）。

## 2. 结论

**P2 待办**：有可抄实现（ModelCost_Monitor），凭据敏感度同上（云主账号密钥）。待有混元用量监控需求的用户出现再启动。
