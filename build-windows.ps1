# Claude Cortex - Windows 自动构建脚本
# 右键 -> 使用 PowerShell 运行，或在 PowerShell 中执行：
#   Set-ExecutionPolicy Bypass -Scope Process; .\build-windows.ps1

Set-StrictMode -Off
$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "  [ERR] $msg" -ForegroundColor Red }

Write-Host "╔══════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║   Claude Cortex  Windows 构建脚本    ║" -ForegroundColor Magenta
Write-Host "╚══════════════════════════════════════╝" -ForegroundColor Magenta

# ── 1. 检查 PowerShell 执行策略 ──────────────────────────────
Write-Step "检查执行策略"
$policy = Get-ExecutionPolicy -Scope CurrentUser
if ($policy -eq "Restricted") {
    Set-ExecutionPolicy Bypass -Scope CurrentUser -Force
    Write-Ok "已临时放开执行策略"
} else {
    Write-Ok "执行策略正常 ($policy)"
}

# ── 2. 检查 / 安装 Winget ────────────────────────────────────
Write-Step "检查 winget"
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "  未检测到 winget，请前往微软商店安装「应用安装程序」后重试" -ForegroundColor Yellow
    Start-Process "ms-windows-store://pdp/?productid=9NBLGGH4NNS1"
    exit 1
}
Write-Ok "winget 已就绪"

# ── 3. 检查 / 安装 Node.js ───────────────────────────────────
Write-Step "检查 Node.js"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  正在安装 Node.js LTS..." -ForegroundColor Yellow
    winget install OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements
    # 刷新环境变量
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    Write-Ok "Node.js $(node --version) 已就绪"
}

# ── 4. 检查 / 安装 Rust ──────────────────────────────────────
Write-Step "检查 Rust"
if (-not (Get-Command rustc -ErrorAction SilentlyContinue)) {
    Write-Host "  正在安装 Rust..." -ForegroundColor Yellow
    $rustupUrl = "https://win.rustup.rs/x86_64"
    $rustupExe = "$env:TEMP\rustup-init.exe"
    Invoke-WebRequest -Uri $rustupUrl -OutFile $rustupExe
    Start-Process -FilePath $rustupExe -ArgumentList "-y" -Wait
    $env:Path = "$env:USERPROFILE\.cargo\bin;" + $env:Path
} else {
    Write-Ok "Rust $(rustc --version) 已就绪"
}

# ── 5. 检查 / 安装 Visual Studio Build Tools ─────────────────
Write-Step "检查 C++ 编译工具"
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasCpp = $false
if (Test-Path $vsWhere) {
    $vsInfo = & $vsWhere -latest -products * -requires Microsoft.VisualCpp.Tools.Hostx86.Targetx64 2>$null
    $hasCpp = $vsInfo -ne $null -and $vsInfo -ne ""
}
if (-not $hasCpp) {
    Write-Host "  正在安装 Visual Studio Build Tools（需要几分钟）..." -ForegroundColor Yellow
    winget install Microsoft.VisualStudio.2022.BuildTools -e --silent --accept-source-agreements --accept-package-agreements `
        --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    Write-Ok "Build Tools 安装完成，可能需要重启终端"
} else {
    Write-Ok "C++ Build Tools 已就绪"
}

# ── 6. 检查 WebView2 ─────────────────────────────────────────
Write-Step "检查 WebView2"
$wv2 = Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
if (-not $wv2) {
    Write-Host "  正在安装 WebView2..." -ForegroundColor Yellow
    winget install Microsoft.EdgeWebView2Runtime -e --silent --accept-source-agreements --accept-package-agreements
} else {
    Write-Ok "WebView2 已就绪"
}

# ── 7. 安装 npm 依赖 ─────────────────────────────────────────
Write-Step "安装 npm 依赖"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir
npm install --prefer-offline 2>&1 | Out-Null
Write-Ok "npm install 完成"

# ── 8. 构建 ──────────────────────────────────────────────────
Write-Step "开始构建（首次编译 Rust 需要 3~10 分钟，请耐心等待）"
npm run tauri build

# ── 9. 打开输出目录 ──────────────────────────────────────────
$outDir = Join-Path $scriptDir "src-tauri\target\release\bundle"
if (Test-Path $outDir) {
    Write-Host "`n构建成功！" -ForegroundColor Green
    Write-Host "安装包位于：$outDir" -ForegroundColor Green
    Start-Process explorer.exe $outDir
} else {
    Write-Err "构建似乎失败，未找到输出目录：$outDir"
    exit 1
}
