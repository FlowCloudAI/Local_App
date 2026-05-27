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
        throw "未找到 Tauri updater 私钥：$expandedPath。请先设置 TAURI_SIGNING_PRIVATE_KEY_PATH，或按 docs/publish.md 生成密钥。"
    }

    return (Resolve-Path -LiteralPath $expandedPath).Path
}

$signingKeyPath = Resolve-TauriSigningKeyPath
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = $signingKeyPath

$hadPassword = ![string]::IsNullOrEmpty($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD)
$passwordBuffer = [IntPtr]::Zero

try {
    if (!$hadPassword) {
        $securePassword = Read-Host "请输入 Tauri updater 私钥密码" -AsSecureString
        if ($securePassword.Length -eq 0) {
            throw "私钥密码不能为空。"
        }

        $passwordBuffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBuffer)
    }

    Write-Host "使用 Tauri updater 私钥：$signingKeyPath"
    npm run tauri:build:windows
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
} finally {
    if (!$hadPassword) {
        Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
    }
    if ($passwordBuffer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBuffer)
    }
}
