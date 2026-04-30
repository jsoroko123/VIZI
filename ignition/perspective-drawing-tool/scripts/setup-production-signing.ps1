param(
    [Parameter(Mandatory = $true)]
    [string]$PfxPath,

    [Parameter(Mandatory = $true)]
    [string]$ChainPath,

    [string]$Alias = "",
    [string]$StorePass = "",
    [string]$KeyPass = "",
    [string]$ModuleDir = (Split-Path -Parent $PSScriptRoot),
    [switch]$BuildSigned,
    [switch]$NoCopy
)

$ErrorActionPreference = "Stop"

$resolvedModuleDir = (Resolve-Path -LiteralPath $ModuleDir).Path
$privateDir = Join-Path $resolvedModuleDir "private"
$signPropsPath = Join-Path $resolvedModuleDir "sign.props"
$resolvedPfxPath = (Resolve-Path -LiteralPath $PfxPath).Path
$resolvedChainPath = (Resolve-Path -LiteralPath $ChainPath).Path

$keytool = if ($env:JAVA_HOME) {
    Join-Path $env:JAVA_HOME "bin\keytool.exe"
} else {
    (Get-Command keytool -ErrorAction Stop).Source
}

if (-not (Test-Path -LiteralPath $keytool)) {
    throw "Unable to find keytool.exe. Install a JDK or set JAVA_HOME."
}

function Read-PlainSecret {
    param([string]$Prompt)

    $secure = Read-Host -AsSecureString -Prompt $Prompt
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function Invoke-Keytool {
    param([string[]]$Arguments)

    $output = & $keytool @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        $message = ($output | Out-String).Trim()
        throw "keytool failed with exit code $LASTEXITCODE. $message"
    }
    return $output
}

function ConvertTo-SignPropsPath {
    param([string]$Path)

    $fullPath = (Resolve-Path -LiteralPath $Path).Path
    $basePath = $resolvedModuleDir.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    $baseUri = [Uri]$basePath
    $fileUri = [Uri]$fullPath
    $relativeUri = $baseUri.MakeRelativeUri($fileUri)
    $relativeText = [Uri]::UnescapeDataString($relativeUri.ToString())

    if (-not $relativeText.StartsWith("../") -and -not $relativeText.StartsWith("..\")) {
        return "./" + $relativeText.Replace('\', '/')
    }

    return $fullPath.Replace('\', '/')
}

function Find-PrivateKeyAlias {
    param([string]$Keystore, [string]$Password)

    $listing = Invoke-Keytool -Arguments @(
        "-list",
        "-v",
        "-storetype", "PKCS12",
        "-keystore", $Keystore,
        "-storepass", $Password
    )

    $aliases = New-Object System.Collections.Generic.List[string]
    $currentAlias = ""
    foreach ($line in $listing) {
        $text = [string]$line
        if ($text -match "^Alias name:\s*(.+)$") {
            $currentAlias = $Matches[1].Trim()
            continue
        }
        if ($text -match "^Entry type:\s*PrivateKeyEntry\s*$" -and -not [string]::IsNullOrWhiteSpace($currentAlias)) {
            $aliases.Add($currentAlias)
            $currentAlias = ""
        }
    }

    if ($aliases.Count -eq 1) {
        return $aliases[0]
    }

    if ($aliases.Count -gt 1) {
        throw "Multiple private key aliases were found in the PFX: $($aliases -join ', '). Re-run with -Alias."
    }

    throw "No PrivateKeyEntry alias was found in the PFX. Make sure the PFX contains the code-signing private key."
}

if ([string]::IsNullOrWhiteSpace($StorePass)) {
    $StorePass = Read-PlainSecret "PFX password"
}

if ([string]::IsNullOrWhiteSpace($KeyPass)) {
    $KeyPass = $StorePass
}

if ([string]::IsNullOrWhiteSpace($Alias)) {
    $Alias = Find-PrivateKeyAlias -Keystore $resolvedPfxPath -Password $StorePass
}

Invoke-Keytool -Arguments @(
    "-list",
    "-storetype", "PKCS12",
    "-keystore", $resolvedPfxPath,
    "-storepass", $StorePass,
    "-alias", $Alias
) | Out-Null

Invoke-Keytool -Arguments @(
    "-printcert",
    "-file", $resolvedChainPath
) | Out-Null

New-Item -ItemType Directory -Force -Path $privateDir | Out-Null

if ($NoCopy) {
    $signingPfx = $resolvedPfxPath
    $signingChain = $resolvedChainPath
} else {
    $signingPfx = Join-Path $privateDir "prod-signing.pfx"
    $signingChain = Join-Path $privateDir "prod-certificates.p7b"
    Copy-Item -LiteralPath $resolvedPfxPath -Destination $signingPfx -Force
    Copy-Item -LiteralPath $resolvedChainPath -Destination $signingChain -Force
}

$relativePfx = ConvertTo-SignPropsPath $signingPfx
$relativeChain = ConvertTo-SignPropsPath $signingChain

$signPropsContent = @"
key.file=$relativePfx
key.pass=$StorePass

cert.file=$relativeChain
cert.alias=$Alias
cert.pass=$KeyPass
"@

Set-Content -LiteralPath $signPropsPath -Value $signPropsContent -NoNewline

Write-Host "Production signing configured."
Write-Host "  sign.props: $signPropsPath"
Write-Host "  key.file:   $relativePfx"
Write-Host "  cert.file:  $relativeChain"
Write-Host "  alias:      $Alias"

if ($BuildSigned) {
    $gradlew = Join-Path $resolvedModuleDir "gradlew.bat"
    if (-not (Test-Path -LiteralPath $gradlew)) {
        throw "Gradle wrapper was not found at $gradlew"
    }

    & $gradlew --console=plain buildSigned
    if ($LASTEXITCODE -ne 0) {
        throw "buildSigned failed with exit code $LASTEXITCODE"
    }
}
