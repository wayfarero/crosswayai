@echo off

echo Compiling Proparser.java...

javac -cp "%~dp0proparse.jar;%~dp0lib\*" -d "%~dp0." "%~dp0Proparser.java"

if %ERRORLEVEL% EQU 0 (
    echo Build successful.
) else (
    echo Build FAILED.
)
