// 单实例闸门 + Alt+Tab 卫生（v0.2.1）。
//
// 背景（用户实测：Alt+Tab 里出现 3 个同名「Agent Quota Monitor」）：
// 1) 辅助窗口（设置/托盘菜单/两个登录窗）从未排除出 Alt+Tab——只要打开过，
//    Alt+Tab 就会多出条目（它们没有 WS_EX_TOOLWINDOW，Windows 就视为可切换窗口）。
// 2) 官方 single-instance 插件用命名互斥体，存在漏判路径：与提权实例混跑时
//    CreateMutexW 会返回 ACCESS_DENIED（而非 ERROR_ALREADY_EXISTS）→ 插件误判为
//    "首个实例" 继续启动 → 多实例并存，每个实例各有一个同名浮窗。
//
// 本模块提供两道加固：
// - acquire()/focus_existing()：std 独占文件锁（跨版本/跨权限/抗并发启动风暴），
//   后启动者聚焦已有浮窗后退出；
// - exclude_aux_windows_from_alt_tab()：给辅助窗口加 WS_EX_TOOLWINDOW 并清除
//   WS_EX_APPWINDOW，使其永不出现在 Alt+Tab；主浮窗保留唯一一个条目。
use std::sync::OnceLock;

static LOCK: OnceLock<std::fs::File> = OnceLock::new();

fn lock_path() -> Option<std::path::PathBuf> {
    let base = std::env::var("LOCALAPPDATA").ok()?;
    let dir = std::path::PathBuf::from(base).join("AgentQuotaMonitor");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("instance.lock"))
}

/// true = 本进程是唯一实例，继续启动；false = 已有实例在运行（调用方应聚焦后退出）。
pub fn acquire() -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        let Some(path) = lock_path() else { return true };
        match std::fs::OpenOptions::new().write(true).create(true).share_mode(0).open(&path) {
            Ok(f) => {
                let _ = LOCK.set(f); // 句柄持有到进程结束，不释放
                true
            }
            // ERROR_SHARING_VIOLATION(32)：另一个实例正持有独占锁
            Err(e) if e.raw_os_error() == Some(32) => false,
            // 其他错误（杀软/磁盘抢占等）不阻塞启动，退化为插件单实例兜底
            Err(_) => true,
        }
    }
    #[cfg(not(windows))]
    {
        true
    }
}

/// 等待已有实例的浮窗出现并聚焦（最多约 6 秒）；无论是否等到都返回，由调用方退出。
#[cfg(windows)]
pub fn focus_existing() {
    use windows::core::PCWSTR;
    use windows::Win32::UI::WindowsAndMessaging::{
        AllowSetForegroundWindow, FindWindowW, GetWindowThreadProcessId, SetForegroundWindow, ShowWindow, SW_SHOW,
    };
    let class: Vec<u16> = "Tauri Window\0".encode_utf16().collect();
    let title: Vec<u16> = "Agent Quota Monitor\0".encode_utf16().collect();
    for _ in 0..20 {
        let found = unsafe { FindWindowW(PCWSTR(class.as_ptr()), PCWSTR(title.as_ptr())) };
        if let Ok(hwnd) = found {
            unsafe {
                let mut pid = 0u32;
                let _ = GetWindowThreadProcessId(hwnd, Some(&mut pid));
                if pid != 0 {
                    let _ = AllowSetForegroundWindow(pid);
                }
                let _ = ShowWindow(hwnd, SW_SHOW);
                let _ = SetForegroundWindow(hwnd);
            }
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
    }
}

/// 辅助窗口排除出 Alt+Tab（幂等）。**必须在每次 show() 之后重新调用**：
/// tao 在 set_visible 翻 VISIBLE 旗标时会用内部 WindowFlags 完整重算窗口样式
/// （tao window_state.rs 的 to_window_styles 只映射 ON_TASKBAR→WS_EX_APPWINDOW，
/// 不含 TOOLWINDOW），因此显示一次就会冲掉本标记——这正是 Alt+Tab 多出条目的根因。
/// 主浮窗不在此列——Alt+Tab 里只保留一个「Agent Quota Monitor」条目。
#[cfg(windows)]
pub fn exclude_aux_window(app: &tauri::AppHandle, label: &str) {
    use tauri::Manager;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, SWP_FRAMECHANGED, SWP_NOMOVE,
        SWP_NOSIZE, SWP_NOZORDER, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
    };
    let Some(w) = app.get_webview_window(label) else { return };
    let Ok(hwnd) = w.hwnd() else { return };
    unsafe {
        let cur = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let next = (cur | WS_EX_TOOLWINDOW.0 as isize) & !(WS_EX_APPWINDOW.0 as isize);
        if cur != next {
            let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
            // 变更 ex-style 后需 flush 帧，窗口管理器才会按新样式重建 Alt+Tab 缓存
            let _ = SetWindowPos(hwnd, None, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER);
        }
    }
}

#[cfg(not(windows))]
pub fn exclude_aux_window(_app: &tauri::AppHandle, _label: &str) {}

/// 全部辅助窗口（启动兜底 + 幂等）
pub fn exclude_aux_windows_from_alt_tab(app: &tauri::AppHandle) {
    for label in ["settings", "tray-menu", "mimo-login", "wb-login"] {
        exclude_aux_window(app, label);
    }
}
