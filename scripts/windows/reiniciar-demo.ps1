# =============================================================================
# Mesagri · REINICIAR LA DEMO: vuelve al martes 3 de noviembre de 2026, 8:30, con los datos de ejemplo
# =============================================================================
. (Join-Path $PSScriptRoot 'comun.ps1')
try {
  # deja corriendo la versión de esta carpeta (si quedó abierta una anterior, la reemplaza)
  & (Join-Path $PSScriptRoot 'iniciar.ps1') -NoBrowser
  $p = Get-Ports
  Step 'Reiniciando la demo'
  $r = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($p.Api)/api/v1/demo/reset" -ContentType 'application/json' -Body '{}' -TimeoutSec 60 -UseBasicParsing
  Say "   Listo: datos de ejemplo de nuevo (época $($r.epoch))." 'Green'
} catch {
  Say "No se pudo reiniciar: $($_.Exception.Message)" 'Red'
  exit 1
}
