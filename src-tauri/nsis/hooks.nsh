; NSIS hooks: register the context menu after install, remove it before
; uninstall. Both run as the installing user (per-user install), which is
; exactly the scope our registry keys live in.
;
; The app writes/removes the keys itself so there is one implementation of the
; layout; the installer only triggers it.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Registering the Zapit right-click menu..."
  nsExec::ExecToLog '"$INSTDIR\Zapit.exe" install-menu'
  Pop $0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing the Zapit right-click menu..."
  nsExec::ExecToLog '"$INSTDIR\Zapit.exe" uninstall-menu'
  Pop $0
!macroend
