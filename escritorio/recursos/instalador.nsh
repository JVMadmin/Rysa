; Página extra del instalador: carpeta de datos y caché de RYSA ERP.
; La carpeta elegida se guarda en el registro (sobrevive a las actualizaciones,
; que desinstalan la versión anterior) y en $INSTDIR\rysa-datos.txt, que es lo
; que lee la app al arrancar (src/main.js).

!include LogicLib.nsh

!define RYSA_REG "Software\GrupoRYSA\RYSA ERP"

!ifndef BUILD_UNINSTALLER
Var RysaDatos
!endif

!macro rysaDatosPorDefecto
  ${if} $RysaDatos == ""
    ReadRegStr $RysaDatos SHCTX "${RYSA_REG}" "Datos"
  ${endif}
  ${if} $RysaDatos == ""
    ; Por usuario: %LOCALAPPDATA%. Para todos los usuarios: %ProgramData%.
    StrCpy $RysaDatos "$LOCALAPPDATA\RYSA ERP"
  ${endif}
!macroend

!ifndef BUILD_UNINSTALLER
Function RysaDatosPre
  !insertmacro rysaDatosPorDefecto
FunctionEnd
!endif

!macro customPageAfterChangeDir
  ; electron-builder ya definió el PRE de la página de instalación (instFilesPre):
  ; se aparta para esta página y se restaura después.
  !ifdef MUI_PAGE_CUSTOMFUNCTION_PRE
    !define RYSA_PRE_PREVIO "${MUI_PAGE_CUSTOMFUNCTION_PRE}"
    !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !endif
  !define MUI_PAGE_HEADER_TEXT "Carpeta de datos"
  !define MUI_PAGE_HEADER_SUBTEXT "Dónde se guardan la sesión y la caché de imágenes."
  !define MUI_DIRECTORYPAGE_TEXT_TOP "RYSA ERP guarda en esta carpeta las imágenes de productos y archivos del sistema para no descargarlos del servidor cada vez. Elige un disco con espacio (se recomiendan 500 MB libres)."
  !define MUI_DIRECTORYPAGE_TEXT_DESTINATION "Carpeta de datos y caché"
  !define MUI_DIRECTORYPAGE_VARIABLE $RysaDatos
  !define MUI_PAGE_CUSTOMFUNCTION_PRE RysaDatosPre
  !insertmacro MUI_PAGE_DIRECTORY
  !ifdef RYSA_PRE_PREVIO
    !define MUI_PAGE_CUSTOMFUNCTION_PRE "${RYSA_PRE_PREVIO}"
    !undef RYSA_PRE_PREVIO
  !endif
!macroend

!macro customInstall
  ; En instalación silenciosa (actualización) no se muestra la página.
  !insertmacro rysaDatosPorDefecto
  CreateDirectory "$RysaDatos"
  ; Si se instaló para todos los usuarios, todos deben poder escribir la caché.
  nsExec::Exec 'icacls "$RysaDatos" /grant *S-1-5-32-545:(OI)(CI)M /T /C /Q'
  Pop $0
  WriteRegStr SHCTX "${RYSA_REG}" "Datos" "$RysaDatos"
  ; UTF-16 LE con BOM: así una ruta con acentos llega intacta a la app.
  FileOpen $0 "$INSTDIR\rysa-datos.txt" w
  FileWriteWord $0 0xFEFF
  FileWriteUTF16LE $0 "$RysaDatos"
  FileClose $0
!macroend

!macro customUnInstall
  ; Al actualizar se conserva; al desinstalar de verdad se olvida la ruta.
  ; La carpeta de datos NO se borra (puede estar en otro disco y tener la caché).
  ${ifNot} ${isUpdated}
    DeleteRegKey SHCTX "${RYSA_REG}"
  ${endif}
!macroend
