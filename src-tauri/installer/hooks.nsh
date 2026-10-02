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
  ; 结束正在运行的旧实例，避免「Error opening file for writing」（用户实测踩过）
  DetailPrint "Closing Agent Quota Monitor if running..."
  nsExec::Exec 'taskkill /F /IM agent-quota-monitor.exe'
  Pop $0
  Sleep 600
!macroend
