@echo off
setlocal
chcp 65001 >nul
title Compilador de 1 Clique — DiscordiaHost.exe

echo ============================================================================
echo   DISCORDIA REMOTE PLAY — GERADOR DE EXECUTAVEL UNICO (DiscordiaHost.exe)
echo ============================================================================
echo.

where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERRO] Python nao encontrado no PATH do Windows.
    echo Instale o Python 3.9+ em https://www.python.org/downloads/ marcando "Add Python to PATH".
    pause
    exit /b 1
)

echo [1/2] Instalando dependencias de compilacao e driver ViGEmBus...
python -m pip install --upgrade pip pyinstaller websockets vgamepad pystray pillow
if %ERRORLEVEL% neq 0 (
    echo [ERRO] Falha ao instalar pacotes Python.
    pause
    exit /b 1
)

echo.
echo [2/2] Empacotando discordia_companion.py em release\DiscordiaHost.exe (--noconsole)...
if not exist "release" mkdir "release"
python -m PyInstaller --noconsole --onefile --clean --distpath "release" --workpath "build\pyinstaller" --name "DiscordiaHost" --collect-all vgamepad --collect-data vgamepad --collect-all pystray discordia_companion.py
if %ERRORLEVEL% neq 0 (
    echo [ERRO] Falha ao compilar DiscordiaHost.exe com PyInstaller.
    pause
    exit /b 1
)

echo.
echo ============================================================================
echo   CONCLUIDO COM SUCESSO!
echo   - Executavel gerado em: %~dp0release\DiscordiaHost.exe
echo   (Publique no GitHub Releases para distribuicao externa sem pesar na Vercel)
echo ============================================================================
pause
