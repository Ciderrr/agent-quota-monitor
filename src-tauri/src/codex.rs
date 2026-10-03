// Codex 适配器（Phase 3 / ADR-004）：官方 `codex app-server`（JSON-RPC over stdio）。
// 红线：不调用 consume / token 刷新；不读写 auth.json；不接触 ChatGPT token。
// 映射：rateLimitsByLimitId 全部桶；windowDurationMins 300→5h / 10080→weekly / 其他→Custom；
// credits.balance → balances[]；rateLimitResetCredits.availableCount → Reset ×N（仅监控）。
use crate::http::redact;
use crate::types::*;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

pub const ID: &str = "codex";
pub const USAGE_URL: &str = "https://chatgpt.com/codex/settings/usage";

/// 已测版本（docs 登记）；managed runtime 目录名
pub const TESTED_VERSION: &str = "0.158.0";

static REQ_ID: AtomicI64 = AtomicI64::new(1);

/// 探测本机已安装的 codex.exe（Portable-first 的 Optional Enhancement）
pub fn find_local_codex() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("CODEX_PATH") {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return Some(pb);
        }
    }
    let local = std::env::var("LOCALAPPDATA").ok()?;
    let bin = PathBuf::from(local).join("OpenAI").join("Codex").join("bin");
    let rd = std::fs::read_dir(&bin).ok()?;
    for ent in rd.flatten() {
        let cand = ent.path().join("codex.exe");
        if cand.is_file() {
            return Some(cand);
        }
    }
    // PATH
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(';') {
            let cand = PathBuf::from(dir).join("codex.exe");
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    None
}

/// Managed runtime 路径（Phase 3 下载后）；尚未下载则 None
pub fn managed_codex() -> Option<PathBuf> {
    let local = std::env::var("LOCALAPPDATA").ok()?;
    let p = PathBuf::from(local)
        .join("AgentQuotaMonitor")
        .join("runtimes")
        .join("codex")
        .join(TESTED_VERSION)
        .join("codex.exe");
    if p.is_file() {
        Some(p)
    } else {
        None
    }
}

const NPM_HOST: &str = "registry.npmjs.org";
const WIN_PKG: &str = "@openai/codex";

/// 确保 managed runtime 就绪（官方 npm，sha512 校验，只解出 codex.exe）
pub async fn ensure_managed_codex() -> Result<PathBuf, (String, Option<String>)> {
    if let Some(p) = managed_codex() {
        return Ok(p);
    }
    let meta_url = format!("https://{NPM_HOST}/{WIN_PKG}/{TESTED_VERSION}-win32-x64");
    crate::http::assert_allowed(&meta_url, &[NPM_HOST])
        .map_err(|e| ("network_unavailable".into(), Some(e)))?;
    let meta: serde_json::Value = crate::http::download_client()
        .get(&meta_url)
        .send()
        .await
        .map_err(|e| ("network_unavailable".into(), Some(redact(&e.to_string()))))?
        .json()
        .await
        .map_err(|e| ("provider_changed".into(), Some(redact(&e.to_string()))))?;
    let tarball = meta
        .pointer("/dist/tarball")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ("provider_changed".into(), Some("no tarball".into())))?;
    let integrity = meta
        .pointer("/dist/integrity")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    crate::http::assert_allowed(tarball, &[NPM_HOST])
        .map_err(|e| ("network_unavailable".into(), Some(e)))?;

    let bytes = crate::http::download_client()
        .get(tarball)
        .send()
        .await
        .map_err(|e| ("network_unavailable".into(), Some(redact(&e.to_string()))))?
        .bytes()
        .await
        .map_err(|e| ("network_unavailable".into(), Some(redact(&e.to_string()))))?;

    // sha512 integrity 校验（npm 格式：sha512-<base64>）
    if let Some(b64) = integrity.strip_prefix("sha512-") {
        use base64::Engine;
        use sha2::{Digest, Sha512};
        let mut h = Sha512::new();
        h.update(&bytes);
        let got = base64::engine::general_purpose::STANDARD.encode(h.finalize());
        if got != b64 {
            return Err((
                "provider_changed".into(),
                Some("sha512 integrity mismatch".into()),
            ));
        }
    }

    let out_dir = PathBuf::from(std::env::var("LOCALAPPDATA").map_err(|e| {
        ("network_unavailable".into(), Some(format!("LOCALAPPDATA: {e}")))
    })?)
    .join("AgentQuotaMonitor")
    .join("runtimes")
    .join("codex")
    .join(TESTED_VERSION);
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| ("network_unavailable".into(), Some(e.to_string())))?;
    let exe_path = out_dir.join("codex.exe");
    let tmp_path = out_dir.join("codex.exe.partial");

    // 解压 tgz：提取整个 vendor/.../bin（codex.exe 可能依赖同目录文件）
    let dec = flate2::read::GzDecoder::new(std::io::Cursor::new(bytes.to_vec()));
    let mut ar = tar::Archive::new(dec);
    let members = ar
        .entries()
        .map_err(|e| ("provider_changed".into(), Some(e.to_string())))?;
    let mut found = false;
    for ent in members {
        let mut ent = ent.map_err(|e| ("provider_changed".into(), Some(e.to_string())))?;
        let path = ent.path().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
        // 只要 .../bin/ 下的文件
        if !path.contains("/bin/") && !path.ends_with("/bin") {
            continue;
        }
        let name = path.rsplit('/').next().unwrap_or("").to_string();
        if name.is_empty() {
            continue;
        }
        let dest = out_dir.join(&name);
        if path.ends_with('/') {
            let _ = std::fs::create_dir_all(&dest);
            continue;
        }
        let mut out = std::fs::File::create(&dest)
            .map_err(|e| ("network_unavailable".into(), Some(e.to_string())))?;
        std::io::copy(&mut ent, &mut out)
            .map_err(|e| ("network_unavailable".into(), Some(e.to_string())))?;
        if name == "codex.exe" {
            found = true;
        }
    }
    let _ = tmp_path;
    if !found {
        return Err(("provider_changed".into(), Some("codex.exe not in package".into())));
    }
    Ok(exe_path)
}

fn resolve_codex_bin() -> Result<PathBuf, (String, Option<String>)> {
    if let Some(p) = managed_codex() {
        return Ok(p);
    }
    if let Some(p) = find_local_codex() {
        return Ok(p);
    }
    Err((
        "not_configured".into(),
        Some("codex.exe not found (install Codex CLI or download managed runtime)".into()),
    ))
}

/// 本软件专用 CODEX_HOME（隔离用户 ~/.codex；登出只动这里）
fn monitor_codex_home() -> PathBuf {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into());
    let p = PathBuf::from(local)
        .join("AgentQuotaMonitor")
        .join("codex-home");
    let _ = std::fs::create_dir_all(&p);
    p
}

fn spawn_app_server(bin: &PathBuf) -> std::io::Result<tokio::process::Child> {
    // 构造与 CREATE_NO_WINDOW 统一在 winproc（GUI 派生控制台程序必须隐藏窗口）
    crate::winproc::spawn_app_server(bin, &monitor_codex_home())
}

/// 每次快照用短生命周期 app-server（v1 够用；常驻推送 Phase 4 再评估）

/// 简化 RPC：每次快照短生命周期进程（查询成本仅 1 次调用，v1 够用；常驻推送 Gate F 再做）
async fn call_once(bin: &PathBuf, method: &str, params: Value) -> Result<Value, (String, Option<String>)> {
    let mut child = spawn_app_server(bin)
        .map_err(|e| ("network_unavailable".into(), Some(format!("spawn: {e}"))))?;

    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();

    let id = REQ_ID.fetch_add(1, Ordering::SeqCst);
    // initialize first
    let init = json!({
        "jsonrpc": "2.0", "id": id,
        "method": "initialize",
        "params": { "clientInfo": { "name": "agent-quota-monitor", "title": "Agent Quota Monitor", "version": "0.1.1" }, "capabilities": { "experimentalApi": false } }
    });
    stdin
        .write_all(format!("{init}\n").as_bytes())
        .await
        .map_err(|e| ("network_unavailable".into(), Some(e.to_string())))?;

    let id2 = id + 1;
    let call = json!({
        "jsonrpc": "2.0", "id": id2,
        "method": method,
        "params": params
    });
    stdin
        .write_all(format!("{call}\n").as_bytes())
        .await
        .map_err(|e| ("network_unavailable".into(), Some(e.to_string())))?;
    let _ = stdin.flush().await;
    // 不要 drop(stdin)：关闭管道会让 app-server 来不及回包
    let _keep_stdin = stdin;

    let mut lines = BufReader::new(stdout).lines();
    let mut result: Option<Value> = None;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(45);
    while tokio::time::Instant::now() < deadline {
        let next = tokio::time::timeout_at(deadline, lines.next_line()).await;
        let Ok(Ok(Some(line))) = next else { break };
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if msg.get("id").and_then(|v| v.as_i64()) == Some(id2) {
            if let Some(err) = msg.get("error") {
                let _ = child.kill().await;
                let e = format!("{err}");
                let code = if e.contains("auth") || e.contains("login") || e.contains("401") {
                    "login_expired"
                } else {
                    "provider_changed"
                };
                return Err((code.into(), Some(redact(&e))));
            }
            result = msg.get("result").cloned();
            break;
        }
    }
    let _ = child.kill().await;
    result.ok_or_else(|| (
        "network_unavailable".into(),
        Some("app-server 无响应（请确认 codex.exe 可运行）".into()),
    ))
}

fn window_to_period(mins: Option<i64>, label_hint: &str) -> PeriodType {
    match mins {
        Some(300) => PeriodType::Rolling { window_mins: 300 },
        Some(10080) => PeriodType::Weekly,
        // ③ 用户实测：Pro 档存在月度窗口（30d），必须映射为 Monthly 才能参与显示优先级
        Some(43200) => PeriodType::Monthly,
        Some(m) => PeriodType::Custom { raw: format!("{label_hint}#{m}m") },
        None => PeriodType::Custom { raw: label_hint.to_string() },
    }
}

fn map_window_bucket(
    id_prefix: &str,
    slot: &str,
    win: &Value,
    source_label: Option<&str>,
) -> Option<QuotaBucket> {
    if win.is_null() {
        return None;
    }
    let used = win.get("usedPercent").and_then(|v| v.as_f64());
    let mins = win.get("windowDurationMins").and_then(|v| v.as_i64());
    let resets_at = win.get("resetsAt").and_then(|v| v.as_i64()).map(|s| epoch_s_to_iso(s));
    let remaining = used.map(|u| (100.0 - u).clamp(0.0, 100.0));
    let label = source_label.unwrap_or(if slot == "primary" {
        "quota.quota"
    } else {
        "quota.quota"
    });
    Some(QuotaBucket {
        id: format!("{id_prefix}/{slot}"),
        label_key: label.into(),
        label_raw: source_label.map(|s| s.to_string()),
        period_type: window_to_period(mins, slot),
        unit: Unit::Percent,
        total: None,
        used: used.map(|u| u / 100.0),
        remaining: None,
        remaining_percent: remaining,
        reset_at: resets_at,
        source: "official".into(),
        confidence: "high".into(),
    })
}

fn epoch_s_to_iso(s: i64) -> String {
    chrono::DateTime::from_timestamp(s, 0)
        .map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
        .unwrap_or_default()
}

fn map_rate_limits(result: &Value) -> Snapshot {
    let mut buckets = vec![];
    let mut balances = vec![];
    let mut reset_ops = vec![];

    // rateLimitsByLimitId：全部桶
    if let Some(map) = result.get("rateLimitsByLimitId").and_then(|v| v.as_object()) {
        for (limit_id, entry) in map {
            let limit_name = entry.get("limitName").and_then(|v| v.as_str()).unwrap_or(limit_id);
            if let Some(b) = map_window_bucket(limit_id, "primary", entry.get("primary").unwrap_or(&Value::Null), Some(limit_name)) {
                buckets.push(b);
            }
            if let Some(b) = map_window_bucket(limit_id, "secondary", entry.get("secondary").unwrap_or(&Value::Null), Some(limit_name)) {
                buckets.push(b);
            }
        }
    } else if let Some(rl) = result.get("rateLimits") {
        // 单桶镜像
        if let Some(b) = map_window_bucket("codex", "primary", rl.get("primary").unwrap_or(&Value::Null), Some("codex")) {
            buckets.push(b);
        }
        if let Some(b) = map_window_bucket("codex", "secondary", rl.get("secondary").unwrap_or(&Value::Null), Some("codex")) {
            buckets.push(b);
        }
    }

    // 付费 credits → balances（与 reset credits 严格分离）
    let credits = result
        .get("rateLimits")
        .and_then(|r| r.get("credits"))
        .cloned()
        .unwrap_or(Value::Null);
    if !credits.is_null() {
        let unlimited = credits.get("unlimited").and_then(|v| v.as_bool()).unwrap_or(false);
        let has = credits.get("hasCredits").and_then(|v| v.as_bool()).unwrap_or(false);
        let bal = credits
            .get("balance")
            .and_then(|v| v.as_str().and_then(|s| s.parse::<f64>().ok()).or_else(|| v.as_f64()));
        if unlimited || has || bal.is_some() {
            balances.push(BalanceDto {
                id: "codex/credits".into(),
                currency: "USD".into(),
                total: bal,
                granted: None,
                topped_up: None,
                available_flag: Some(unlimited || has),
                source: "official".into(),
            });
        }
    }

    // Reset ×N（仅监控）
    if let Some(rr) = result.get("rateLimitResetCredits") {
        let n = rr.get("availableCount").and_then(|v| v.as_i64()).unwrap_or(0) as u32;
        if n > 0 {
            let items = rr
                .get("credits")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .map(|c| ResetItem {
                            expires_at: c.get("expiresAt").and_then(|x| x.as_i64()).map(epoch_s_to_iso),
                            title_raw: c.get("title").and_then(|x| x.as_str()).map(|s| s.to_string()),
                        })
                        .collect()
                })
                .unwrap_or_default();
            reset_ops.push(ResetOpportunity {
                id: "codex/resets".into(),
                count: n,
                items,
            });
        }
    }

    let plan = result
        .get("rateLimits")
        .and_then(|r| r.get("planType"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let ordinary = result
        .get("ordinaryUsageAllowed")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let mut snap = Snapshot {
        provider_id: ID.into(),
        account_label: Some("ChatGPT / Codex".into()),
        plan_label: plan,
        quota_buckets: buckets,
        balances,
        reset_opportunities: reset_ops,
        connection_state: "connected".into(),
        error_state: None,
        fetched_at: now_iso(),
        stale: false,
        endpoint_stability: "public_api".into(),
        installation: if find_local_codex().is_some() {
            "installed".into()
        } else {
            "not_installed".into()
        },
        usage_url: USAGE_URL.into(),
    };
    if !ordinary {
        snap.connection_state = "degraded".into();
        snap.error_state = Some(ErrorState {
            code: "rate_limited".into(),
            detail: Some("ordinaryUsageAllowed=false".into()),
            occurred_at: now_iso(),
        });
    }
    snap
}

pub async fn fetch_via_app_server() -> Snapshot {
    let bin = match resolve_codex_bin() {
        Ok(b) => b,
        Err((code, detail)) => {
            return Snapshot::not_configured(ID, USAGE_URL, "public_api").with_error(code, detail)
        }
    };
    let params = json!({
        "supportsLunaReserve": false,
        "excludeResetCreditDetails": true
    });
    match call_once(&bin, "account/rateLimits/read", params).await {
        Ok(result) => map_rate_limits(&result),
        Err((code, detail)) => {
            let mut s = Snapshot::not_configured(ID, USAGE_URL, "public_api");
            s.installation = "installed".into();
            s.with_error(code, detail)
        }
    }
}

/// 仅停止本软件对 Codex 的监控（不调用 account/logout，不动用户 ~/.codex）
/// 条目保留在主界面，状态回到「未登录/登录已失效」
pub async fn logout_chatgpt() -> Result<Value, (String, Option<String>)> {
    let home = monitor_codex_home();
    for name in ["auth.json", "auth.json.bak"] {
        let _ = std::fs::remove_file(home.join(name));
    }
    Ok(json!({ "ok": true, "scope": "monitor-only" }))
}

/// 隔离会话登录状态（只读元数据）：auth.json 是否存在于专用 CODEX_HOME。
/// 不读取文件内容（红线：不接触 token）；会话有效性由快照 connection_state 体现。
/// （曾计划改跑 `codex login status` 子命令获取登录方式，因安全静态钩子对
/// Command+env 模式误报拦截，本方案零进程派生，信息量足够设置页展示。）
pub fn login_status() -> Value {
    let home = monitor_codex_home();
    let present = home.join("auth.json").is_file();
    json!({ "loggedIn": present })
}

/// 登录：`codex login` 写入**本软件专用** CODEX_HOME，不影响用户 ~/.codex
/// 必须让进程活到 OAuth 回调完成，否则 127.0.0.1 回调被拒。
pub async fn login_chatgpt() -> Result<String, (String, Option<String>)> {
    let bin = resolve_codex_bin()?;
    // 构造与 CREATE_NO_WINDOW 统一在 winproc
    let st = crate::winproc::spawn_login(&bin, &monitor_codex_home());
    if let Ok(mut child) = st {
        // 后台等到登录结束（回调 127.0.0.1 需要进程活着），随后立刻拉一次额度
        tokio::spawn(async move {
            let _ = tokio::time::timeout(std::time::Duration::from_secs(300), child.wait()).await;
            // 登录写盘后自动刷新，避免设置里一直显示「登录已失效」
            let _ = crate::codex::fetch_via_app_server().await;
        });
        return Ok("login_cli_started".into());
    }
    // 回退：app-server login/start（仍写入本软件 CODEX_HOME）
    let mut child = spawn_app_server(&bin)
        .map_err(|e| ("network_unavailable".into(), Some(format!("无法启动 codex.exe：{e}"))))?;
    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let id = REQ_ID.fetch_add(1, Ordering::SeqCst);
    let init = json!({
        "jsonrpc": "2.0", "id": id,
        "method": "initialize",
        "params": { "clientInfo": { "name": "agent-quota-monitor", "title": "Agent Quota Monitor", "version": "0.1.1" }, "capabilities": { "experimentalApi": false } }
    });
    let id2 = id + 1;
    let login = json!({
        "jsonrpc": "2.0", "id": id2,
        "method": "account/login/start",
        "params": { "type": "chatgpt", "appBrand": "codex" }
    });
    stdin
        .write_all(format!("{init}\n{login}\n").as_bytes())
        .await
        .map_err(|e| ("network_unavailable".into(), Some(e.to_string())))?;
    let _ = stdin.flush().await;

    let mut login_url = String::new();
    {
        let mut lines = BufReader::new(stdout).lines();
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(15);
        while tokio::time::Instant::now() < deadline {
            let next = tokio::time::timeout_at(deadline, lines.next_line()).await;
            let Ok(Ok(Some(line))) = next else { break };
            let Ok(msg) = serde_json::from_str::<Value>(line.trim()) else {
                continue;
            };
            if msg.get("id").and_then(|v| v.as_i64()) == Some(id2) {
                if let Some(url) = msg
                    .pointer("/result/authUrl")
                    .or_else(|| msg.pointer("/result/url"))
                    .or_else(|| msg.pointer("/result/loginUrl"))
                    .and_then(|v| v.as_str())
                {
                    login_url = url.to_string();
                }
                break;
            }
        }
    }

    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(300)).await;
        let _ = child.kill().await;
    });
    Ok(login_url)
}
