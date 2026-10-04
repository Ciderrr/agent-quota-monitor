; Agent Quota Monitor 安装器自定义钩子（Tauri installerHooks）
; 注意：splash.bmp 通过 ${BUILD_RESOURCES} 引用（Tauri 定义为 src-tauri 资源目录）

!macro NSIS_HOOK_POSTINIT
  ; 开场品牌动画（advsplash 淡入淡出，NSIS 3 自带插件）
  InitPluginsDir
  File "${BUILD_RESOURCES}\installer\splash.bmp"
  advsplash::show /NOUNLOAD 1200 400 400 0x0F172A "$PLUGINSDIR\splash.bmp"
  Pop $0
  Delete "$PLUGINSDIR\splash.bmp"
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; 结束正在运行的旧实例，避免「Error opening file for writing」（用户实测踩过）。
  ; 先优雅关闭（WM_CLOSE → 应用自销毁窗口，避免 Alt+Tab 幽灵条目），2 秒后仍在再强杀。
  DetailPrint "Closing Agent Quota Monitor if running..."
  nsExec::Exec 'taskkill /IM agent-quota-monitor.exe'
  Pop $0
  Sleep 2000
  nsExec::Exec 'taskkill /F /IM agent-quota-monitor.exe'
  Pop $0
  Sleep 600
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; 「删除应用数据」勾选后的实际清理（v0.2.2）。
  ; 根因（用户实测：勾了选框数据仍在）：Tauri 模板只删 $APPDATA\$BUNDLEID 与
  ; $LOCALAPPDATA\$BUNDLEID，本应用的便携设计从未使用这两个目录。真实数据在：
  ;   安装目录 data/（SQLite DB）· $LOCALAPPDATA\AgentQuotaMonitor（Codex 隔离 HOME /
  ;   WebView2 会话 / 运行时下载 / 日志 / 单实例锁）· $APPDATA\AgentQuotaMonitor（旧版遗留 DB）
  ;   · Windows 凭据管理器条目 —— 全部在此补删。
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    ; 1) 安装目录内的便携数据（DB + wal/shm），随后移除安装目录残留
    RmDir /r "$INSTDIR\data"
    RMDir "$INSTDIR"
    ; 2) 运行时数据（codex-home / mimo-session / runtimes / logs / instance.lock）
    RmDir /r "$LOCALAPPDATA\AgentQuotaMonitor"
    ; 3) 旧版遗留数据库目录
    RmDir /r "$APPDATA\AgentQuotaMonitor"
    ; 4) 凭据管理器条目（keyring target = <slot>.AgentQuotaMonitor）
    nsExec::Exec 'cmdkey /delete:deepseek/api-key.AgentQuotaMonitor'
    Pop $0
    nsExec::Exec 'cmdkey /delete:zcode/coding-plan-key.AgentQuotaMonitor'
    Pop $0
  ${EndIf}
!macroend
