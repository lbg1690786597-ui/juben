@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================
echo    视频交付下载器 - 一键打包脚本 (Windows)
echo ============================================
echo.

REM ---- 1. 检查 Node.js ----
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js
    echo 请先安装 Node.js 18+ : https://nodejs.org/
    pause
    exit /b 1
)
echo [OK] Node.js 已安装
node --version

REM ---- 2. 检查 pnpm(没有则用 npm) ----
set PKG=pnpm
where pnpm >nul 2>nul
if errorlevel 1 (
    echo [提示] 未检测到 pnpm, 将使用 npm
    set PKG=npm
) else (
    echo [OK] pnpm 已安装
)

REM ---- 3. 检查 Rust ----
where cargo >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Rust/Cargo
    echo 请先安装 Rust : https://www.rust-lang.org/tools/install
    echo 安装后请重新打开命令行窗口再运行本脚本。
    pause
    exit /b 1
)
echo [OK] Rust 已安装
cargo --version
echo.

REM ---- 4. 安装前端依赖 ----
echo [1/3] 安装前端依赖...
call %PKG% install
if errorlevel 1 (
    echo [错误] 依赖安装失败
    pause
    exit /b 1
)
echo.

REM ---- 5. 打包 (Tauri build) ----
echo [2/3] 开始编译打包(首次编译 Rust 依赖较慢, 请耐心等待 5-15 分钟)...
call %PKG% run tauri:build
if errorlevel 1 (
    echo [错误] 打包失败, 请检查上方错误信息
    pause
    exit /b 1
)
echo.

REM ---- 6. 完成 ----
echo [3/3] 打包完成!
echo.
echo 安装包位置:
echo   src-tauri\target\release\bundle\nsis\
echo.
echo 请在上述目录找到 "视频交付下载器_1.0.0_x64-setup.exe" 分发给用户。
echo ============================================
explorer "src-tauri\target\release\bundle\nsis"
pause