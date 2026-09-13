@echo off
echo ========================================================
echo   My Boy! GBA - Dong goi ung dung Android APK
echo ========================================================
echo.

if exist "C:\Program Files\Android\Android Studio\jbr" (
    set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
)
set ANDROID_HOME=C:\Users\Admin\AppData\Local\Android\Sdk
set ANDROID_SDK_ROOT=C:\Users\Admin\AppData\Local\Android\Sdk

echo [1/3] Building Web Assets...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Loi build web assets!
    pause
    exit /b 1
)

echo.
echo [2/3] Syncing Capacitor Android Project...
call npx cap sync android
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Loi dong bo Android!
    pause
    exit /b 1
)

echo.
echo [3/3] Assembling Standalone Android APK...
cd android
call gradlew.bat assembleDebug
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Loi bien dich Gradle APK!
    cd ..
    pause
    exit /b 1
)
cd ..

echo.
echo ========================================================
echo   THANH CONG! File APK da duoc tao tai:
echo   android\app\build\outputs\apk\debug\app-debug.apk
echo ========================================================
echo.

copy /Y android\app\build\outputs\apk\debug\app-debug.apk .\MyBoy-GBA-Emulator.apk
echo Da sao chep file APK ra thu muc goc: MyBoy-GBA-Emulator.apk
echo.
pause
