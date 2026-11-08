@echo off
title GoonFap - reparation de l'extension
cd /d "%~dp0"
echo.
echo   Nettoyage du dossier extension pour que Chrome accepte de le charger :
echo    - suppression des fichiers caches de Windows (desktop.ini, Thumbs.db)
echo    - renommage des fichiers qui commencent par _ (interdits par Chrome)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root = Join-Path (Get-Location) 'extension'; Get-ChildItem -LiteralPath $root -Recurse -Force -File | Where-Object { @('desktop.ini','thumbs.db','.ds_store') -contains $_.Name.ToLower() } | ForEach-Object { Write-Host ('  supprime : ' + $_.FullName); Remove-Item -LiteralPath $_.FullName -Force }; Get-ChildItem -LiteralPath $root -Recurse -Force | Where-Object { $_.Name.StartsWith('_') } | Sort-Object { $_.FullName.Length } -Descending | ForEach-Object { Write-Host ('  renomme  : ' + $_.FullName); Rename-Item -LiteralPath $_.FullName -NewName ('x' + $_.Name) }"
echo.
echo   Termine. Dans chrome://extensions, clique sur "Recharger" (fleche ronde) sous GoonFap.
echo.
pause
