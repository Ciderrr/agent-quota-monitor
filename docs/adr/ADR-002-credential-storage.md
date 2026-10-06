# ADR-002 — 凭证存储：Windows Credential Manager（keyring）为主，DPAPI 为备

- 状态：Proposed（Gate B 评审）

## 决策

- **主**：Windows Credential Manager，经 `keyring` crate（Generic Credentials，服务名 `AgentQuotaMonitor`，条目 `<provider_id>/<slot>`）。OS 级隔离、标准工具可查看/删除、用户可自行审计。
- **备**：DPAPI（`CryptProtectData`，CurrentUser）加密文件，仅作为同一 trait 的第二实现保留（企业策略限制凭据管理器的环境）；不做设置项暴露。
- **禁止**：明文 SQLite/JSON/config/log/localStorage（CI 扫描强制，SECURITY §1）。

## 备选方案否决理由

| 方案 | 否决原因 |
|---|---|
| 明文配置文件 | 直接违反最高级约束 |
| 自研加密 + 机器内嵌密钥 | 密钥与密文同机 = 伪安全，审计观感差 |
| SQLite + DPAPI 列 | 可行但无增益；凭据管理器已覆盖且更标准 |
| 复用被监控客户端的凭证存储写接口 | 侵入第三方客户端，违反"不修改 Provider 客户端"红线 |

## 特例规则（读但不存）

Codex（`~/.codex/auth.json`）与 ZCode（`~/.zcode/v2/credentials.json`）的凭证：**每次刷新时实时读取、内存使用、绝不二次落盘**；绝不写回、绝不代刷新（refresh token 轮换风险）。这类"只读复用"不进入凭据管理器，Settings 中显示来源文件 + credential_id 别名。

## 后果

- keyring 在 Windows 上无额外依赖（凭据管理器系统组件）。
- 卸载不清凭据管理器条目 → 卸载器提供"清除全部数据"选项（SECURITY §9）。
- 测试：凭据 trait 的内存 mock 实现，单测无需真实系统凭据。
