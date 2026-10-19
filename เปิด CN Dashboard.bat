@echo off
chcp 65001 >nul
title CN Dashboard
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   ไม่พบ Node.js - ติดตั้งจาก https://nodejs.org แล้วเปิดไฟล์นี้อีกครั้ง
  echo.
  pause
  exit /b 1
)
if not exist "node_modules\xlsx" (
  echo   ติดตั้งครั้งแรก กำลังรัน npm install ...
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo   ติดตั้งไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่
    pause
    exit /b 1
  )
)
node app\server.mjs --open
pause
