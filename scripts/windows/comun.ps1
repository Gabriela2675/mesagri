# =============================================================================
# Mesagri · funciones comunes de los scripts de Windows
# Node.js y MySQL 8.4 portátiles dentro de la carpeta del proyecto (no hace falta ser administrador).
# =============================================================================
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13 } catch { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 }
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Logs = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

# MySQL no se lleva bien con rutas con tildes o eñes: en ese caso sus archivos van a C:\MesagriDatos
if ($Root -match '[^\x00-\x7F]') { $Runtime = 'C:\MesagriDatos' } else { $Runtime = Join-Path $Root 'runtime' }
New-Item -ItemType Directory -Force -Path $Runtime | Out-Null

$NodeDir   = Join-Path $Runtime 'node'
$MysqlDir  = Join-Path $Runtime 'mysql'
$MysqlData = Join-Path $Runtime 'mysql-data'
$MysqlIni  = Join-Path $Runtime 'my.ini'
$MysqlCnf  = Join-Path $Runtime 'cliente-root.cnf'
$EnvFile   = Join-Path $Root '.env'

# En Windows PowerShell 5.1, redirigir la salida de error de un programa con ErrorActionPreference=Stop
# lo convierte en excepción: estos programas se llaman sin esa preferencia.
function Invoke-Quiet([scriptblock]$sb) { $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { & $sb 2>&1 | Out-Null } finally { $ErrorActionPreference = $old } }

function Say([string]$msg, [string]$color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Step([string]$msg) { Write-Host ''; Write-Host "==> $msg" -ForegroundColor Green }
function Fail([string]$msg) { Write-Host ''; Write-Host "ERROR: $msg" -ForegroundColor Red; throw $msg }

function Read-Env {
  $h = @{}
  if (Test-Path $EnvFile) {
    foreach ($line in Get-Content $EnvFile -Encoding UTF8) {
      if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$') { $h[$Matches[1]] = $Matches[2] }
    }
  }
  return $h
}

function Write-Env([hashtable]$h) {
  $order = 'API_PORT','API_HOST','DB_HOST','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD','JWT_SECRET','DATA_KEY','ADMIN_PASSWORD','DEMO_MODE','DEMO_CLOCK','FILES_DIR','MYSQL_ROOT_PASSWORD'
  $lines = @('# Mesagri · configuración local (la generó INSTALAR.cmd). No compartas este archivo: tiene las claves.')
  foreach ($k in $order) { if ($h.ContainsKey($k)) { $lines += "$k=$($h[$k])" } }
  foreach ($k in $h.Keys) { if ($order -notcontains $k) { $lines += "$k=$($h[$k])" } }
  [System.IO.File]::WriteAllLines($EnvFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
}

function New-Secret([int]$bytes = 32, [switch]$Hex) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  if ($Hex) { return -join ($b | ForEach-Object { $_.ToString('x2') }) }
  return [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Test-Port([int]$port) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $a = $c.BeginConnect('127.0.0.1', $port, $null, $null); $ok = $a.AsyncWaitHandle.WaitOne(400); if ($ok) { $c.EndConnect($a) }; return $ok -and $c.Connected } catch { return $false } finally { $c.Close() }
}

function Get-NodeExe {
  $local = Join-Path $NodeDir 'node.exe'
  if (Test-Path $local) { return $local }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) {
    try {
      $v = (& $cmd.Source -v).Trim().TrimStart('v').Split('.')
      if ([int]$v[0] -gt 20 -or ([int]$v[0] -eq 20 -and [int]$v[1] -ge 19)) { return $cmd.Source }
    } catch { }
  }
  return $null
}

function Use-Node {
  $node = Get-NodeExe
  if (-not $node) { Fail 'No encuentro Node.js. Ejecuta primero INSTALAR.cmd.' }
  $dir = Split-Path $node -Parent
  if ($env:Path -notlike "$dir;*") { $env:Path = "$dir;$env:Path" }
  return $node
}

function Download([string[]]$urls, [string]$dest) {
  foreach ($u in $urls) {
    try {
      Say "   Descargando $u"
      Invoke-WebRequest -Uri $u -OutFile $dest -UseBasicParsing -MaximumRedirection 10 -TimeoutSec 1800
      if ((Get-Item $dest).Length -gt 1MB) { return $u }
    } catch { Say "   (no disponible: $($_.Exception.Message))" 'DarkGray' }
  }
  return $null
}

function Expand-Zip([string]$zip, [string]$dest) {
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (Test-Path $tar) { & $tar -xf $zip -C $dest; if ($LASTEXITCODE -eq 0) { return } }
  Expand-Archive -Path $zip -DestinationPath $dest -Force
}

function Get-Ports {
  $e = Read-Env
  $api = if ($e.API_PORT) { [int]$e.API_PORT } else { 3000 }
  $db = if ($e.DB_PORT) { [int]$e.DB_PORT } else { 3307 }
  return @{ Api = $api; Db = $db }
}

function Start-Mysql {
  $p = Get-Ports
  if (Test-Port $p.Db) { return }
  $mysqld = Join-Path $MysqlDir 'bin\mysqld.exe'
  if (-not (Test-Path $mysqld)) { Fail 'MySQL no está instalado. Ejecuta primero INSTALAR.cmd.' }
  Say "   Iniciando MySQL 8.4 en el puerto $($p.Db)..."
  $proc = Start-Process -FilePath $mysqld -ArgumentList "--defaults-file=`"$MysqlIni`"" -WindowStyle Hidden -PassThru
  Set-Content -Path (Join-Path $Runtime 'mysql.pid') -Value $proc.Id
  for ($i = 0; $i -lt 90; $i++) { if (Test-Port $p.Db) { Say '   MySQL listo.' 'Green'; return }; Start-Sleep -Milliseconds 700 }
  Fail "MySQL no respondió en el puerto $($p.Db). Revisa $Runtime\mysql-error.log"
}

function Stop-Mysql {
  $p = Get-Ports
  if (-not (Test-Port $p.Db)) { return }
  $admin = Join-Path $MysqlDir 'bin\mysqladmin.exe'
  if ((Test-Path $admin) -and (Test-Path $MysqlCnf)) {
    Invoke-Quiet { & $admin "--defaults-extra-file=$MysqlCnf" --port=$($p.Db) --host=127.0.0.1 shutdown }
    for ($i = 0; $i -lt 40; $i++) { if (-not (Test-Port $p.Db)) { return }; Start-Sleep -Milliseconds 500 }
  }
  $pidFile = Join-Path $Runtime 'mysql.pid'
  if (Test-Path $pidFile) { Stop-Process -Id (Get-Content $pidFile) -Force -ErrorAction SilentlyContinue }
}

# Apaga la API de Mesagri (la de esta carpeta o una versión anterior que haya quedado abierta).
function Stop-Api {
  $pidFile = Join-Path $Runtime 'api.pid'
  if (Test-Path $pidFile) { $apiPid = Get-Content $pidFile; Invoke-Quiet { & taskkill.exe /T /F /PID $apiPid }; Remove-Item $pidFile -Force -ErrorAction SilentlyContinue }
  try {
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like '*apps\api\dist\main.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  } catch { }
}

# Compilación de la API que está en la carpeta (la escribe npm run build); la API la informa en /health.
function Get-BuildId {
  $f = Join-Path $Root 'apps\api\dist\build-id.txt'
  if (Test-Path $f) { return (Get-Content $f -Raw).Trim() }
  return ''
}

function Get-LanUrls([int]$port) {
  $ips = @()
  try { $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -ExpandProperty IPAddress } catch { }
  return $ips | ForEach-Object { "http://$($_):$port" }
}
