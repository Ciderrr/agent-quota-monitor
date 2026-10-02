# ADR-003 — 本地数据库：SQLite（rusqlite bundled）

- 状态：Proposed（Gate B 评审）
- 日期：2026-09-28

## 决策

SQLite，经 `rusqlite`（bundled 特性，免系统依赖），WAL 模式，单连接 + 应用内串行写。库文件 `%APPDATA%\AgentQuotaMonitor\quota.db`。表结构与保留策略见 DATA_MODEL §3。

## 备选否决

| 方案 | 否决原因 |
|---|---|
| 不落库（纯内存） | History 功能需要跨重启聚合 |
| JSON/JSONL 文件 | 无索引/聚合查询能力，90 天数据量下查询与清理变脆 |
| SQLite HTTP 服务/嵌入式其他 DB | 超出需求；rusqlite 零外部依赖最简 |

## 设计约束

- 库中**永无凭证**（表结构固定，可机械审计）。
- 十进制数值以 TEXT 存储（精度安全），百分比 REAL。
- 迁移只增不破坏（`schema_migrations`）；`snapshots` 原始层 7 天、样本层 90 天、聚合层永久。
- 写入合并：每次快照一个事务；每日清理任务一次。
