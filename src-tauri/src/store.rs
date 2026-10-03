// 本地 SQLite（DATA_MODEL §3）：Gate D 子集 = kv / balance_samples / snapshots。
// 任何表都不存凭证（SECURITY §1）。
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct Store {
    conn: Arc<Mutex<Connection>>,
}

impl Store {
    pub fn open() -> Result<Self, String> {
        let dir = dirs();
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        migrate_legacy_db(&dir);
        let path: PathBuf = dir.join("quota.db");
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS snapshots (
               provider_id TEXT NOT NULL, fetched_at INTEGER NOT NULL,
               schema_ver INTEGER NOT NULL, payload TEXT NOT NULL,
               PRIMARY KEY (provider_id, fetched_at));
             CREATE TABLE IF NOT EXISTS balance_samples (
               provider_id TEXT NOT NULL, ts INTEGER NOT NULL, currency TEXT NOT NULL,
               total TEXT, granted TEXT, topped_up TEXT, available_flag INTEGER,
               PRIMARY KEY (provider_id, ts, currency));
             CREATE INDEX IF NOT EXISTS idx_balance_ts ON balance_samples(provider_id, ts);",
        )
        .map_err(|e| e.to_string())?;
        Ok(Self { conn: Arc::new(Mutex::new(conn)) })
    }

    pub fn kv_get(&self, key: &str) -> Option<String> {
        let c = self.conn.lock().ok()?;
        c.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0)).ok()
    }

    pub fn kv_set(&self, key: &str, value: &str) {
        if let Ok(c) = self.conn.lock() {
            let _ = c.execute(
                "INSERT INTO kv(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
                [key, value],
            );
        }
    }

    pub fn insert_snapshot(&self, provider_id: &str, payload: &str) {
        if let Ok(c) = self.conn.lock() {
            let ts = chrono::Utc::now().timestamp_millis();
            let _ = c.execute(
                "INSERT OR REPLACE INTO snapshots(provider_id, fetched_at, schema_ver, payload) VALUES(?1, ?2, 1, ?3)",
                rusqlite::params![provider_id, ts, payload],
            );
        }
    }

    /// 余额样本（十进制以 TEXT 存，精度安全）
    pub fn insert_balance_sample(
        &self, provider_id: &str, currency: &str,
        total: Option<String>, granted: Option<String>, topped_up: Option<String>, available: Option<bool>,
    ) {
        if let Ok(c) = self.conn.lock() {
            let ts = chrono::Utc::now().timestamp_millis();
            let _ = c.execute(
                "INSERT OR REPLACE INTO balance_samples(provider_id, ts, currency, total, granted, topped_up, available_flag)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![provider_id, ts, currency, total, granted, topped_up, available.map(|b| b as i64)],
            );
        }
    }

    /// 启动时恢复各 Provider 最近一次快照
    pub fn load_latest_snapshots(&self) -> Vec<(String, String)> {
        let Ok(c) = self.conn.lock() else {
            return vec![];
        };
        let mut stmt = match c.prepare(
            "SELECT provider_id, payload FROM snapshots s
             WHERE fetched_at = (SELECT MAX(fetched_at) FROM snapshots x WHERE x.provider_id = s.provider_id)",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        });
        match rows {
            Ok(it) => it.filter_map(|x| x.ok()).collect(),
            Err(_) => vec![],
        }
    }

    /// 清除某 Provider 的历史（换 Key / 清除凭证时调用，避免旧账号数据混入）
    pub fn purge_provider_history(&self, provider_id: &str) {
        if let Ok(c) = self.conn.lock() {
            let _ = c.execute("DELETE FROM balance_samples WHERE provider_id = ?1", [provider_id]);
            let _ = c.execute("DELETE FROM snapshots WHERE provider_id = ?1", [provider_id]);
        }
    }

    /// 从 snapshots 表提取额度百分比序列（真实存档渲染，不造假数据）。
    /// 返回 (bucket_id, 桶标题, [(ts_ms, remaining_percent)])；每天每个 tick 的快照都在库里。
    pub fn quota_series(&self, provider_id: &str, days: i64) -> Vec<(String, String, Vec<(i64, f64)>)> {
        let c = self.conn.lock().ok();
        let Some(c) = c else { return vec![] };
        let since = chrono::Utc::now().timestamp_millis() - days * 86_400_000;
        let mut stmt = match c.prepare(
            "SELECT fetched_at, payload FROM snapshots WHERE provider_id = ?1 AND fetched_at >= ?2 ORDER BY fetched_at",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        let rows: Vec<(i64, String)> = stmt
            .query_map([provider_id, &since.to_string()], |r| Ok((r.get(0)?, r.get(1)?)))
            .ok()
            .map(|it| it.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();

        let mut per_bucket: std::collections::BTreeMap<String, (String, Vec<(i64, f64)>)> = std::collections::BTreeMap::new();
        for (ts, payload) in rows {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&payload) else { continue };
            let Some(buckets) = v.get("quotaBuckets").and_then(|b| b.as_array()) else { continue };
            for b in buckets {
                let Some(id) = b.get("id").and_then(|x| x.as_str()) else { continue };
                let Some(pct) = b.get("remainingPercent").and_then(|x| x.as_f64()) else { continue };
                let title = quota_bucket_title(b);
                per_bucket.entry(id.to_string()).or_insert_with(|| (title, vec![])).1.push((ts, pct));
            }
        }
        per_bucket.into_iter().map(|(id, (title, pts))| (id, title, pts)).collect()
    }

    /// 余额原始序列（v0.2 余额趋势预测）：近 N 天 (ts_ms, total)，不去重到天
    pub fn balance_series_raw(&self, provider_id: &str, days: i64) -> Vec<(i64, f64)> {
        let c = self.conn.lock().ok();
        let Some(c) = c else { return vec![] };
        let since = chrono::Utc::now().timestamp_millis() - days * 86_400_000;
        let mut stmt = match c.prepare(
            "SELECT ts, total FROM balance_samples WHERE provider_id = ?1 AND ts >= ?2 AND total IS NOT NULL ORDER BY ts",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        let rows: Vec<(i64, String)> = stmt
            .query_map([provider_id, &since.to_string()], |r| Ok((r.get(0)?, r.get(1)?)))
            .ok()
            .map(|it| it.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();
        rows.into_iter()
            .filter_map(|(ts, t)| t.parse::<f64>().ok().map(|v| (ts, v)))
            .collect()
    }

    /// 近 N 天余额序列（History；只如实呈现，不做差值推算——Gate A.1 规则）
    pub fn balance_series(&self, provider_id: &str, days: i64) -> Vec<(String, f64)> {        let c = self.conn.lock().ok();
        let Some(c) = c else { return vec![] };
        let since = chrono::Utc::now().timestamp_millis() - days * 86_400_000;
        let mut stmt = match c.prepare(
            "SELECT ts, total FROM balance_samples WHERE provider_id = ?1 AND ts >= ?2 ORDER BY ts",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        let rows: Vec<(i64, String)> = stmt
            .query_map([provider_id, &since.to_string()], |r| Ok((r.get(0)?, r.get(1)?)))
            .ok()
            .map(|it| it.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();
        // 按日取最后一点
        let mut out: Vec<(String, f64)> = vec![];
        for (ts, total) in rows {
            let st = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_millis(ts as u64);
            let day = chrono::DateTime::<chrono::Local>::from(st).format("%m/%d").to_string();
            let v = total.parse::<f64>().unwrap_or(0.0);
            match out.last_mut() {
                Some((d, val)) if *d == day => *val = v,
                _ => out.push((day, v)),
            }
        }
        out
    }
}

fn dirs() -> PathBuf {
    // 数据随安装目录走（用户要求，重装/卸载语义清晰）：
    // <exe 目录>\data\；目录不可写（如机器级安装进 Program Files）则回退 %APPDATA%\AgentQuotaMonitor。
    if let Ok(exe) = std::env::current_exe() {
        if let Some(install) = exe.parent() {
            let data = install.join("data");
            if std::fs::create_dir_all(&data).is_ok() {
                let probe = data.join(".write-test");
                if std::fs::write(&probe, b"ok").is_ok() {
                    let _ = std::fs::remove_file(&probe);
                    return data;
                }
            }
        }
    }
    legacy_dir()
}

fn legacy_dir() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("AgentQuotaMonitor")
}

/// 一次性迁移：首次在安装目录内建库时，把旧 %APPDATA% 的 quota.db（含 wal/shm）搬过来，
/// 用户既有历史不丢；之后旧目录不再使用。
fn migrate_legacy_db(portable_dir: &PathBuf) {
    let legacy = legacy_dir();
    if legacy == *portable_dir {
        return;
    }
    let target = portable_dir.join("quota.db");
    if target.exists() {
        return;
    }
    let src = legacy.join("quota.db");
    if !src.exists() {
        return;
    }
    if std::fs::copy(&src, &target).is_ok() {
        for suffix in ["-wal", "-shm"] {
            let from = legacy.join(format!("quota.db{suffix}"));
            if from.exists() {
                let _ = std::fs::copy(&from, portable_dir.join(format!("quota.db{suffix}")));
            }
        }
        eprintln!("[aqm] migrated legacy db from {} -> {}", legacy.display(), portable_dir.display());
    }
}

/// 桶标题：labelRaw + 周期（rolling 300→"5h"、weekly→"weekly"、custom→raw）
fn quota_bucket_title(b: &serde_json::Value) -> String {
    let period = match b.get("periodType") {
        Some(p) => match p.get("kind").and_then(|k| k.as_str()) {
            Some("rolling") => {
                let m = p.get("windowMins").and_then(|x| x.as_i64()).unwrap_or(0);
                if m % 1440 == 0 && m > 0 { format!("{}d", m / 1440) }
                else if m % 60 == 0 && m > 0 { format!("{}h", m / 60) }
                else { format!("{m}m") }
            }
            Some("weekly") => "weekly".into(),
            Some("daily") => "daily".into(),
            Some("monthly") => "monthly".into(),
            _ => p.get("raw").and_then(|r| r.as_str()).unwrap_or("").to_string(),
        },
        None => String::new(),
    };
    let raw = b.get("labelRaw").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
    if raw.is_empty() { period }
    else if period.is_empty() || raw == period { raw }
    else { format!("{raw} · {period}") }
}
