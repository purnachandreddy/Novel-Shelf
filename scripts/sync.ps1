<#
.SYNOPSIS
    One-command sync, test, and verification script for NovelShelf.

.DESCRIPTION
    1. Copies www/ assets to android/app/src/main/assets/www/ (excluding tests).
    2. Runs unit test suite (node www/tests/stats.test.js).
    3. Runs node --check syntax validation on all JS files in www/.
    4. Verifies 100% byte-for-byte synchronization with diff (checking for drift).
    5. Optionally with -Build: triggers Gradle assembleDebug and outputs APK path & size.

.PARAMETER Build
    When set, builds the debug APK using Gradle and reports its size and path.

.EXAMPLE
    .\scripts\sync.ps1
    .\scripts\sync.ps1 -Build
    .\scripts\sync.ps1 -Release
#>

param(
    [switch]$Build,
    [switch]$Release
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$srcDir = Join-Path $repoRoot "www"
$destDir = Join-Path $repoRoot "android\app\src\main\assets\www"

Write-Host "==> 0. Generating build stamp in www/build-info.js" -ForegroundColor Cyan
$gitCommit = "dev"
try {
    $gitCmd = Get-Command git -ErrorAction SilentlyContinue
    if ($gitCmd) {
        $gitCommit = (& git rev-parse --short HEAD).Trim()
    }
} catch {}

$buildTimestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$buildInfoContent = @"
// Novel Shelf Build Information - generated automatically at build/sync time
window.BUILD_INFO = {
  versionName: '1.0.0',
  versionCode: 1,
  gitCommit: '$gitCommit',
  buildTime: '$buildTimestamp'
};
"@
[System.IO.File]::WriteAllText((Join-Path $srcDir "build-info.js"), $buildInfoContent, [System.Text.Encoding]::UTF8)

Write-Host "==> 1. Syncing assets: www -> android/app/src/main/assets/www" -ForegroundColor Cyan
if (-not (Test-Path $destDir)) {
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
}

# Ensure tests/ directory is never present in android assets
$testsDest = Join-Path $destDir "tests"
if (Test-Path $testsDest) {
    Remove-Item -Path $testsDest -Recurse -Force
}

# Copy files excluding tests directory
Get-ChildItem -Path $srcDir -Exclude "tests" | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $destDir -Recurse -Force
}

Write-Host "==> 2. Running unit tests" -ForegroundColor Cyan
& node "$srcDir\tests\stats.test.js"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Unit tests failed!"
    exit 1
}

Write-Host "==> 3. Running syntax checks on all JS files in www/" -ForegroundColor Cyan
$jsFiles = Get-ChildItem -Path $srcDir -Filter "*.js" -Recurse | Where-Object { $_.FullName -notmatch '\\tests\\' }
foreach ($file in $jsFiles) {
    Write-Host "    Checking $($file.Name)..."
    & node --check $file.FullName
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Syntax check failed on $($file.FullName)!"
        exit 1
    }
}

Write-Host "==> 4. Verifying asset synchronization (checking for drift)" -ForegroundColor Cyan
$diffExe = "C:\Users\purna\AppData\Local\Programs\Git\usr\bin\diff.exe"
if (-not (Test-Path $diffExe)) {
    $gitCmd = Get-Command git -ErrorAction SilentlyContinue
    if ($gitCmd) {
        $gitDir = Split-Path (Split-Path $gitCmd.Source)
        $candidate = Join-Path $gitDir "usr\bin\diff.exe"
        if (Test-Path $candidate) { $diffExe = $candidate }
    }
}

if (Test-Path $diffExe) {
    $diffOutput = & $diffExe -r -x tests $srcDir $destDir
    if ($diffOutput) {
        Write-Error "Drift detected between www and android assets:`n$diffOutput"
        exit 1
    }
} else {
    $srcFiles = Get-ChildItem -Path $srcDir -Recurse -File | Where-Object { $_.FullName -notmatch '\\tests\\' }
    foreach ($sf in $srcFiles) {
        $rel = $sf.FullName.Substring($srcDir.Length)
        $df = Join-Path $destDir $rel
        if (-not (Test-Path $df)) {
            Write-Error "Missing asset in destination: $rel"
            exit 1
        }
        $h1 = (Get-FileHash $sf.FullName -Algorithm SHA256).Hash
        $h2 = (Get-FileHash $df -Algorithm SHA256).Hash
        if ($h1 -ne $h2) {
            Write-Error "Drift detected in file: $rel"
            exit 1
        }
    }
}
Write-Host "    No drift detected. Assets are 100% in sync." -ForegroundColor Green

if ($Build -or $Release) {
    $targetTask = if ($Release) { "assembleRelease" } else { "assembleDebug" }
    $configName = if ($Release) { "release" } else { "debug" }
    Write-Host "==> 5. Building $configName APK with Gradle ($targetTask)" -ForegroundColor Cyan
    $androidDir = Join-Path $repoRoot "android"
    Push-Location $androidDir
    try {
        & .\gradlew.bat $targetTask
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Gradle build failed!"
            exit 1
        }
    } finally {
        Pop-Location
    }

    $apkPath = Join-Path $repoRoot "android\app\build\outputs\apk\$configName\app-$configName.apk"
    if (Test-Path $apkPath) {
        $apk = Get-Item $apkPath
        $sizeMb = [math]::Round($apk.Length / 1MB, 2)
        Write-Host "==> $configName APK built successfully!" -ForegroundColor Green
        Write-Host "    Path: $($apk.FullName)" -ForegroundColor Yellow
        Write-Host "    Size: $sizeMb MB ($($apk.Length) bytes)" -ForegroundColor Yellow
    } else {
        Write-Error "APK file not found at expected path: $apkPath"
        exit 1
    }
}

Write-Host "==> All verification steps passed successfully!" -ForegroundColor Green
