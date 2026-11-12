; Install a custom welcome view in the MUI2 page Tauri already uses.
; Initialize its HWND variables before defining the callbacks.
!define MUI_PAGE_UNINSTALLER_PREFIX ""
!insertmacro MUI_WELCOMEPAGE_INTERFACE
!undef MUI_PAGE_UNINSTALLER_PREFIX
!undef MUI_WELCOMEFINISHPAGE_BITMAP

!define MUI_WELCOMEPAGE_TITLE " "
!define MUI_WELCOMEPAGE_TEXT " "
!define MUI_PAGE_CUSTOMFUNCTION_SHOW XBondWelcomeShow
!define MUI_PAGE_CUSTOMFUNCTION_DESTROYED XBondWelcomeDestroyed

LangString XBondWelcomeText ${XBOND_LANG_ENGLISH} "Install XBond for your Windows account."
LangString XBondWelcomeText ${XBOND_LANG_SIMPCHINESE} "为当前 Windows 帐户安装 XBond。"
LangString XBondWelcomeText ${XBOND_LANG_TRADCHINESE} "為目前的 Windows 帳戶安裝 XBond。"
LangString XBondWelcomeText ${XBOND_LANG_KOREAN} "현재 Windows 계정에 XBond를 설치합니다."
LangString XBondWelcomeText ${XBOND_LANG_FARSI} "XBond را برای حساب ویندوز خود نصب کنید."

LangString XBondContinue ${XBOND_LANG_ENGLISH} "Continue"
LangString XBondContinue ${XBOND_LANG_SIMPCHINESE} "继续"
LangString XBondContinue ${XBOND_LANG_TRADCHINESE} "繼續"
LangString XBondContinue ${XBOND_LANG_KOREAN} "계속"
LangString XBondContinue ${XBOND_LANG_FARSI} "ادامه"

Var XBondWelcomeBitmap
Var XBondTitleFont
Var XBondBodyFont
Var XBondButtonFont

Function XBondWelcomeShow
  InitPluginsDir
  File "/oname=$PLUGINSDIR\xbond-welcome.bmp" "${__FILEDIR__}\icons\installer-welcome.bmp"

  ShowWindow $mui.WelcomePage.Image ${SW_HIDE}
  ShowWindow $mui.WelcomePage.Title ${SW_HIDE}
  ShowWindow $mui.WelcomePage.Text ${SW_HIDE}

  ${NSD_CreateBitmap} 50% 0 50% 100% ""
  Pop $0
  ${NSD_SetStretchedBitmap} $0 "$PLUGINSDIR\xbond-welcome.bmp" $XBondWelcomeBitmap

  ${NSD_CreateLabel} 18u 38u 122u 32u "XBond"
  Pop $0
  CreateFont $XBondTitleFont "Segoe UI" 25 600
  SendMessage $0 ${WM_SETFONT} $XBondTitleFont 0
  SetCtlColors $0 "${MUI_TEXTCOLOR}" "${MUI_BGCOLOR}"

  ${NSD_CreateLabel} 19u 75u 127u 44u "$(XBondWelcomeText)"
  Pop $0
  CreateFont $XBondBodyFont "$(^Font)" 11 400
  SendMessage $0 ${WM_SETFONT} $XBondBodyFont 0
  SetCtlColors $0 "525B6C" "${MUI_BGCOLOR}"

  ${NSD_CreateButton} 19u 127u 100u 27u "$(XBondContinue)"
  Pop $0
  CreateFont $XBondButtonFont "$(^Font)" 10 600
  SendMessage $0 ${WM_SETFONT} $XBondButtonFont 0
  ${NSD_OnClick} $0 XBondWelcomeContinue
  ${IfNot} ${IsHighContrastModeActive}
    ${NSD_OnNotify} $0 XBondPaintButton
  ${EndIf}
  ShowWindow $mui.Button.Next ${SW_HIDE}
  ${NSD_SetFocus} $0
FunctionEnd

Function XBondWelcomeContinue
  Pop $0
  ; Post so the click callback returns before nsDialogs destroys the page.
  System::Call 'USER32::PostMessageW(p$HWNDPARENT,i${WM_COMMAND},p1,p$mui.Button.Next)'
FunctionEnd

Function XBondWelcomeDestroyed
  ShowWindow $mui.Button.Next ${SW_SHOW}
  ${NSD_FreeBitmap} $XBondWelcomeBitmap
  System::Call 'GDI32::DeleteObject(p$XBondTitleFont)'
  System::Call 'GDI32::DeleteObject(p$XBondBodyFont)'
  System::Call 'GDI32::DeleteObject(p$XBondButtonFont)'
FunctionEnd

!define /math XBOND_CUSTOMDRAW_POINTER_BYTES 3 * ${NSIS_PTR_SIZE}
!define /math XBOND_CUSTOMDRAW_RECT_OFFSET ${XBOND_CUSTOMDRAW_POINTER_BYTES} + 8

Function XBondPaintButton
  ; WM_NOTIFY supplies the button HWND, notification code, and NMCUSTOMDRAW*.
  Pop $0
  Pop $1
  Pop $2
  ${If} $1 != -12 ; NM_CUSTOMDRAW
    Return
  ${EndIf}

  System::Call '*$2(p,p,i,i.r3,p.r4,i.r5,i.r6,i.r7,i.r8,p,i.r9)'
  ${If} $3 != 1 ; CDDS_PREPAINT
    Return
  ${EndIf}

  ; COLORREF is BGR. Use darker orange on hover and press.
  StrCpy $1 0x0044BA
  IntOp $3 $9 & 0x01 ; CDIS_SELECTED
  ${If} $3 != 0
    StrCpy $1 0x00358E
  ${Else}
    IntOp $3 $9 & 0x40 ; CDIS_HOT
    ${If} $3 != 0
      StrCpy $1 0x0040A8
    ${EndIf}
  ${EndIf}

  IntOp $2 $2 + ${XBOND_CUSTOMDRAW_RECT_OFFSET}
  System::Call 'GDI32::SaveDC(p r4)i.r3'
  System::Call 'GDI32::CreateSolidBrush(i0xFEFBFB)p.r5'
  System::Call 'USER32::FillRect(p r4,p r2,p r5)'
  System::Call 'GDI32::DeleteObject(p r5)'
  System::Call 'GDI32::GetStockObject(i18)p.r5' ; DC_BRUSH
  System::Call 'GDI32::SelectObject(p r4,p r5)'
  System::Call 'GDI32::GetStockObject(i8)p.r5' ; NULL_PEN
  System::Call 'GDI32::SelectObject(p r4,p r5)'
  System::Call 'GDI32::SetDCBrushColor(p r4,i r1)'
  System::Call '*$2(i.r5,i.r6,i.r7,i.r8)'
  IntOp $1 $8 - $6
  IntOp $1 $1 / 3
  System::Call 'GDI32::RoundRect(p r4,i r5,i r6,i r7,i r8,i r1,i r1)'
  System::Call 'GDI32::SetBkMode(p r4,i1)' ; TRANSPARENT
  System::Call 'GDI32::SetTextColor(p r4,i0xFFFFFF)'
  System::Call 'GDI32::SelectObject(p r4,p$XBondButtonFont)'
  ${NSD_GetText} $0 $1
  ; DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX
  System::Call 'USER32::DrawTextW(p r4,w r1,i-1,p r2,i0x825)'

  IntOp $1 $9 & 0x210 ; CDIS_FOCUS | CDIS_NOFOCUSRECT
  ${If} $1 == 0x10
    IntOp $5 $5 + 4
    IntOp $6 $6 + 4
    IntOp $7 $7 - 4
    IntOp $8 $8 - 4
    System::Call '*(i r5,i r6,i r7,i r8)p.r1'
    System::Call 'USER32::DrawFocusRect(p r4,p r1)'
    System::Free $1
  ${EndIf}

  System::Call 'GDI32::RestoreDC(p r4,i r3)'
  ${NSD_Return} 4 ; CDRF_SKIPDEFAULT
FunctionEnd
