# =============================================================================
# Mesagri · DETENER: apaga la API y MySQL (los datos quedan guardados)
# =============================================================================
. (Join-Path $PSScriptRoot 'comun.ps1')
try {
  Step 'Apagando Mesagri'
  Stop-Api
  Step 'Apagando MySQL'
  Stop-Mysql
  Say '   Listo. Los datos quedan guardados en MySQL.' 'Green'
} catch {
  Say "No se pudo detener: $($_.Exception.Message)" 'Red'
  exit 1
}
