param(
  [string]$InstallRoot = "$env:LOCALAPPDATA\Vizi",
  [string]$SourceRoot = "",
  [switch]$SkipNodeInstall,
  [switch]$SkipPostgresInstall,
  [switch]$SkipOllamaInstall,
  [switch]$SkipDependencyInstall,
  [switch]$NoShortcuts,
  [switch]$UseNpmInstall,
  [string]$PostgresVersion = "17",
  [int]$PostgresPort = 5432,
  [string]$PostgresSuperUser = "postgres",
  [string]$PostgresSuperPassword = "postgres",
  [string]$PostgresDatabase = "vizi_db",
  [string]$PostgresAppUser = "vizi_user",
  [string]$PostgresAppPassword = "vizi_user",
  [string]$OllamaModel = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Refresh-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($machinePath -or $userPath) {
    $env:Path = "$machinePath;$userPath"
  }
}

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory = ""
  )

  $startInfo = @{
    FilePath = $FilePath
    ArgumentList = $Arguments
    NoNewWindow = $true
    Wait = $true
    PassThru = $true
  }
  if ($WorkingDirectory) {
    $startInfo.WorkingDirectory = $WorkingDirectory
  }

  $process = Start-Process @startInfo
  if ($process.ExitCode -ne 0) {
    $argText = if ($Arguments.Count -gt 0) { $Arguments -join " " } else { "" }
    throw "Command failed ($($process.ExitCode)): $FilePath $argText"
  }
}

function Get-CommandPathOrEmpty {
  param([string]$Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -eq $cmd) {
    return ""
  }
  return $cmd.Source
}

function Ensure-Node {
  param([switch]$AllowInstall)

  Refresh-ProcessPath
  $nodePath = Get-CommandPathOrEmpty -Name "node"
  if ($nodePath) {
    $versionText = (& node --version).Trim()
    $major = 0
    if ($versionText -match "^v(\d+)") {
      $major = [int]$Matches[1]
    }
    if ($major -ge 20) {
      Write-Host "Node.js detected: $versionText ($nodePath)"
      return
    }
    Write-Warning "Node.js $versionText is too old. Node.js 20+ is required."
  } else {
    Write-Warning "Node.js was not found."
  }

  if (-not $AllowInstall) {
    throw "Install Node.js 20+ and rerun installer. https://nodejs.org/"
  }

  $wingetPath = Get-CommandPathOrEmpty -Name "winget"
  if (-not $wingetPath) {
    throw "Node.js is missing and winget is unavailable. Install Node.js 20+ manually from https://nodejs.org/ and rerun."
  }

  Write-Step "Installing Node.js LTS"
  Invoke-Checked -FilePath "winget" -Arguments @(
    "install",
    "--id", "OpenJS.NodeJS.LTS",
    "--exact",
    "--source", "winget",
    "--silent",
    "--accept-package-agreements",
    "--accept-source-agreements"
  )
  Refresh-ProcessPath
  $nodePath = Get-CommandPathOrEmpty -Name "node"
  if (-not $nodePath) {
    throw "Node.js install completed but node is still not on PATH. Open a new terminal and rerun installer."
  }
  $versionText = (& node --version).Trim()
  Write-Host "Node.js installed: $versionText ($nodePath)"
}

function Find-OllamaPath {
  $ollamaFromPath = Get-CommandPathOrEmpty -Name "ollama"
  if ($ollamaFromPath) {
    return $ollamaFromPath
  }
  $candidate = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
  if (Test-Path $candidate) {
    return $candidate
  }
  return ""
}

function Ensure-Ollama {
  param([switch]$AllowInstall)

  $ollamaPath = Find-OllamaPath
  if ($ollamaPath) {
    Write-Host "Ollama detected: $ollamaPath"
    return $ollamaPath
  }

  if (-not $AllowInstall) {
    throw "Ollama was not found. Install it manually or run installer without -SkipOllamaInstall."
  }

  $wingetPath = Get-CommandPathOrEmpty -Name "winget"
  if (-not $wingetPath) {
    throw "Ollama is missing and winget is unavailable. Install Ollama manually and rerun."
  }

  Write-Step "Installing Ollama"
  Invoke-Checked -FilePath "winget" -Arguments @(
    "install",
    "--id", "Ollama.Ollama",
    "--exact",
    "--source", "winget",
    "--silent",
    "--accept-package-agreements",
    "--accept-source-agreements"
  )

  $ollamaPath = Find-OllamaPath
  if (-not $ollamaPath) {
    throw "Ollama installer finished, but ollama.exe was not found."
  }
  return $ollamaPath
}

function Pull-OllamaModel {
  param(
    [string]$OllamaPath,
    [string]$Model
  )

  $name = ([string]$Model).Trim()
  if (-not $name) {
    return
  }

  Write-Step "Pulling Ollama model: $name"
  Invoke-Checked -FilePath $OllamaPath -Arguments @("pull", $name)
}

function Find-PsqlPath {
  $psqlFromPath = Get-CommandPathOrEmpty -Name "psql"
  if ($psqlFromPath) {
    return $psqlFromPath
  }

  $roots = @()
  if ($env:ProgramFiles) {
    $roots += (Join-Path $env:ProgramFiles "PostgreSQL")
  }
  $pf86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  if ($pf86) {
    $roots += (Join-Path $pf86 "PostgreSQL")
  }
  $roots = $roots | Where-Object { $_ -and (Test-Path $_) }

  foreach ($root in $roots) {
    $candidates = Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue |
      Sort-Object -Property Name -Descending
    foreach ($dir in $candidates) {
      $exe = Join-Path $dir.FullName "bin\psql.exe"
      if (Test-Path $exe) {
        return $exe
      }
    }
  }

  return ""
}

function Ensure-Postgres {
  param(
    [switch]$AllowInstall,
    [string]$Version,
    [int]$Port,
    [string]$SuperUser,
    [string]$SuperPassword
  )

  $psqlPath = Find-PsqlPath
  if ($psqlPath) {
    Write-Host "PostgreSQL tools detected: $psqlPath"
    return @{
      PsqlPath = $psqlPath
      ExistingInstall = $true
    }
  }

  if (-not $AllowInstall) {
    throw "PostgreSQL was not found. Install it manually or run installer without -SkipPostgresInstall."
  }

  $wingetPath = Get-CommandPathOrEmpty -Name "winget"
  if (-not $wingetPath) {
    throw "PostgreSQL is missing and winget is unavailable. Install PostgreSQL manually and rerun."
  }

  $pkgId = "PostgreSQL.PostgreSQL.$Version"
  $serviceName = "postgresql-x64-$Version"
  $safePort = if ($Port -gt 0) { $Port } else { 5432 }
  $overrideArgs = @(
    "--mode", "unattended",
    "--unattendedmodeui", "minimal",
    "--serverport", "$safePort",
    "--servicename", $serviceName,
    "--serviceaccount", "postgres",
    "--superaccount", $SuperUser,
    "--superpassword", $SuperPassword
  )

  Write-Step "Installing PostgreSQL $Version"
  try {
    Invoke-Checked -FilePath "winget" -Arguments @(
      "install",
      "--id", $pkgId,
      "--exact",
      "--source", "winget",
      "--silent",
      "--accept-package-agreements",
      "--accept-source-agreements",
      "--override", ($overrideArgs -join " ")
    )
  } catch {
    Write-Warning "PostgreSQL install with unattended override failed, retrying with package defaults."
    Invoke-Checked -FilePath "winget" -Arguments @(
      "install",
      "--id", $pkgId,
      "--exact",
      "--source", "winget",
      "--silent",
      "--accept-package-agreements",
      "--accept-source-agreements"
    )
  }

  $psqlPath = Find-PsqlPath
  if (-not $psqlPath) {
    throw "PostgreSQL installer finished, but psql.exe was not found."
  }

  return @{
    PsqlPath = $psqlPath
    ExistingInstall = $false
  }
}

function Invoke-Psql {
  param(
    [string]$PsqlPath,
    [string]$DbHost = "127.0.0.1",
    [int]$Port = 5432,
    [string]$User = "postgres",
    [string]$Password = "",
    [string]$Database = "postgres",
    [string]$Sql
  )

  $priorPassword = $env:PGPASSWORD
  try {
    $env:PGPASSWORD = $Password
    $args = @(
      "-h", $DbHost,
      "-p", "$Port",
      "-U", $User,
      "-d", $Database,
      "-v", "ON_ERROR_STOP=1",
      "-c", $Sql
    )
    $output = & $PsqlPath @args 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "psql failed: $($output -join [Environment]::NewLine)"
    }
    return ($output -join [Environment]::NewLine)
  } finally {
    $env:PGPASSWORD = $priorPassword
  }
}

function Read-SecretPlainText {
  param([string]$Prompt)
  $secure = Read-Host -Prompt $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    if ($ptr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
  }
}

function Escape-SqlLiteral {
  param([string]$Value)
  return ($Value -replace "'", "''")
}

function Escape-SqlIdent {
  param([string]$Value)
  return ('"' + ($Value -replace '"', '""') + '"')
}

function Configure-PostgresForVizi {
  param(
    [string]$PsqlPath,
    [int]$Port,
    [string]$SuperUser,
    [string]$SuperPassword,
    [string]$DbName,
    [string]$AppUser,
    [string]$AppPassword,
    [switch]$AllowAuthPrompt
  )

  Write-Step "Configuring PostgreSQL database/user for Vizi"
  $effectiveSuperPassword = $SuperPassword

  $authOk = $false
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Invoke-Psql -PsqlPath $PsqlPath -Port $Port -User $SuperUser -Password $effectiveSuperPassword -Database "postgres" -Sql "SELECT 1;" | Out-Null
      $authOk = $true
      break
    } catch {
      $msg = $_.Exception.Message
      if ($msg -match "password authentication failed" -or $msg -match "28P01") {
        if (-not $AllowAuthPrompt) {
          throw "PostgreSQL authentication failed for user '$SuperUser'. On first-time install, rerun installer with -PostgresSuperPassword <your_password>."
        }
        if ($attempt -ge 3) {
          throw "PostgreSQL authentication failed for user '$SuperUser'. Rerun installer with -PostgresSuperPassword <your_password>."
        }
        Write-Warning "PostgreSQL login failed for user '$SuperUser'."
        $effectiveSuperPassword = Read-SecretPlainText -Prompt "Enter PostgreSQL password for user '$SuperUser'"
        continue
      }
      throw
    }
  }

  if (-not $authOk) {
    throw "Unable to authenticate to PostgreSQL."
  }

  $safeDb = Escape-SqlIdent $DbName
  $safeUser = Escape-SqlIdent $AppUser
  $safePass = Escape-SqlLiteral $AppPassword
  $safeUserLit = Escape-SqlLiteral $AppUser
  $safeDbLit = Escape-SqlLiteral $DbName
  $roleBlock = @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$safeUserLit') THEN
    CREATE ROLE $safeUser LOGIN PASSWORD '$safePass';
  ELSE
    ALTER ROLE $safeUser WITH LOGIN PASSWORD '$safePass';
  END IF;
END
`$`$;
"@
  Invoke-Psql -PsqlPath $PsqlPath -Port $Port -User $SuperUser -Password $effectiveSuperPassword -Database "postgres" -Sql $roleBlock | Out-Null

  $dbExistsOut = Invoke-Psql -PsqlPath $PsqlPath -Port $Port -User $SuperUser -Password $effectiveSuperPassword -Database "postgres" -Sql "SELECT 1 FROM pg_database WHERE datname = '$safeDbLit';"
  if (-not ($dbExistsOut -match "\b1\b")) {
    Invoke-Psql -PsqlPath $PsqlPath -Port $Port -User $SuperUser -Password $effectiveSuperPassword -Database "postgres" -Sql "CREATE DATABASE $safeDb OWNER $safeUser;" | Out-Null
  }
}

function Set-AiDatabaseUrl {
  param(
    [string]$Root,
    [int]$Port,
    [string]$Database,
    [string]$User,
    [string]$Password
  )

  $envPath = Join-Path $Root "ai-server\.env"
  if (-not (Test-Path $envPath)) {
    return
  }

  $encodedUser = [Uri]::EscapeDataString($User)
  $encodedPass = [Uri]::EscapeDataString($Password)
  $url = "postgres://$encodedUser`:$encodedPass@localhost:$Port/$Database"

  $content = Get-Content $envPath -Raw
  if ($content -match "(?m)^DATABASE_URL=.*$") {
    $content = [Regex]::Replace($content, "(?m)^DATABASE_URL=.*$", "DATABASE_URL=$url")
  } else {
    if ($content -and -not $content.EndsWith("`n")) {
      $content += "`r`n"
    }
    $content += "DATABASE_URL=$url`r`n"
  }
  Set-Content -Path $envPath -Value $content -Encoding Ascii
}

function Set-AiOllamaSettings {
  param(
    [string]$Root,
    [string]$Model
  )

  $envPath = Join-Path $Root "ai-server\.env"
  if (-not (Test-Path $envPath)) {
    return
  }
  $content = Get-Content $envPath -Raw

  if ($content -match "(?m)^OLLAMA_NATIVE_URL=.*$") {
    $content = [Regex]::Replace($content, "(?m)^OLLAMA_NATIVE_URL=.*$", "OLLAMA_NATIVE_URL=http://localhost:11434")
  } else {
    if ($content -and -not $content.EndsWith("`n")) { $content += "`r`n" }
    $content += "OLLAMA_NATIVE_URL=http://localhost:11434`r`n"
  }

  $modelName = ([string]$Model).Trim()
  if ($modelName) {
    if ($content -match "(?m)^OPENAI_MODEL=.*$") {
      $content = [Regex]::Replace($content, "(?m)^OPENAI_MODEL=.*$", "OPENAI_MODEL=$modelName")
    } else {
      if ($content -and -not $content.EndsWith("`n")) { $content += "`r`n" }
      $content += "OPENAI_MODEL=$modelName`r`n"
    }
  }

  Set-Content -Path $envPath -Value $content -Encoding Ascii
}

function Copy-AppTree {
  param(
    [string]$From,
    [string]$To
  )

  if (-not (Test-Path $From)) {
    throw "Source path not found: $From"
  }
  if (-not (Test-Path $To)) {
    New-Item -ItemType Directory -Path $To | Out-Null
  }

  Write-Step "Copying application files"
  $copyProcess = Start-Process -FilePath "robocopy" -ArgumentList @(
    $From,
    $To,
    "/E",
    "/R:1",
    "/W:1",
    "/XD", ".git", "node_modules", "dist", ".vite",
    "/XF", "*.log"
  ) -NoNewWindow -Wait -PassThru
  if ($copyProcess.ExitCode -gt 7) {
    throw "Copy failed (robocopy exit code $($copyProcess.ExitCode))."
  }
}

function Ensure-ConfigFiles {
  param([string]$Root)

  $aiEnv = Join-Path $Root "ai-server\.env"
  $aiEnvExample = Join-Path $Root "ai-server\.env.example"
  if ((-not (Test-Path $aiEnv)) -and (Test-Path $aiEnvExample)) {
    Copy-Item $aiEnvExample $aiEnv
  }

  $opcConfig = Join-Path $Root "opc-server\config.json"
  $opcConfigExample = Join-Path $Root "opc-server\config.example.json"
  if ((-not (Test-Path $opcConfig)) -and (Test-Path $opcConfigExample)) {
    Copy-Item $opcConfigExample $opcConfig
  }
}

function Install-Dependencies {
  param(
    [string]$Root,
    [switch]$UseInstall
  )

  $npmArgs = if ($UseInstall) { @("install") } else { @("ci") }
  Write-Step "Installing root dependencies ($($npmArgs -join ' '))"
  Invoke-Checked -FilePath "npm" -Arguments $npmArgs -WorkingDirectory $Root

  Write-Step "Installing OPC server dependencies ($($npmArgs -join ' '))"
  Invoke-Checked -FilePath "npm" -Arguments $npmArgs -WorkingDirectory (Join-Path $Root "opc-server")

  Write-Step "Installing AI server dependencies ($($npmArgs -join ' '))"
  Invoke-Checked -FilePath "npm" -Arguments $npmArgs -WorkingDirectory (Join-Path $Root "ai-server")
}

function Write-LauncherScripts {
  param([string]$Root)

  $startCmdPath = Join-Path $Root "Start-Vizi.cmd"
  $startCmd = @"
@echo off
setlocal
cd /d "%~dp0"
call npm run dev
endlocal
"@
  Set-Content -Path $startCmdPath -Value $startCmd -Encoding Ascii

  $stopCmdPath = Join-Path $Root "Stop-Vizi.cmd"
  $escapedRoot = [Regex]::Escape($Root)
  $stopCmd = @"
@echo off
setlocal
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { (`$_.Name -eq 'node.exe' -or `$_.Name -eq 'cmd.exe') -and `$_.CommandLine -match '$escapedRoot' } | ForEach-Object { try { Stop-Process -Id `$_.ProcessId -Force -ErrorAction Stop } catch {} }"
echo Vizi processes stopped.
endlocal
"@
  Set-Content -Path $stopCmdPath -Value $stopCmd -Encoding Ascii

  return @{
    Start = $startCmdPath
    Stop = $stopCmdPath
  }
}

function New-Shortcut {
  param(
    [string]$ShortcutPath,
    [string]$TargetPath,
    [string]$WorkingDirectory,
    [string]$Description
  )
  $wsh = New-Object -ComObject WScript.Shell
  $shortcut = $wsh.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $TargetPath
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.Description = $Description
  $shortcut.IconLocation = "shell32.dll,220"
  $shortcut.Save()
}

function Create-Shortcuts {
  param(
    [string]$Root,
    [string]$StartCmdPath
  )

  $desktopPath = [Environment]::GetFolderPath("Desktop")
  $startMenuPrograms = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
  $shortcutName = "Vizi.lnk"

  Write-Step "Creating shortcuts"
  New-Shortcut `
    -ShortcutPath (Join-Path $desktopPath $shortcutName) `
    -TargetPath $StartCmdPath `
    -WorkingDirectory $Root `
    -Description "Start Vizi"

  New-Shortcut `
    -ShortcutPath (Join-Path $startMenuPrograms $shortcutName) `
    -TargetPath $StartCmdPath `
    -WorkingDirectory $Root `
    -Description "Start Vizi"
}

if (-not $SourceRoot) {
  $SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$SourceRoot = (Resolve-Path $SourceRoot).Path
$InstallRoot = [Environment]::ExpandEnvironmentVariables($InstallRoot)

Write-Host "Vizi installer starting..." -ForegroundColor Green
Write-Host "Source:  $SourceRoot"
Write-Host "Install: $InstallRoot"

Ensure-Node -AllowInstall:(-not $SkipNodeInstall)
Copy-AppTree -From $SourceRoot -To $InstallRoot
Ensure-ConfigFiles -Root $InstallRoot

if (-not $SkipPostgresInstall) {
  $pg = Ensure-Postgres `
    -AllowInstall:$true `
    -Version $PostgresVersion `
    -Port $PostgresPort `
    -SuperUser $PostgresSuperUser `
    -SuperPassword $PostgresSuperPassword
  $psqlPath = $pg.PsqlPath
  Configure-PostgresForVizi `
    -PsqlPath $psqlPath `
    -Port $PostgresPort `
    -SuperUser $PostgresSuperUser `
    -SuperPassword $PostgresSuperPassword `
    -DbName $PostgresDatabase `
    -AppUser $PostgresAppUser `
    -AppPassword $PostgresAppPassword `
    -AllowAuthPrompt:([bool]$pg.ExistingInstall)
  Set-AiDatabaseUrl `
    -Root $InstallRoot `
    -Port $PostgresPort `
    -Database $PostgresDatabase `
    -User $PostgresAppUser `
    -Password $PostgresAppPassword
}

if (-not $SkipOllamaInstall) {
  $ollamaPath = Ensure-Ollama -AllowInstall:$true
  Pull-OllamaModel -OllamaPath $ollamaPath -Model $OllamaModel
  Set-AiOllamaSettings -Root $InstallRoot -Model $OllamaModel
}

if (-not $SkipDependencyInstall) {
  Install-Dependencies -Root $InstallRoot -UseInstall:$UseNpmInstall
}

$launchers = Write-LauncherScripts -Root $InstallRoot
if (-not $NoShortcuts) {
  Create-Shortcuts -Root $InstallRoot -StartCmdPath $launchers.Start
}

Write-Step "Install complete"
Write-Host "Start Vizi with:"
Write-Host "  $($launchers.Start)"
Write-Host ""
Write-Host "If AI features are needed, update:"
Write-Host "  $InstallRoot\ai-server\.env"
