// 共享 HTTP 客户端：15s 超时、固定 UA；域名白名单硬校验（SECURITY §4）。
// 适配器只能通过 assert_allowed + client 访问网络，无法触达白名单外主机。
use std::time::Duration;

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("agent-quota-monitor/0.1")
        .build()
        .expect("http client")
}

/// 大文件下载（Managed Runtime）：更长超时
pub fn download_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .user_agent("agent-quota-monitor/0.1")
        .build()
        .expect("http client")
}

pub fn assert_allowed(url: &str, allowed_hosts: &[&str]) -> Result<(), String> {
    let u = url::Url::parse(url).map_err(|_| "bad url".to_string())?;
    if u.scheme() != "https" {
        return Err("non-https url refused".into());
    }
    let host = u.host_str().ok_or_else(|| "no host".to_string())?;
    if allowed_hosts.iter().any(|a| host.eq_ignore_ascii_case(a)) {
        Ok(())
    } else {
        Err(format!("host not in allowlist: {host}"))
    }
}

/// 错误体脱敏（双保险中的第二道；响应体组装进 Snapshot 前经过这里）
pub fn redact(s: &str) -> String {
    let mut out = s.to_string();
    for pat in ["sk-", "Bearer ", "tp-", "authorization", "Authorization"] {
        out = out.replace(pat, "[REDACTED]");
    }
    out
}
