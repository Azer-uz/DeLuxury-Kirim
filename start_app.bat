@echo off
chcp 65001 > nul
title De Luxury — Kirim Web Ilovasi
echo ========================================================
echo   DE LUXURY — KIRIM (ПРИХОД) AVTOMATLASHTIRISH TIZIMI
echo ========================================================
echo Server ishga tushirilmoqda: http://localhost:8001
echo.
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8001 --reload
pause
