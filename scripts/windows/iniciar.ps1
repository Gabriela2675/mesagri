# =============================================================================
# Mesagri · INICIAR: MySQL, la API (que sirve la app web) y el navegador
# =============================================================================
param([switch]$FromInstaller, [switch]$NoBrowser)
. (Join-Path $PSScriptRoot 'comun.ps1')
if (-not $FromInstaller) { Start-Transcript -Path (Join-Path $Logs 'iniciar.log') -Append | Out-Null }
try {
  $node = Use-Node
  if (-not (Test-Path (Join-Path $Root 'apps\api\dist\main.js'))) { Fail 'Mesagri no está compilado. Ejecuta primero INSTALAR.cmd.' }
  Step 'MySQL'
  Start-Mysql
  $p = Get-Ports
  Step 'Mesagri'
  $running = $false
  if (Test-Port $p.Api) {
    $h = $null
    try { $h = Invoke-RestMethod -Uri "http://127.0.0.1:$($p.Api)/api/v1/health" -TimeoutSec 4 -UseBasicParsing } catch { }
    $want = Get-BuildId
    if ($h -and $want -and ("$($h.build)" -eq $want)) {
      Say "   Ya está corriendo en el puerto $($p.Api)."
      $running = $true
    } else {
      # quedó abierta una versión anterior (o una compilación vieja): se cierra para abrir la de esta carpeta
      Say '   Hay otra versión de Mesagri abierta: se cierra y se abre la nueva.' 'Yellow'
      Stop-Api
      for ($i = 0; $i -lt 30 -and (Test-Port $p.Api); $i++) { Start-Sleep -Milliseconds 400 }
      if (Test-Port $p.Api) { Fail "El puerto $($p.Api) lo está usando otro programa. Ciérralo (o reinicia la laptop) y vuelve a abrir Mesagri." }
    }
  }
  if (-not $running) {
    $env:NO_COLOR = '1'
    $out = Join-Path $Logs 'api.log'
    $main = Join-Path $Root 'apps\api\dist\main.js'
    $cmdline = "/c `"`"$node`" `"$main`" >> `"$out`" 2>&1`""
    $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdline -WorkingDirectory $Root -WindowStyle Hidden -PassThru
    Set-Content -Path (Join-Path $Runtime 'api.pid') -Value $proc.Id
    Say '   Arrancando (migraciones, datos de ejemplo la primera vez)...'
    $ok = $false
    for ($i = 0; $i -lt 120; $i++) {
      Start-Sleep -Milliseconds 800
      try { $h = Invoke-RestMethod -Uri "http://127.0.0.1:$($p.Api)/api/v1/health" -TimeoutSec 3 -UseBasicParsing; if ($h.ok) { $ok = $true; break } } catch { }
      if ($proc.HasExited) { break }
    }
    if (-not $ok) { Fail "Mesagri no arrancó. Revisa $out" }
  }
  $url = "http://localhost:$($p.Api)/"
  Say ''
  Say '  Mesagri está listo:' 'Cyan'
  Say "   · App (inicio e ingreso por tipo de usuario): $url" 'White'
  Say "   · Panel web del equipo (doble factor):         $($url)panel" 'White'
  Say "   · Demo con varios celulares y el panel:        $($url)demo" 'White'
  Say "   · API documentada (OpenAPI):                   $($url)api/docs" 'White'
  $lan = Get-LanUrls $p.Api
  if ($lan) { Say '   Desde un celular en la misma red Wi-Fi (Chrome → Agregar a la pantalla principal):' 'White'; foreach ($u in $lan) { Say "     $u/" 'White' } }
  Say '   Para apagarlo: DETENER.cmd (o el acceso directo «Mesagri (detener)»).' 'DarkGray'
  if (-not $NoBrowser) { Start-Process $url }
} catch {
  Say "No se pudo iniciar: $($_.Exception.Message)" 'Red'
  exit 1
} finally {
  if (-not $FromInstaller) { Stop-Transcript | Out-Null }
}
