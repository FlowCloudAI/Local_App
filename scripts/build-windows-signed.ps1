$ErrorActionPreference = "Stop"

function Resolve-TauriSigningKeyPath {
    $keyPath = $env:TAURI_SIGNING_PRIVATE_KEY_PATH
    if ([string]::IsNullOrWhiteSpace($keyPath)) {
        $keyPath = [Environment]::GetEnvironmentVariable("TAURI_SIGNING_PRIVATE_KEY_PATH", "User")
    }
    if ([string]::IsNullOrWhiteSpace($keyPath)) {
        $keyPath = Join-Path $env:USERPROFILE ".tauri\flowcloudai.key"
    }

    $expandedPath = [Environment]::ExpandEnvironmentVariables($keyPath)
    if (!(Test-Path -LiteralPath $expandedPath)) {
        throw "Tauri updater private key not found: $expandedPath. Set TAURI_SIGNING_PRIVATE_KEY_PATH or generate the key first."
    }

    return (Resolve-Path -LiteralPath $expandedPath).Path
}

$signingKeyPath = Resolve-TauriSigningKeyPath
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = $signingKeyPath

$hadPrivateKey = ![string]::IsNullOrEmpty($env:TAURI_SIGNING_PRIVATE_KEY)
$hadPassword = ![string]::IsNullOrEmpty($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD)
$passwordBuffer = [IntPtr]::Zero

try {
    if (!$hadPrivateKey) {
        $privateKey = [System.IO.File]::ReadAllText($signingKeyPath).Trim()
        if ([string]::IsNullOrWhiteSpace($privateKey)) {
            throw "Tauri updater private key file is empty: $signingKeyPath"
        }
        $env:TAURI_SIGNING_PRIVATE_KEY = $privateKey
    }

    if (!$hadPassword) {
        $securePassword = Read-Host "Enter Tauri updater private key password" -AsSecureString
        if ($securePassword.Length -eq 0) {
            throw "Private key password cannot be empty."
        }

        $passwordBuffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBuffer)
    }

    Write-Host "Using Tauri updater private key: $signingKeyPath"
    npm run tauri:build:windows
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
} finally {
    if (!$hadPassword) {
        Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
    }
    if (!$hadPrivateKey) {
        Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
    }
    if ($passwordBuffer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBuffer)
    }
}
