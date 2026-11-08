@echo off
title GoonFap
cd /d "%~dp0"
echo.
echo   GoonFap demarre sur http://localhost:8000
echo   Le navigateur va s'ouvrir tout seul.
echo   Laisse cette fenetre ouverte pendant que tu joues, ferme-la pour arreter.
echo.
start "" cmd /c "timeout /t 2 >NUL & start http://localhost:8000"
where python3 >NUL 2>NUL && (python3 -m http.server 8000) || (where py >NUL 2>NUL && (py -m http.server 8000) || (python -m http.server 8000))
pause
