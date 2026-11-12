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

!macro NSIS_HOOK_PREINSTALL
  Push $R0
  ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentMajorVersionNumber"
  ${If} $R0 == ""
    MessageBox MB_OK|MB_ICONSTOP "$(XBondRequiresWin10)"
    Abort
  ${EndIf}
  Pop $R0
!macroend
