param(
    [string]$ModuleDir = (Split-Path -Parent $PSScriptRoot),
    [string]$Password = "MesoraDevSigning2026!"
)

$ErrorActionPreference = "Stop"

$resolvedModuleDir = (Resolve-Path -LiteralPath $ModuleDir).Path
$privateDir = Join-Path $resolvedModuleDir "private"
$signPropsPath = Join-Path $resolvedModuleDir "sign.props"

$rootAlias = "mesora-dev-root-ca"
$signerAlias = "mesora-dev-signing"

$rootStore = Join-Path $privateDir "rootca.p12"
$rootCer = Join-Path $privateDir "rootca.cer"
$signerStore = Join-Path $privateDir "mykeys.pfx"
$signerCer = Join-Path $privateDir "signer.cer"
$csrPath = Join-Path $privateDir "signer.csr"
$chainPath = Join-Path $privateDir "certificates.p7b"

$keytool = if ($env:JAVA_HOME) {
    Join-Path $env:JAVA_HOME "bin\\keytool.exe"
} else {
    (Get-Command keytool -ErrorAction Stop).Source
}

if (-not (Test-Path -LiteralPath $keytool)) {
    throw "Unable to find keytool.exe. Install a JDK or set JAVA_HOME."
}

function Invoke-Keytool {
    param([string[]]$Arguments)

    & $keytool @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "keytool failed with exit code $LASTEXITCODE"
    }
}

New-Item -ItemType Directory -Force -Path $privateDir | Out-Null

@($rootStore, $rootCer, $signerStore, $signerCer, $csrPath, $chainPath) |
    ForEach-Object { Remove-Item -LiteralPath $_ -Force -ErrorAction SilentlyContinue }

Invoke-Keytool -Arguments @(
    "-genkeypair",
    "-alias", $rootAlias,
    "-keyalg", "RSA",
    "-keysize", "4096",
    "-sigalg", "SHA256withRSA",
    "-dname", "CN=Mesora Dev Root CA, OU=Development, O=Mesora, L=Chicago, ST=IL, C=US",
    "-ext", "bc:c",
    "-ext", "KU=keyCertSign,cRLSign",
    "-validity", "3650",
    "-storetype", "PKCS12",
    "-keystore", $rootStore,
    "-storepass", $Password,
    "-keypass", $Password
)

Invoke-Keytool -Arguments @(
    "-genkeypair",
    "-alias", $signerAlias,
    "-keyalg", "RSA",
    "-keysize", "2048",
    "-sigalg", "SHA256withRSA",
    "-dname", "CN=Mesora Vizi Dev Module Signing, OU=Development, O=Mesora, L=Chicago, ST=IL, C=US",
    "-ext", "KU=digitalSignature",
    "-ext", "EKU=codeSigning",
    "-validity", "3650",
    "-storetype", "PKCS12",
    "-keystore", $signerStore,
    "-storepass", $Password,
    "-keypass", $Password
)

Invoke-Keytool -Arguments @(
    "-certreq",
    "-alias", $signerAlias,
    "-storetype", "PKCS12",
    "-keystore", $signerStore,
    "-storepass", $Password,
    "-file", $csrPath
)

Invoke-Keytool -Arguments @(
    "-gencert",
    "-alias", $rootAlias,
    "-storetype", "PKCS12",
    "-keystore", $rootStore,
    "-storepass", $Password,
    "-infile", $csrPath,
    "-outfile", $signerCer,
    "-validity", "3650",
    "-ext", "KU=digitalSignature",
    "-ext", "EKU=codeSigning",
    "-ext", "BC=ca:false",
    "-rfc"
)

Invoke-Keytool -Arguments @(
    "-exportcert",
    "-alias", $rootAlias,
    "-storetype", "PKCS12",
    "-keystore", $rootStore,
    "-storepass", $Password,
    "-file", $rootCer,
    "-rfc"
)

Invoke-Keytool -Arguments @(
    "-importcert",
    "-alias", $rootAlias,
    "-storetype", "PKCS12",
    "-keystore", $signerStore,
    "-storepass", $Password,
    "-file", $rootCer,
    "-noprompt"
)

Invoke-Keytool -Arguments @(
    "-importcert",
    "-alias", $signerAlias,
    "-storetype", "PKCS12",
    "-keystore", $signerStore,
    "-storepass", $Password,
    "-file", $signerCer,
    "-noprompt"
)

$leafCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($signerCer)
$rootCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($rootCer)
$chain = [System.Security.Cryptography.X509Certificates.X509Certificate2Collection]::new()
$null = $chain.Add($leafCertificate)
$null = $chain.Add($rootCertificate)
[System.IO.File]::WriteAllBytes(
    $chainPath,
    $chain.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pkcs7)
)

$signPropsContent = @"
key.file=./private/mykeys.pfx
key.pass=$Password

cert.file=./private/certificates.p7b
cert.alias=$signerAlias
cert.pass=$Password
"@

Set-Content -LiteralPath $signPropsPath -Value $signPropsContent -NoNewline

@($rootStore, $rootCer, $signerCer, $csrPath) |
    ForEach-Object { Remove-Item -LiteralPath $_ -Force -ErrorAction SilentlyContinue }

Write-Host "Generated dev signing files:"
Write-Host "  $signerStore"
Write-Host "  $chainPath"
Write-Host "  $signPropsPath"
