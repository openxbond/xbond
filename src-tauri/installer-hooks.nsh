; XBond installer hooks (wired via bundle.windows.nsis.installerHooks).

; Tauri loads the MUI language files after this include; LangString below
; references the LCIDs of the languages declared in tauri.windows.conf.json.
!define XBOND_LANG_ENGLISH 1033
!define XBOND_LANG_SIMPCHINESE 2052
!define XBOND_LANG_TRADCHINESE 1028
!define XBOND_LANG_KOREAN 1042
!define XBOND_LANG_FARSI 1065

; Windows 10 is the documented minimum: the Evergreen WebView2 installer and
; the Tauri 2.12 stack no longer run on Windows 7/8.1. CurrentMajorVersionNumber
; only exists on Windows 10 / Server 2016 and newer; older systems read an
; empty string and are rejected before any file is copied.

LangString XBondRequiresWin10 ${XBOND_LANG_ENGLISH} "XBond requires Windows 10 or later."
LangString XBondRequiresWin10 ${XBOND_LANG_SIMPCHINESE} "XBond 需要 Windows 10 或更高版本。"
LangString XBondRequiresWin10 ${XBOND_LANG_TRADCHINESE} "XBond 需要 Windows 10 或更新版本。"
LangString XBondRequiresWin10 ${XBOND_LANG_KOREAN} "XBond에는 Windows 10 이상이 필요합니다."
LangString XBondRequiresWin10 ${XBOND_LANG_FARSI} "XBond به ویندوز ۱۰ یا جدیدتر نیاز دارد."

; The NSIS template only registers the main binary with the Restart Manager
; (CheckIfAppIsRunning), but xbond-daemon.exe is a second product executable:
; the desktop app supervises it, and it keeps running after the app is closed.
; A daemon left running locks its binary, and the default NSIS SetOverwrite
; silently skips locked or same-date files, so an upgrade would report success
; while leaving the old daemon on disk. Stop it through its LocalAPI and, if
; it survives that, force-kill it before files are copied or deleted.
!macro XBondStopProductDaemon
  !define XBOND_STOP_ID ${__LINE__}
  IfFileExists "$INSTDIR\xbond-daemon.exe" 0 xbond_daemon_stopped_${XBOND_STOP_ID}
    nsExec::ExecToLog '"$INSTDIR\xbond-daemon.exe" daemon stop'
    Pop $R9
    Sleep 1000
    nsExec::Exec 'taskkill /IM xbond-daemon.exe /F'
    Pop $R9
    Sleep 500
  xbond_daemon_stopped_${XBOND_STOP_ID}:
  !undef XBOND_STOP_ID
!macroend

; The in-app elevated install can register the machine-scope daemon
; (XBondSystemService, its binary under "Program Files\XBond Machine") with
; StartMode=auto — it outlives the app by design while installed, so an
; uninstall that skipped it would leave a proxy runtime resurrecting on every
; boot (AC-8). Reclaim it through the sidecar CLI's uninstall verb: SCM stop
; plus registration delete, a no-op when never installed (it probes the
; service before spending a UAC prompt). A declined elevation leaves the
; registration untouched and is reported in the log.
!macro XBondUninstallMachineDaemon
  !define XBOND_MACHINE_ID ${__LINE__}
  IfFileExists "$INSTDIR\xbond-daemon.exe" 0 xbond_machine_reclaimed_${XBOND_MACHINE_ID}
    nsExec::ExecToLog '"$INSTDIR\xbond-daemon.exe" daemon uninstall --scope system'
    Pop $R9
  xbond_machine_reclaimed_${XBOND_MACHINE_ID}:
  !undef XBOND_MACHINE_ID
!macroend

!macro NSIS_HOOK_PREINSTALL
  Push $R0
  ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentMajorVersionNumber"
  ${If} $R0 == ""
    MessageBox MB_OK|MB_ICONSTOP "$(XBondRequiresWin10)"
    Abort
  ${EndIf}
  Pop $R0

  !insertmacro XBondStopProductDaemon
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro XBondStopProductDaemon
  !insertmacro XBondUninstallMachineDaemon
!macroend
