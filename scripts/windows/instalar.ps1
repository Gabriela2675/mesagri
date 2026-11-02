# =============================================================================
# Mesagri · INSTALAR (Windows 10/11, sin permisos de administrador)
#  1. Node.js LTS portátil (si no hay uno de 20.19 o más nuevo)
#  2. MySQL 8.4 LTS portátil en el puerto 3307, solo para esta laptop
#  3. Base de datos y usuario con mínimos privilegios, claves al azar en .env
#  4. Dependencias (npm ci) y compilación (shared, API y web)
#  5. Accesos directos en el escritorio y arranque de Mesagri
# =============================================================================
. (Join-Path $PSScriptRoot 'comun.ps1')
Start-Transcript -Path (Join-Path $Logs 'instalar.log') -Append | Out-Null
try {
  Say ''
  Say '  MESAGRI · instalación del MVP' 'Cyan'
  Say '  App en React · API en NestJS · base de datos MySQL 8.4' 'Cyan'
  Say "  Carpeta: $Root"
  if ($Runtime -ne (Join-Path $Root 'runtime')) { Say "  La ruta tiene tildes o eñes: MySQL y Node portátiles van en $Runtime" 'Yellow' }

  # ---------------- 1. Node.js ----------------
  Step 'Node.js'
  $node = Get-NodeExe
  if ($node) {
    Say "   Se usa Node.js $(& $node -v) ($node)"
  } else {
    Say '   No hay Node.js 20.19 o más nuevo: se descarga Node.js LTS portátil (unos 35 MB)...'
    $idx = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
    $lts = $idx | Where-Object { $_.lts -and ($_.files -contains 'win-x64-zip') } | Select-Object -First 1
    if (-not $lts) { Fail 'No se pudo consultar la versión LTS de Node.js.' }
    $ver = $lts.version
    $zip = Join-Path $Runtime "node-$ver-win-x64.zip"
    if (-not (Download @("https://nodejs.org/dist/$ver/node-$ver-win-x64.zip") $zip)) { Fail 'No se pudo descargar Node.js. Revisa la conexión a internet y vuelve a ejecutar INSTALAR.cmd.' }
    $tmp = Join-Path $Runtime 'node-tmp'
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Zip $zip $tmp
    Remove-Item $NodeDir -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item (Join-Path $tmp "node-$ver-win-x64") $NodeDir
    Remove-Item $tmp, $zip -Recurse -Force -ErrorAction SilentlyContinue
    $node = Join-Path $NodeDir 'node.exe'
    Say "   Node.js $ver listo." 'Green'
  }
  $nodeBin = Split-Path $node -Parent
  $env:Path = "$nodeBin;$env:Path"
  $npm = Join-Path $nodeBin 'npm.cmd'
  if (-not (Test-Path $npm)) { $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source }
  if (-not $npm) { Fail 'No encuentro npm junto a Node.js.' }

  # ---------------- 2. MySQL 8.4 LTS ----------------
  Step 'MySQL 8.4 LTS'
  $envs = Read-Env
  $mysqld = Join-Path $MysqlDir 'bin\mysqld.exe'
  if (-not (Test-Path $mysqld)) {
    $sys = Join-Path $env:SystemRoot 'System32'
    if (-not (Test-Path (Join-Path $sys 'vcruntime140_1.dll')) -or -not (Test-Path (Join-Path $sys 'msvcp140.dll'))) {
      Say '   MySQL necesita el runtime de Visual C++ 2015-2022. Se instala ahora: acepta el aviso de Windows.' 'Yellow'
      $vc = Join-Path $Runtime 'vc_redist.x64.exe'
      if (Download @('https://aka.ms/vs/17/release/vc_redist.x64.exe') $vc) {
        try { Start-Process -FilePath $vc -ArgumentList '/install', '/quiet', '/norestart' -Verb RunAs -Wait } catch { Say '   No se instaló el runtime de Visual C++ (se canceló el aviso).' 'Yellow' }
      }
    }
    Say '   Descargando MySQL 8.4 LTS para Windows (unos 280 MB, puede tardar)...'
    $zip = Join-Path $Runtime 'mysql-8.4-winx64.zip'
    $urls = @()
    foreach ($v in @(16, 15, 14, 13, 11, 10, 9, 8, 7, 6)) {
      $urls += "https://dev.mysql.com/get/Downloads/MySQL-8.4/mysql-8.4.$v-winx64.zip"
      $urls += "https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.$v-winx64.zip"
      $urls += "https://downloads.mysql.com/archives/get/p/23/file/mysql-8.4.$v-winx64.zip"
    }
    $got = Download $urls $zip
    if (-not $got) { Fail 'No se pudo descargar MySQL 8.4. Revisa la conexión a internet y vuelve a ejecutar INSTALAR.cmd.' }
    Say "   Descargado: $got"
    Say '   Descomprimiendo...'
    $tmp = Join-Path $Runtime 'mysql-tmp'
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Zip $zip $tmp
    $inner = Get-ChildItem $tmp -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'bin\mysqld.exe') } | Select-Object -First 1
    if (-not $inner) { Fail 'El archivo de MySQL no tiene bin\mysqld.exe.' }
    Remove-Item $MysqlDir -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item $inner.FullName $MysqlDir
    Remove-Item $tmp, $zip -Recurse -Force -ErrorAction SilentlyContinue
    Say "   $( (& $mysqld --version) )" 'Green'
  } else {
    Say "   Ya instalado: $( (& $mysqld --version) )"
  }

  # Puertos libres (3307 para MySQL y 3000 para Mesagri, o los siguientes)
  $dbPort = if ($envs.DB_PORT) { [int]$envs.DB_PORT } else { 3307 }
  $apiPort = if ($envs.API_PORT) { [int]$envs.API_PORT } else { 3000 }
  $fresh = -not (Test-Path (Join-Path $MysqlData 'mysql'))
  if ($fresh) { while (Test-Port $dbPort) { $dbPort++ } }
  if (-not $envs.API_PORT) { while (Test-Port $apiPort) { $apiPort++ } }

  $fw = { param($p) $p.Replace('\', '/') }
  $ini = @(
    '[mysqld]',
    "basedir=`"$(& $fw $MysqlDir)`"",
    "datadir=`"$(& $fw $MysqlData)`"",
    "port=$dbPort",
    'bind-address=127.0.0.1',
    'mysqlx=OFF',
    'character-set-server=utf8mb4',
    'collation-server=utf8mb4_0900_ai_ci',
    'default-time-zone=+00:00',
    "log-error=`"$(& $fw (Join-Path $Runtime 'mysql-error.log'))`"",
    'max_connections=80',
    'innodb_buffer_pool_size=256M',
    # Sin skip-name-resolve: con él, root@localhost no podría entrar por 127.0.0.1 (en Windows no hay socket)
    '',
    '[client]',
    "port=$dbPort",
    'default-character-set=utf8mb4'
  )
  [System.IO.File]::WriteAllLines($MysqlIni, $ini, (New-Object System.Text.UTF8Encoding($false)))

  if ($fresh) {
    Say '   Creando la base de datos de MySQL...'
    New-Item -ItemType Directory -Force -Path $MysqlData | Out-Null
    Invoke-Quiet { & $mysqld "--defaults-file=$MysqlIni" --initialize-insecure }
    if (-not (Test-Path (Join-Path $MysqlData 'mysql'))) { Fail "MySQL no pudo inicializar la carpeta de datos. Revisa $Runtime\mysql-error.log" }
  }
  $envs.DB_PORT = "$dbPort"
  Write-Env $envs
  Start-Mysql

  $mysql = Join-Path $MysqlDir 'bin\mysql.exe'
  if (-not $envs.DB_PASSWORD -or $fresh) {
    Say '   Usuario de la aplicación con permisos solo sobre la base «mesagri»...'
    $rootPw = New-Secret 18
    $appPw = New-Secret 18
    $sql = "ALTER USER 'root'@'localhost' IDENTIFIED BY '$rootPw'; " +
           "CREATE DATABASE IF NOT EXISTS mesagri CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; " +
           "CREATE USER IF NOT EXISTS 'mesagri'@'localhost' IDENTIFIED BY '$appPw'; " +
           "CREATE USER IF NOT EXISTS 'mesagri'@'127.0.0.1' IDENTIFIED BY '$appPw'; " +
           "ALTER USER 'mesagri'@'localhost' IDENTIFIED BY '$appPw'; ALTER USER 'mesagri'@'127.0.0.1' IDENTIFIED BY '$appPw'; " +
           "GRANT ALL PRIVILEGES ON mesagri.* TO 'mesagri'@'localhost'; GRANT ALL PRIVILEGES ON mesagri.* TO 'mesagri'@'127.0.0.1'; FLUSH PRIVILEGES;"
    $rootArgs = @('--host=127.0.0.1', "--port=$dbPort", '--user=root')
    if ($envs.MYSQL_ROOT_PASSWORD) { $rootArgs += "--password=$($envs.MYSQL_ROOT_PASSWORD)" }
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & $mysql @rootArgs -e $sql
    $code = $LASTEXITCODE; $ErrorActionPreference = $prev
    if ($code -ne 0) { Fail 'No se pudo crear el usuario de MySQL.' }
    [System.IO.File]::WriteAllLines($MysqlCnf, @('[client]', 'user=root', "password=$rootPw", 'host=127.0.0.1', "port=$dbPort"), (New-Object System.Text.UTF8Encoding($false)))
    $envs.MYSQL_ROOT_PASSWORD = $rootPw
    $envs.DB_PASSWORD = $appPw
  }

  # ---------------- 3. Configuración (.env) ----------------
  Step 'Configuración'
  if (-not $envs.JWT_SECRET) { $envs.JWT_SECRET = New-Secret 48 }
  if (-not $envs.DATA_KEY) { $envs.DATA_KEY = New-Secret 32 -Hex }
  if (-not $envs.ADMIN_PASSWORD) { $envs.ADMIN_PASSWORD = 'demo-mesagri' }
  $envs.API_PORT = "$apiPort"; $envs.API_HOST = '0.0.0.0'
  $envs.DB_HOST = '127.0.0.1'; $envs.DB_NAME = 'mesagri'; $envs.DB_USER = 'mesagri'
  if (-not $envs.DEMO_MODE) { $envs.DEMO_MODE = 'true' }
  if (-not $envs.DEMO_CLOCK) { $envs.DEMO_CLOCK = 'resume' }
  Write-Env $envs
  Say "   .env listo (MySQL en el puerto $dbPort, Mesagri en el puerto $apiPort; claves generadas al azar)." 'Green'

  # ---------------- 4. Dependencias y compilación ----------------
  # si Mesagri está abierto (por ejemplo, la versión anterior), se cierra antes de actualizar:
  # así npm no choca con archivos en uso y al final arranca la versión nueva
  Stop-Api
  Step 'Dependencias (npm ci, la primera vez tarda unos minutos)'
  Push-Location $Root
  try {
    $ErrorActionPreference = 'Continue'
    $env:SCARF_ANALYTICS = 'false'; $env:DO_NOT_TRACK = '1'
    & $npm ci --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -ne 0) {
      Say '   npm ci no terminó bien; se intenta con npm install...' 'Yellow'
      & $npm install --no-audit --no-fund --loglevel=error
      if ($LASTEXITCODE -ne 0) { Fail 'No se pudieron instalar las dependencias. Revisa la conexión a internet.' }
    }
    Step 'Compilación (reglas compartidas, API y app web)'
    & $npm run build
    if ($LASTEXITCODE -ne 0) { Fail 'La compilación falló. Revisa logs\instalar.log.' }
  } finally { Pop-Location; $ErrorActionPreference = 'Stop' }

  # ---------------- 5. Accesos directos ----------------
  Step 'Accesos directos'
  try {
    $desk = [Environment]::GetFolderPath('Desktop')
    $sh = New-Object -ComObject WScript.Shell
    foreach ($s in @(@('Mesagri (iniciar)', 'INICIAR.cmd'), @('Mesagri (detener)', 'DETENER.cmd'))) {
      $lnk = $sh.CreateShortcut((Join-Path $desk "$($s[0]).lnk"))
      $lnk.TargetPath = Join-Path $Root $s[1]
      $lnk.WorkingDirectory = $Root
      $lnk.IconLocation = "$env:SystemRoot\System32\shell32.dll,$(if ($s[1] -eq 'INICIAR.cmd') { 137 } else { 27 })"
      $lnk.Save()
    }
    Say '   En el escritorio: «Mesagri (iniciar)» y «Mesagri (detener)».' 'Green'
  } catch { Say '   No se pudieron crear los accesos directos (no es grave).' 'Yellow' }

  Step 'Instalación completa · iniciando Mesagri'
  & (Join-Path $PSScriptRoot 'iniciar.ps1') -FromInstaller
} catch {
  Say ''
  Say "La instalación no terminó: $($_.Exception.Message)" 'Red'
  Say "Detalle en $Logs\instalar.log" 'Yellow'
  exit 1
} finally {
  Stop-Transcript | Out-Null
}
