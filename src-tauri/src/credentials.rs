// 凭据存储（SECURITY §1）：Windows Credential Manager，条目 AgentQuotaMonitor/<provider>/<slot>。
// 日志与错误路径只允许出现 credential_id，绝不出现凭证值。
use keyring::Entry;

const SERVICE: &str = "AgentQuotaMonitor";

fn entry(id_slot: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, id_slot).map_err(|e| format!("keyring entry: {e}"))
}

pub fn set_credential(id_slot: &str, secret: &str) -> Result<(), String> {
    entry(id_slot)?.set_password(secret).map_err(|e| format!("keyring set: {e}"))
}

pub fn get_credential(id_slot: &str) -> Result<Option<String>, String> {
    match entry(id_slot)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keyring get: {e}")),
    }
}

pub fn delete_credential(id_slot: &str) -> Result<(), String> {
    match entry(id_slot)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keyring delete: {e}")),
    }
}
