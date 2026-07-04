param(
    [switch]$Build,
    [switch]$Install,
    [string]$Keystore = "E:\AndroidKeys\flowcloudai-release.jks",
    [string]$Alias = "flowcloudai"
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$apkDir = Join-Path $projectRoot "src-tauri\gen\android\app\build\outputs\apk\universal\release"
$unsignedApk = Join-Path $apkDir "app-universal-release-unsigned.apk"
$alignedApk = Join-Path $apkDir "app-universal-release-aligned.apk"
$signedApk = Join-Path $apkDir "FlowCloudAI-0.1.4-release.apk"
$passwordFile = "$Keystore.password.txt"

function New-LocalPassword {
    $bytes = New-Object byte[] 24
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
        return [Convert]::ToBase64String($bytes)
    } finally {
        $rng.Dispose()
    }
}

function Get-AndroidSdkRoot {
    $candidates = @(
        $env:ANDROID_HOME,
        $env:ANDROID_SDK_ROOT,
        "E:\AndroidSDK",
        "E:\Temp\Android\Sdk"
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

    if (-not $candidates) {
        throw "Android SDK not found. Set ANDROID_HOME or ANDROID_SDK_ROOT."
    }
    return $candidates[0]
}

function Get-BuildTools {
    $sdkRoot = Get-AndroidSdkRoot
    $buildToolsRoot = Join-Path $sdkRoot "build-tools"
    $tools = Get-ChildItem -LiteralPath $buildToolsRoot -Directory |
        Where-Object {
            (Test-Path -LiteralPath (Join-Path $_.FullName "zipalign.exe")) -and
            (Test-Path -LiteralPath (Join-Path $_.FullName "apksigner.bat")) -and
            ($_.Name -notmatch "rc")
        } |
        Sort-Object Name -Descending

    if (-not $tools) {
        throw "Android build-tools not found."
    }
    return $tools[0].FullName
}

function Get-Keytool {
    $keytool = Get-Command keytool -ErrorAction SilentlyContinue
    if ($keytool) {
        return $keytool.Source
    }

    $androidStudioKeytool = "D:\Android Studio\jbr\bin\keytool.exe"
    if (Test-Path -LiteralPath $androidStudioKeytool) {
        return $androidStudioKeytool
    }

    throw "keytool not found. Install Android Studio JBR or JDK."
}

if ($Build) {
    Push-Location $projectRoot
    try {
        npm run android:build:apk
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path -LiteralPath $unsignedApk)) {
    throw "Unsigned APK not found: $unsignedApk. Run npm run android:build:apk first."
}

if (-not (Test-Path -LiteralPath $Keystore)) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Keystore) | Out-Null
    $password = New-LocalPassword
    Set-Content -LiteralPath $passwordFile -Value $password -Encoding UTF8

    & (Get-Keytool) -genkeypair -v `
        -keystore $Keystore `
        -storetype PKCS12 `
        -storepass $password `
        -keypass $password `
        -alias $Alias `
        -keyalg RSA `
        -keysize 2048 `
        -validity 10000 `
        -dname "CN=FlowCloudAI, OU=FlowCloudAI, O=FlowCloudAI, L=Unknown, ST=Unknown, C=CN"
}

if (-not (Test-Path -LiteralPath $passwordFile)) {
    throw "Password file not found: $passwordFile. Create it for an existing keystore, or sign manually with apksigner."
}

$storePassword = (Get-Content -LiteralPath $passwordFile -Encoding UTF8 -Raw).Trim()
$buildTools = Get-BuildTools

& (Join-Path $buildTools "zipalign.exe") -f -p 4 $unsignedApk $alignedApk

& (Join-Path $buildTools "apksigner.bat") sign `
    --ks $Keystore `
    --ks-key-alias $Alias `
    --ks-pass "pass:$storePassword" `
    --key-pass "pass:$storePassword" `
    --out $signedApk `
    $alignedApk

& (Join-Path $buildTools "apksigner.bat") verify --verbose --print-certs $signedApk

Write-Host "Signed APK generated: $signedApk"

if ($Install) {
    adb install -r $signedApk
}
