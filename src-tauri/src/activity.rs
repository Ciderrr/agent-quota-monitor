// 活动检测（REFRESH_STRATEGY §2 / PORTABLE_FIRST §6）—— Local Enhancement，仅优化刷新。
// 信号：Agent 进程名 + 会话目录 mtime（只读文件元数据，绝不读文件内容）。
// Unknown（探测失败/目录不存在）按 Idle 处理；活动状态不落库、不展示；
// 探测节流 30s，失败退避 60s。本地无 Agent 时恒为 Idle，功能不受影响。
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// 会话目录 mtime 距今小于该值视为「正在工作」
const MTIME_ACTIVE_SECS: u64 = 180;

struct Detector {
    processes: Option<Vec<String>>,
    last_probe_ms: i64,
    probe_failed: bool,
    active: HashMap<String, bool>,
}

static DETECTOR: Mutex<Option<Detector>> = Mutex::new(None);

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Provider → (Agent 进程名, 会话目录)。只覆盖有本机 Agent 形态的 Provider。
fn watch_targets(id: &str) -> Option<(Vec<&'static str>, PathBuf)> {
    let home = std::env::var("USERPROFILE").ok()?;
    match id {
        "codex" => Some((
            vec!["codex.exe"],
            PathBuf::from(&home).join(".codex").join("sessions"),
        )),
        "zcode" => Some((
            vec!["zcode.exe", "zcode"],
            PathBuf::from(&home).join(".zcode").join("v2").join("sessions"),
        )),
        _ => None,
    }
}

/// tasklist 一次性快照（约几十毫秒；30s 一次，可接受）。失败 → None。
fn list_processes() -> Option<Vec<String>> {
    let mut cmd = std::process::Command::new("tasklist");
    cmd.args(["/FO", "CSV", "/NH"]);
    crate::winproc::silence_std(&mut cmd); // GUI 进程派生控制台程序必须隐藏窗口
    let out = cmd.output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let names: Vec<String> = text
        .lines()
        .filter_map(|line| line.split(',').next().map(|s| s.trim_matches('"').to_lowercase()))
        .collect();
    (!names.is_empty()).then_some(names)
}

/// 目录自身 + 一级条目的最新 mtime；距今 < max_age 秒则视为活跃。目录不存在 → false。
fn recent_mtime(dir: &PathBuf, max_age_secs: u64) -> bool {
    let mut newest = None;
    let scan = |p: &PathBuf, acc: &mut Option<SystemTime>| {
        if let Ok(meta) = p.metadata() {
            let t = meta.modified().ok();
            if t.is_some() && t > *acc {
                *acc = t;
            }
        }
    };
    scan(dir, &mut newest);
    if let Ok(rd) = std::fs::read_dir(dir) {
        for ent in rd.flatten() {
            scan(&ent.path(), &mut newest);
        }
    }
    match newest {
        Some(t) => SystemTime::now().duration_since(t).unwrap_or(Duration::ZERO).as_secs() < max_age_secs,
        None => false,
    }
}

/// 探测某 Provider 的活动状态；返回 (当前是否活跃, 是否发生 Idle→Active 边沿)。
pub fn poll(id: &str) -> (bool, bool) {
    let mut guard = DETECTOR.lock().unwrap_or_else(|e| e.into_inner());
    let det = guard.get_or_insert(Detector {
        processes: None,
        last_probe_ms: 0, // 0（而非 i64::MIN）：保证首次 now-last 不溢出、立即探测
        probe_failed: false,
        active: HashMap::new(),
    });
    let now = now_ms();
    // 节流：正常 30s，失败退避 60s（REFRESH_STRATEGY §2）；饱和减法防溢出 panic
    let throttle = if det.probe_failed { 60_000 } else { 30_000 };
    if now.saturating_sub(det.last_probe_ms) >= throttle {
        det.processes = list_processes();
        det.probe_failed = det.processes.is_none();
        det.last_probe_ms = now;
    }
    let Some((proc_names, sessions_dir)) = watch_targets(id) else {
        return (false, false);
    };
    // 进程名命中；探测失败（None）按 Idle，不惩罚
    let proc_active = det
        .processes
        .as_ref()
        .map(|ps| ps.iter().any(|p| proc_names.contains(&p.as_str())))
        .unwrap_or(false);
    let is_active = proc_active || recent_mtime(&sessions_dir, MTIME_ACTIVE_SECS);
    let was = det.active.insert(id.to_string(), is_active).unwrap_or(false);
    (is_active, is_active && !was)
}
