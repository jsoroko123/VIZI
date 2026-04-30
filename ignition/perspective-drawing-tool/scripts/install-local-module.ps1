param(
    [string]$IgnitionHome = "",
    [string]$ModulePath = "",
    [string]$ServiceName = "Ignition",
    [switch]$BuildSigned,
    [switch]$AllowUnsignedDev,
    [switch]$Restart,
    [switch]$DryRun,
    [switch]$SkipModulesJson
)

$ErrorActionPreference = "Stop"

$ModuleId = "com.mesora.perspective.drawing"
$ModuleFileName = "MesoraPerspectiveDrawingTool.modl"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Resolve-Path (Join-Path $ScriptDir "..")

function Write-Step($message) {
    Write-Host "==> $message"
}

function Resolve-ExistingPath($path) {
    if ([string]::IsNullOrWhiteSpace($path)) {
        return $null
    }
    if (Test-Path -LiteralPath $path) {
        return (Resolve-Path -LiteralPath $path).Path
    }
    return $null
}

function Get-QuotedOrBarePath($text, $pattern) {
    $match = [regex]::Match($text, $pattern)
    if (-not $match.Success) {
        return $null
    }
    foreach ($groupName in @("quoted", "bare")) {
        $value = $match.Groups[$groupName].Value
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            return $value
        }
    }
    return $null
}

function Resolve-IgnitionHome {
    param([string]$RequestedHome, [string]$RequestedServiceName)

    $candidates = New-Object System.Collections.Generic.List[string]

    if (-not [string]::IsNullOrWhiteSpace($RequestedHome)) {
        $candidates.Add($RequestedHome)
    }

    if (-not [string]::IsNullOrWhiteSpace($env:IGNITION_HOME)) {
        $candidates.Add($env:IGNITION_HOME)
    }

    $service = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq $RequestedServiceName -or $_.DisplayName -eq $RequestedServiceName } |
        Select-Object -First 1

    if ($service -and -not [string]::IsNullOrWhiteSpace($service.PathName)) {
        $configPath = Get-QuotedOrBarePath $service.PathName '-s\s+(?:"(?<quoted>[^"]+)"|(?<bare>\S+))'
        if ($configPath) {
            $resolvedConfig = Resolve-ExistingPath $configPath
            if ($resolvedConfig) {
                $dataDir = Split-Path -Parent $resolvedConfig
                $candidates.Add((Split-Path -Parent $dataDir))
            }
        }

        $exePath = Get-QuotedOrBarePath $service.PathName '^(?:"(?<quoted>[^"]+IgnitionGateway\.exe)"|(?<bare>\S+IgnitionGateway\.exe))'
        if ($exePath) {
            $resolvedExe = Resolve-ExistingPath $exePath
            if ($resolvedExe) {
                $candidates.Add((Split-Path -Parent $resolvedExe))
            }
        }
    }

    foreach ($path in @(
        "C:\IgnitionDev",
        "C:\Ignition",
        "C:\Program Files\Inductive Automation\Ignition",
        "C:\Program Files (x86)\Inductive Automation\Ignition"
    )) {
        $candidates.Add($path)
    }

    foreach ($candidate in $candidates) {
        $resolved = Resolve-ExistingPath $candidate
        if (-not $resolved) {
            continue
        }

        $dataDir = Join-Path $resolved "data"
        $modulesDir = Join-Path $resolved "user-lib\modules"
        if ((Test-Path -LiteralPath $dataDir) -and (Test-Path -LiteralPath $modulesDir)) {
            return $resolved
        }
    }

    throw "Could not find an Ignition install. Pass -IgnitionHome or set IGNITION_HOME."
}

function Backup-File {
    param([string]$Path, [string]$Stamp)
    if (Test-Path -LiteralPath $Path) {
        $backup = "$Path.bak-$Stamp"
        if ($DryRun) {
            Write-Host "DRY RUN: would back up $Path to $backup"
        } else {
            Copy-Item -LiteralPath $Path -Destination $backup -Force
        }
    }
}

function Enable-AllowUnsignedModules {
    param([string]$ConfigPath, [string]$Stamp)

    if (-not (Test-Path -LiteralPath $ConfigPath)) {
        throw "Ignition config was not found at $ConfigPath"
    }

    $text = Get-Content -LiteralPath $ConfigPath -Raw
    if ($text -match '(?m)^\s*wrapper\.java\.additional\.\d+=-Dignition\.allowunsignedmodules=true\s*$') {
        Write-Step "Dev unsigned-module flag is already enabled"
        return
    }

    $numbers = [regex]::Matches($text, '(?m)^\s*wrapper\.java\.additional\.(\d+)=') |
        ForEach-Object { [int]$_.Groups[1].Value }
    $next = 1
    if ($numbers) {
        $next = ($numbers | Measure-Object -Maximum).Maximum + 1
    }

    Backup-File $ConfigPath $Stamp
    $line = "wrapper.java.additional.$next=-Dignition.allowunsignedmodules=true"

    if ($DryRun) {
        Write-Host "DRY RUN: would add $line to $ConfigPath"
        return
    }

    Add-Content -LiteralPath $ConfigPath -Value $line
    Write-Step "Added $line"
}

function Update-ModulesJson {
    param([string]$ModulesJsonPath, [string]$InstalledModulePath, [string]$Stamp)

    if (-not (Test-Path -LiteralPath $ModulesJsonPath)) {
        throw "modules.json was not found at $ModulesJsonPath"
    }

    Backup-File $ModulesJsonPath $Stamp

    $registry = Get-Content -LiteralPath $ModulesJsonPath -Raw | ConvertFrom-Json
    $existing = $registry.PSObject.Properties[$ModuleId]

    if ($existing) {
        $existing.Value.filename = $InstalledModulePath
        if (-not $existing.Value.onStartup) {
            $existing.Value | Add-Member -NotePropertyName "onStartup" -NotePropertyValue "enabled"
        } else {
            $existing.Value.onStartup = "enabled"
        }
    } else {
        $entry = [pscustomobject]@{
            filename = $InstalledModulePath
            onStartup = "enabled"
        }
        $registry | Add-Member -NotePropertyName $ModuleId -NotePropertyValue $entry
    }

    if ($DryRun) {
        Write-Host "DRY RUN: would update $ModulesJsonPath for $ModuleId -> $InstalledModulePath"
        return
    }

    $registry | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ModulesJsonPath -Encoding UTF8
    Write-Step "Updated modules.json entry for $ModuleId"
}

function Restart-Ignition {
    param([string]$IgnitionRoot, [string]$RequestedServiceName)

    $gwcmd = Join-Path $IgnitionRoot "gwcmd.bat"
    if (Test-Path -LiteralPath $gwcmd) {
        if ($DryRun) {
            Write-Host "DRY RUN: would run $gwcmd --restart --timeout 120"
            return
        }
        & $gwcmd --restart --timeout 120
        if ($LASTEXITCODE -ne 0) {
            throw "gwcmd restart failed with exit code $LASTEXITCODE"
        }
        return
    }

    if ($DryRun) {
        Write-Host "DRY RUN: would restart Windows service $RequestedServiceName"
        return
    }

    Restart-Service -Name $RequestedServiceName -Force
}

if ($BuildSigned) {
    Write-Step "Building signed module"
    $gradlew = Join-Path $ProjectDir "gradlew.bat"
    if (-not (Test-Path -LiteralPath $gradlew)) {
        throw "Gradle wrapper was not found at $gradlew"
    }
    if ($DryRun) {
        Write-Host "DRY RUN: would run $gradlew --console=plain buildSigned"
    } else {
        & $gradlew --console=plain buildSigned
        if ($LASTEXITCODE -ne 0) {
            throw "buildSigned failed with exit code $LASTEXITCODE"
        }
    }
}

if ([string]::IsNullOrWhiteSpace($ModulePath)) {
    $ModulePath = Join-Path $ProjectDir "build\$ModuleFileName"
}

$resolvedModulePath = Resolve-ExistingPath $ModulePath
if (-not $resolvedModulePath) {
    throw "Module file was not found at $ModulePath. Run .\gradlew buildSigned first or pass -BuildSigned."
}

$ignitionRoot = Resolve-IgnitionHome $IgnitionHome $ServiceName
$modulesDir = Join-Path $ignitionRoot "user-lib\modules"
$dataDir = Join-Path $ignitionRoot "data"
$configPath = Join-Path $dataDir "ignition.conf"
$modulesJsonPath = Join-Path $dataDir "modules.json"
$destination = Join-Path $modulesDir $ModuleFileName
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

Write-Step "Using Ignition home: $ignitionRoot"
Write-Step "Using module: $resolvedModulePath"

if ($AllowUnsignedDev) {
    Enable-AllowUnsignedModules $configPath $stamp
}

if (Test-Path -LiteralPath $destination) {
    Backup-File $destination $stamp
}

if ($DryRun) {
    Write-Host "DRY RUN: would copy $resolvedModulePath to $destination"
} else {
    Copy-Item -LiteralPath $resolvedModulePath -Destination $destination -Force
    Write-Step "Copied module to $destination"
}

if (-not $SkipModulesJson) {
    Update-ModulesJson $modulesJsonPath $destination $stamp
}

if ($Restart) {
    Restart-Ignition $ignitionRoot $ServiceName
}

Write-Step "Done"
