!define APPNAME "E-SBA"
!define COMPANY "E-SBA"
!define VERSION "1.0.0"
!define INSTALLDIR "$PROGRAMFILES\\E-SBA"

OutFile "E-SBA-Setup.exe"
InstallDir "${INSTALLDIR}"
RequestExecutionLevel admin
ShowInstDetails show
ShowUninstDetails show

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "..\\dist\\*.*"
  File "..\\build\\index.exe"
  Rename "$INSTDIR\\index.exe" "$INSTDIR\\E-SBA.exe"

  CreateShortCut "$SMPROGRAMS\\E-SBA.lnk" "$INSTDIR\\E-SBA.exe"
  CreateShortCut "$DESKTOP\\E-SBA.lnk" "$INSTDIR\\E-SBA.exe"
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\\E-SBA.lnk"
  Delete "$DESKTOP\\E-SBA.lnk"
  RMDir /r "$INSTDIR"
SectionEnd

SilentInstall normal
SilentUnInstall normal
