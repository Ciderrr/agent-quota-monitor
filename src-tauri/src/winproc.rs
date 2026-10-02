// 子进程启动辅助：GUI 应用派生控制台程序（tasklist / codex.exe）时
// 必须带 CREATE_NO_WINDOW，否则每 30s/每 5min 会在桌面闪一个 cmd 黑窗。
// 所有参数为固定字面量 + 本应用解析的运行时路径，无 shell、无字符串拼装。
use std::path::Path;
use std::process::Stdio;

pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
pub fn silence_std(cmd: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(windows)]
pub fn silence_tokio(cmd: &mut tokio::process::Command) {
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub fn silence_std(_cmd: &mut std::process::Command) {}
#[cfg(not(windows))]
pub fn silence_tokio(_cmd: &mut tokio::process::Command) {}

/// `codex app-server`（隔离 CODEX_HOME），隐藏窗口
pub fn spawn_app_server(bin: &Path, codex_home: &Path) -> std::io::Result<tokio::process::Child> {
    let mut cmd = tokio::process::Command::new(bin);
    cmd.args(["app-server"]);
    cmd.env("CODEX_HOME", codex_home);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::null());
    cmd.kill_on_drop(true);
    silence_tokio(&mut cmd);
    cmd.spawn()
}

/// `codex login`（隔离 CODEX_HOME），隐藏窗口；进程需活到 OAuth 回调完成
pub fn spawn_login(bin: &Path, codex_home: &Path) -> std::io::Result<tokio::process::Child> {
    let mut cmd = tokio::process::Command::new(bin);
    cmd.args(["login"]);
    cmd.env("CODEX_HOME", codex_home);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    cmd.kill_on_drop(false);
    silence_tokio(&mut cmd);
    cmd.spawn()
}
