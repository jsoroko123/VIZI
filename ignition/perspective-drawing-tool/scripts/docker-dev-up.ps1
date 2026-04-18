param(
    [string]$GradleTask = "buildSigned",
    [string]$Service = "gateway"
)

$ErrorActionPreference = "Stop"
$moduleRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

Push-Location $moduleRoot
try {
    Write-Host "Building module with Gradle task '$GradleTask'..."
    & .\gradlew.bat $GradleTask --console=plain
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
