@echo off
chcp 65001 >nul
title 短剧工坊
cd /d %~dp0

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js,请先安装 Node.js 20+:
  echo https://nodejs.org/
  pause
  exit /b 1
)

if not exist node_modules (
  echo 首次运行,正在安装依赖(约 1-2 分钟)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [错误] 依赖安装失败,请检查网络后重试。
    pause
    exit /b 1
  )
)

echo 启动内置图像生成服务...
start "短剧工坊-图像服务" /min node server\image-server.mjs

echo.
echo 短剧工坊启动中,浏览器将自动打开 http://localhost:7100/
echo 关闭本窗口即可退出软件(图像服务窗口可一并关闭)。
echo.
start "" http://localhost:7100/
call npm run dev -- --port 7100
