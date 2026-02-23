param(
  [string]$InstallRoot = "$env:LOCALAPPDATA\Mesora",
  [string]$SourceRoot = "",
  [switch]$SkipNodeInstall,
  [switch]$SkipPostgresInstall,
  [switch]$SkipOllamaInstall,
  [switch]$SkipDependencyInstall,
  [switch]$NoShortcuts,
  [switch]$UseNpmInstall,
  [string]$PostgresVersion = "17",
  [int]$PostgresPort = 5432,
  [int]$AiServerPort = 5055,
  [int]$OpcUaPort = 4840,
  [string]$PostgresSuperUser = "postgres",
  [string]$PostgresSuperPassword = "postgres",
  [string]$PostgresDatabase = "mesora_db",
  [string]$PostgresAppUser = "mesora_user",
  [string]$PostgresAppPassword = "mesora_user",
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

function Get-NpmLauncher {
  $npmCmd = Get-Command -Name "npm.cmd" -ErrorAction SilentlyContinue
  if ($npmCmd -and $npmCmd.Source) {
    return $npmCmd.Source
  }
  return "npm"
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

function Install-OllamaDirect {
  $url = "https://ollama.com/download/OllamaSetup.exe"
  $tempExe = Join-Path $env:TEMP "OllamaSetup.exe"

  Write-Step "Downloading Ollama installer"
  Invoke-WebRequest -Uri $url -OutFile $tempExe -UseBasicParsing
  if (-not (Test-Path $tempExe)) {
    throw "Failed to download Ollama installer."
  }

  Write-Step "Running Ollama installer"
  try {
    Invoke-Checked -FilePath $tempExe -Arguments @("/S")
  } catch {
    Write-Warning "Silent Ollama install failed. Retrying interactive installer."
    Invoke-Checked -FilePath $tempExe -Arguments @()
  }
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
  if ($wingetPath) {
    Write-Step "Installing Ollama via winget"
    $installAttempts = @(
      @(
        "install",
        "--id", "Ollama.Ollama",
        "--exact",
        "--source", "winget",
        "--silent",
        "--accept-package-agreements",
        "--accept-source-agreements"
      ),
      @(
        "source",
        "update"
      ),
      @(
        "install",
        "--id", "Ollama.Ollama",
        "--exact",
        "--source", "winget",
        "--accept-package-agreements",
        "--accept-source-agreements"
      )
    )

    foreach ($attempt in $installAttempts) {
      try {
        Invoke-Checked -FilePath "winget" -Arguments $attempt
        break
      } catch {
        Write-Warning ($_.Exception.Message)
      }
    }
  } else {
    Write-Warning "winget is unavailable. Falling back to direct Ollama installer."
  }

  $ollamaPath = Find-OllamaPath
  if (-not $ollamaPath) {
    try {
      Install-OllamaDirect
    } catch {
      throw "Failed to install Ollama automatically. Install Ollama manually from https://ollama.com/download/windows and rerun installer. Details: $($_.Exception.Message)"
    }
    $ollamaPath = Find-OllamaPath
    if (-not $ollamaPath) {
      throw "Ollama install completed but ollama.exe was not found. Install manually and rerun installer."
    }
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

function Configure-PostgresForMesora {
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

  Write-Step "Configuring PostgreSQL database/user for Mesora"
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

function Upsert-EnvValue {
  param(
    [string]$EnvPath,
    [string]$Key,
    [string]$Value
  )
  if (-not (Test-Path $EnvPath)) {
    return
  }
  $content = Get-Content $EnvPath -Raw
  $escapedKey = [Regex]::Escape($Key)
  if ($content -match "(?m)^$escapedKey=.*$") {
    $content = [Regex]::Replace($content, "(?m)^$escapedKey=.*$", "$Key=$Value")
  } else {
    if ($content -and -not $content.EndsWith("`n")) {
      $content += "`r`n"
    }
    $content += "$Key=$Value`r`n"
  }
  Set-Content -Path $EnvPath -Value $content -Encoding Ascii
}

function Set-AiServerPort {
  param(
    [string]$Root,
    [int]$Port
  )
  if ($Port -lt 1 -or $Port -gt 65535) {
    throw "AiServerPort must be between 1 and 65535."
  }
  $envPath = Join-Path $Root "ai-server\.env"
  Upsert-EnvValue -EnvPath $envPath -Key "PORT" -Value "$Port"
}

function Set-OpcUaPort {
  param(
    [string]$Root,
    [int]$Port
  )
  if ($Port -lt 1 -or $Port -gt 65535) {
    throw "OpcUaPort must be between 1 and 65535."
  }
  $configPath = Join-Path $Root "opc-server\config.json"
  if (-not (Test-Path $configPath)) {
    return
  }
  $raw = Get-Content $configPath -Raw
  if (-not $raw) {
    return
  }
  $json = $raw | ConvertFrom-Json
  if (-not $json.opcua) {
    $json | Add-Member -MemberType NoteProperty -Name "opcua" -Value ([pscustomobject]@{})
  }
  $json.opcua.port = $Port
  ($json | ConvertTo-Json -Depth 100) | Set-Content -Path $configPath -Encoding Ascii
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
    "/XD", ".git", "node_modules", ".vite",
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
  $npmLauncher = Get-NpmLauncher
  $targets = @(
    @{ Name = "root"; Dir = $Root },
    @{ Name = "OPC server"; Dir = (Join-Path $Root "opc-server") },
    @{ Name = "AI server"; Dir = (Join-Path $Root "ai-server") }
  )

  foreach ($target in $targets) {
    $dir = [string]$target.Dir
    $name = [string]$target.Name
    try {
      Write-Step "Installing $name dependencies ($($npmArgs -join ' '))"
      Invoke-Checked -FilePath $npmLauncher -Arguments $npmArgs -WorkingDirectory $dir
    } catch {
      if ($UseInstall -or ($npmArgs -join " ") -eq "install") {
        throw
      }
      Write-Warning "npm ci failed for $name. Falling back to npm install."
      Invoke-Checked -FilePath $npmLauncher -Arguments @("install") -WorkingDirectory $dir
    }
  }
}

function Build-Frontend {
  param([string]$Root)

  $indexHtml = Join-Path $Root "index.html"
  $viteConfig = Join-Path $Root "vite.config.js"
  $distIndex = Join-Path $Root "dist\index.html"
  if ((-not (Test-Path $indexHtml)) -or (-not (Test-Path $viteConfig))) {
    if (Test-Path $distIndex) {
      Write-Warning "Frontend source files are not present in this package. Using prebuilt dist bundle."
      return
    }
    throw "Frontend source files are missing and no prebuilt dist bundle was found."
  }

  $npmLauncher = Get-NpmLauncher
  Write-Step "Building frontend bundle (npm run build)"
  Invoke-Checked -FilePath $npmLauncher -Arguments @("run", "build") -WorkingDirectory $Root
}

function Write-LauncherScripts {
  param(
    [string]$Root,
    [int]$AiPort = 5055,
    [int]$OpcUaPortValue = 4840
  )

  $startCmdPath = Join-Path $Root "Start-Mesora.cmd"
  $startCmd = @"
@echo off
setlocal
cd /d "%~dp0"
set MESORA_AI_PORT=$AiPort
set MESORA_OPCUA_PORT=$OpcUaPortValue
call npm run start:prod
endlocal
"@
  Set-Content -Path $startCmdPath -Value $startCmd -Encoding Ascii

  $runPs1Path = Join-Path $Root "Run-Mesora.ps1"
  $runPs1 = @"
Set-StrictMode -Version Latest
`$ErrorActionPreference = "Stop"

Set-Location -Path (Split-Path -Parent `$MyInvocation.MyCommand.Path)
`$env:MESORA_AI_PORT = "$AiPort"
`$env:MESORA_OPCUA_PORT = "$OpcUaPortValue"
`$npm = Get-Command -Name "npm.cmd" -ErrorAction SilentlyContinue
if (`$npm -and `$npm.Source) {
  & `$npm.Source run start:prod
  exit `$LASTEXITCODE
}

& npm run start:prod
exit `$LASTEXITCODE
"@
  Set-Content -Path $runPs1Path -Value $runPs1 -Encoding Ascii

  $stopCmdPath = Join-Path $Root "Stop-Mesora.cmd"
  $escapedRoot = [Regex]::Escape($Root)
  $stopCmd = @"
@echo off
setlocal
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { (`$_.Name -eq 'node.exe' -or `$_.Name -eq 'cmd.exe') -and `$_.CommandLine -match '$escapedRoot' } | ForEach-Object { try { Stop-Process -Id `$_.ProcessId -Force -ErrorAction Stop } catch {} }"
echo Mesora processes stopped.
endlocal
"@
  Set-Content -Path $stopCmdPath -Value $stopCmd -Encoding Ascii

  return @{
    Start = $startCmdPath
    RunPs1 = $runPs1Path
    Stop = $stopCmdPath
    WebUrl = "http://localhost:$AiPort"
  }
}

function Register-AutoStartTask {
  param(
    [string]$Root,
    [string]$RunScriptPath
  )

  $taskName = "Mesora Auto Start"
  $quotedScript = '"' + $RunScriptPath.Replace('"', '""') + '"'
  $taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $quotedScript"

  Write-Step "Registering Windows startup task"
  try {
    Invoke-Checked -FilePath "schtasks.exe" -Arguments @(
      "/Create",
      "/TN", $taskName,
      "/SC", "ONLOGON",
      "/TR", $taskCommand,
      "/F"
    )
    Write-Host "Startup task registered: $taskName"
  } catch {
    Write-Warning "Unable to register startup task automatically. You can still start with Start-Mesora.cmd. Details: $($_.Exception.Message)"
  }
}

function Start-MesoraNow {
  param(
    [string]$Root,
    [string]$RunScriptPath
  )

  Write-Step "Starting Mesora services"
  try {
    $existing = Get-NetTCPConnection -State Listen -LocalPort 5055 -ErrorAction SilentlyContinue
    if ($existing) {
      Write-Host "Mesora appears to already be running on port 5055."
      return
    }
  } catch {
    # Ignore detection errors and attempt to start.
  }

  try {
    Start-Process -FilePath "powershell.exe" -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-WindowStyle", "Hidden",
      "-File", $RunScriptPath
    ) -WindowStyle Hidden -WorkingDirectory $Root | Out-Null
    Start-Sleep -Seconds 2
    Write-Host "Mesora launch requested (background)."
  } catch {
    Write-Warning "Failed to start Mesora automatically. Launch manually with Start-Mesora.cmd. Details: $($_.Exception.Message)"
  }
}

function New-Shortcut {
  param(
    [string]$ShortcutPath,
    [string]$TargetPath,
    [string]$WorkingDirectory,
    [string]$Description,
    [string]$IconPath = ""
  )
  $wsh = New-Object -ComObject WScript.Shell
  $shortcut = $wsh.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $TargetPath
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.Description = $Description
  if ($IconPath -and (Test-Path $IconPath)) {
    $shortcut.IconLocation = "$IconPath,0"
  } else {
    $shortcut.IconLocation = "shell32.dll,220"
  }
  $shortcut.Save()
}

function Ensure-LogoIco {
  param(
    [string]$Root
  )

  $candidatePng = @(
    (Join-Path $Root "public\logo.png"),
    (Join-Path $Root "src\assets\Images\logo.png")
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1

  if (-not $candidatePng) {
    return ""
  }

  $iconDir = Join-Path $Root "icons"
  New-Item -ItemType Directory -Path $iconDir -Force | Out-Null
  $icoPath = Join-Path $iconDir "mesora-logo.ico"

  try {
    Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue | Out-Null
    $img = [System.Drawing.Image]::FromFile($candidatePng)
    try {
      $width = [Math]::Min(256, [int]$img.Width)
      $height = [Math]::Min(256, [int]$img.Height)
    } finally {
      $img.Dispose()
    }

    $pngBytes = [System.IO.File]::ReadAllBytes($candidatePng)
    $fs = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
    try {
      $bw = New-Object System.IO.BinaryWriter($fs)
      try {
        # ICONDIR
        $bw.Write([UInt16]0) # reserved
        $bw.Write([UInt16]1) # icon type
        $bw.Write([UInt16]1) # image count
        # ICONDIRENTRY
        $bw.Write([Byte](if ($width -ge 256) { 0 } else { $width }))
        $bw.Write([Byte](if ($height -ge 256) { 0 } else { $height }))
        $bw.Write([Byte]0)   # color count
        $bw.Write([Byte]0)   # reserved
        $bw.Write([UInt16]1) # planes
        $bw.Write([UInt16]32) # bit count
        $bw.Write([UInt32]$pngBytes.Length) # bytes in resource
        $bw.Write([UInt32]22) # image offset
        $bw.Write($pngBytes)
      } finally {
        $bw.Dispose()
      }
    } finally {
      $fs.Dispose()
    }
    return $icoPath
  } catch {
    Write-Warning "Could not generate Mesora icon from logo: $($_.Exception.Message)"
    return ""
  }
}

function New-WebsiteShortcut {
  param(
    [string]$ShortcutPath,
    [string]$Url,
    [string]$IconPath = ""
  )

  $iconFile = if ($IconPath -and (Test-Path $IconPath)) { $IconPath } else { "%SystemRoot%\System32\SHELL32.dll" }
  $iconIndex = if ($IconPath -and (Test-Path $IconPath)) { 0 } else { 220 }
  $content = @"
[InternetShortcut]
URL=$Url
IconFile=$iconFile
IconIndex=$iconIndex
"@
  Set-Content -Path $ShortcutPath -Value $content -Encoding Ascii
}

function Create-Shortcuts {
  param(
    [string]$Root,
    [string]$StartCmdPath,
    [string]$WebUrl = "http://localhost:5055"
  )

  $desktopPath = [Environment]::GetFolderPath("Desktop")
  $startMenuPrograms = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
  $shortcutName = "Mesora.lnk"
  $webShortcutName = "Mesora Web.url"
  $iconPath = Ensure-LogoIco -Root $Root

  Write-Step "Creating shortcuts"
  New-Shortcut `
    -ShortcutPath (Join-Path $desktopPath $shortcutName) `
    -TargetPath $StartCmdPath `
    -WorkingDirectory $Root `
    -Description "Start Mesora" `
    -IconPath $iconPath

  New-Shortcut `
    -ShortcutPath (Join-Path $startMenuPrograms $shortcutName) `
    -TargetPath $StartCmdPath `
    -WorkingDirectory $Root `
    -Description "Start Mesora" `
    -IconPath $iconPath

  New-WebsiteShortcut `
    -ShortcutPath (Join-Path $desktopPath $webShortcutName) `
    -Url $WebUrl `
    -IconPath $iconPath

  New-WebsiteShortcut `
    -ShortcutPath (Join-Path $startMenuPrograms $webShortcutName) `
    -Url $WebUrl `
    -IconPath $iconPath
}

if (-not $SourceRoot) {
  $SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$SourceRoot = (Resolve-Path $SourceRoot).Path
$InstallRoot = [Environment]::ExpandEnvironmentVariables($InstallRoot)
if ($PostgresPort -lt 1 -or $PostgresPort -gt 65535) { throw "PostgresPort must be between 1 and 65535." }
if ($AiServerPort -lt 1 -or $AiServerPort -gt 65535) { throw "AiServerPort must be between 1 and 65535." }
if ($OpcUaPort -lt 1 -or $OpcUaPort -gt 65535) { throw "OpcUaPort must be between 1 and 65535." }

Write-Host "Mesora installer starting..." -ForegroundColor Green
Write-Host "Source:  $SourceRoot"
Write-Host "Install: $InstallRoot"

Ensure-Node -AllowInstall:(-not $SkipNodeInstall)
Copy-AppTree -From $SourceRoot -To $InstallRoot
Ensure-ConfigFiles -Root $InstallRoot
Set-AiServerPort -Root $InstallRoot -Port $AiServerPort
Set-OpcUaPort -Root $InstallRoot -Port $OpcUaPort

if (-not $SkipPostgresInstall) {
  $pg = Ensure-Postgres `
    -AllowInstall:$true `
    -Version $PostgresVersion `
    -Port $PostgresPort `
    -SuperUser $PostgresSuperUser `
    -SuperPassword $PostgresSuperPassword
  $psqlPath = $pg.PsqlPath
  Configure-PostgresForMesora `
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

Write-Step "AI runtime install"
Write-Host "Ollama auto-install has been removed from the installer."
Write-Host "Configure AI providers/agents from: /ai-config after install."

if (-not $SkipDependencyInstall) {
  Install-Dependencies -Root $InstallRoot -UseInstall:$UseNpmInstall
  Build-Frontend -Root $InstallRoot
}

$launchers = Write-LauncherScripts -Root $InstallRoot -AiPort $AiServerPort -OpcUaPortValue $OpcUaPort
Register-AutoStartTask -Root $InstallRoot -RunScriptPath $launchers.RunPs1
Start-MesoraNow -Root $InstallRoot -RunScriptPath $launchers.RunPs1
if (-not $NoShortcuts) {
  Create-Shortcuts -Root $InstallRoot -StartCmdPath $launchers.Start -WebUrl $launchers.WebUrl
}

Write-Step "Install complete"
Write-Host "Start Mesora with:"
Write-Host "  $($launchers.Start)"
Write-Host "Open Mesora web UI:"
Write-Host "  $($launchers.WebUrl)"
Write-Host ""
Write-Host "If AI features are needed, update:"
Write-Host "  $InstallRoot\ai-server\.env"
