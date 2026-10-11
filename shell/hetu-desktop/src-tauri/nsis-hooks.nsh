; Tauri NSIS 安装钩子（installerHooks）
;
; 背景：桌面外壳会在退出时杀掉自己拉起的 Hetu.Api 子进程，但外壳被强杀（任务管理器、
; 更新安装、崩溃）时子进程会变成孤儿，继续占用 sqlite-vec\vec0.dll 等文件，
; 于是下一次安装会报 “Error opening file for writing: ...\vec0.dll”。
;
; 因此在复制文件之前先清掉残留的后端进程。只杀 Hetu.Api.exe，不动用户其它程序。
!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping leftover Hetu backend..."
  ; 用 nsExec 隐藏窗口执行（直接 ExecWait 会闪一个控制台窗口）
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM Hetu.Api.exe /T'
  Pop $0
  Sleep 500
!macroend
