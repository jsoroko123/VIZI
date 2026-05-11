param(
    [string]$GradleTask = "buildSigned",
    [string]$Service = "gateway"
)

$ErrorActionPreference = "Stop"
$moduleRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Resolve-ModuleJavaHome {
    $candidates = @()
    if ($env:JAVA_HOME) {
        $candidates += $env:JAVA_HOME
    }

    $preferred = @(
        "C:\Program Files\OpenLogic\jdk-17.0.14.7-hotspot",
        "C:\Java\jdk-17",
        "C:\Program Files\Java\jdk-17",
        "C:\Program Files\Eclipse Adoptium",
        "C:\Program Files\Java\latest",
        "C:\Program Files\Java\jdk-24"
    )
    $candidates += $preferred

    $searchRoots = @(
        "C:\Program Files\OpenLogic",
        "C:\Java",
        "C:\Program Files\Java",
        "C:\Program Files\Eclipse Adoptium",
        "C:\Program Files\Microsoft"
    )
    foreach ($root in $searchRoots) {
        if (!(Test-Path $root)) {
            continue
        }
        $candidates += Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match "^jdk" } |
            Sort-Object Name -Descending |
            ForEach-Object { $_.FullName }
    }

    foreach ($candidate in $candidates) {
        $path = [string]$candidate
        if (!$path) {
            continue
        }
        $javaExe = Join-Path $path "bin\java.exe"
        if (Test-Path $javaExe) {
            return (Resolve-Path $path).Path
        }
    }

    return $null
}

$javaHome = Resolve-ModuleJavaHome
if ($javaHome) {
    $env:JAVA_HOME = $javaHome
    Write-Host "Using JAVA_HOME=$javaHome"
} else {
    Write-Warning "No valid JDK JAVA_HOME was found. Gradle will use PATH if possible."
}

Push-Location $moduleRoot
try {
    Write-Host "Building module with Gradle task '$GradleTask' (forced fresh build)..."
    & .\gradlew.bat $GradleTask --console=plain --rerun-tasks
    if ($LASTEXITCODE -ne 0) {
        throw "Gradle task '$GradleTask' failed."
    }

    Write-Host "Building Docker image for service '$Service'..."
    docker compose build $Service
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose build $Service failed."
    }

    Write-Host "Starting Docker service '$Service'..."
    docker compose up -d $Service
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose up -d $Service failed."
    }

    Write-Host "Gateway is starting on http://localhost:9088"
} finally {
    Pop-Location
}
