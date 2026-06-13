param(
  [string]$PythonExe,
  [string]$ModelRoot,
  [string]$OutputRoot,
  [switch]$SkipClean
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Resolve-Path -LiteralPath (Join-Path $scriptDir "..")
$repoRoot = Resolve-Path -LiteralPath (Join-Path $appDir "..")
$entry = Join-Path $appDir "src-tauri\sidecars\ocr\flowcloudai_ocr_sidecar.py"

if ([string]::IsNullOrWhiteSpace($PythonExe)) {
  $PythonExe = Join-Path $repoRoot ".local\ocr-sidecar\venv\Scripts\python.exe"
}
if ([string]::IsNullOrWhiteSpace($ModelRoot)) {
  $ModelRoot = Join-Path $repoRoot ".local\ocr-sidecar\models"
}
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  $OutputRoot = Join-Path $appDir "src-tauri\resources\ocr-sidecar\windows-x64"
}

$PythonExe = (Resolve-Path -LiteralPath $PythonExe).Path
$ModelRoot = (Resolve-Path -LiteralPath $ModelRoot).Path
$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
$buildRoot = Join-Path $repoRoot ".local\ocr-sidecar\pyinstaller-build"
$specRoot = Join-Path $repoRoot ".local\ocr-sidecar\pyinstaller-spec"

if (-not (Test-Path -LiteralPath $entry)) {
  throw "未找到 OCR sidecar 入口：$entry"
}
foreach ($modelName in @("PP-OCRv6_small_det", "PP-OCRv6_small_rec")) {
  $modelDir = Join-Path $ModelRoot $modelName
  if (-not (Test-Path -LiteralPath (Join-Path $modelDir "inference.yml"))) {
    throw "模型目录不完整：$modelDir"
  }
}

if (-not $SkipClean) {
  foreach ($path in @($OutputRoot, $buildRoot, $specRoot)) {
    if (Test-Path -LiteralPath $path) {
      Remove-Item -LiteralPath $path -Recurse -Force
    }
  }
}
New-Item -ItemType Directory -Force -Path $OutputRoot, $buildRoot, $specRoot | Out-Null

$addModels = "$ModelRoot;models"
$metadataPackages = @(
  "paddlex",
  "imagesize",
  "opencv-contrib-python",
  "pyclipper",
  "pypdfium2",
  "python-bidi",
  "shapely"
)

$metadataArgs = @()
foreach ($package in $metadataPackages) {
  $metadataArgs += @("--copy-metadata", $package)
}

& $PythonExe -m PyInstaller `
  --noconfirm `
  --onedir `
  --console `
  --name flowcloudai-ocr-sidecar `
  --distpath $OutputRoot `
  --workpath $buildRoot `
  --specpath $specRoot `
  --collect-data paddlex `
  --collect-binaries paddle `
  @metadataArgs `
  --add-data $addModels `
  $entry

$exe = Join-Path $OutputRoot "flowcloudai-ocr-sidecar\flowcloudai-ocr-sidecar.exe"
if (-not (Test-Path -LiteralPath $exe)) {
  throw "PyInstaller 未生成 sidecar：$exe"
}

Write-Host "OCR sidecar 构建完成：$exe"
