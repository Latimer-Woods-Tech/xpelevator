@echo off
cd /d "C:\Users\Ultimate Warrior\My project\xpelevator"

echo Step 1: Kill any node processes holding locks...
taskkill /f /im node.exe 2>nul
timeout /t 2 /nobreak >nul

echo Step 2: Deleting corrupted node_modules...
rd /s /q node_modules 2>nul
timeout /t 2 /nobreak >nul
if exist node_modules (
    echo WARNING: Could not fully delete node_modules, retrying...
    rd /s /q node_modules 2>nul
    timeout /t 2 /nobreak >nul
)

echo Step 3: Fresh npm install...
call npm install
echo npm exit code: %ERRORLEVEL%

if %ERRORLEVEL% EQU 0 (
    echo ===INSTALL_SUCCESS===
    echo Step 4: Running prisma generate...
    call npx prisma generate
    echo ===ALL_DONE===
) else (
    echo ===INSTALL_FAILED===
)
