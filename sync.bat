@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal

rem === 兩台電腦之間同步 ===
rem 順序：先 commit 這邊的改動 -> 拉下另一台的改動 -> 推上去
rem
rem 用法：
rem   sync.bat                 commit 訊息自動用時間戳
rem   sync.bat 修好經驗圖表    commit 訊息用這句話（訊息裡不要放引號）
rem
rem .gitignore 已經擋掉 apikey.txt / cache.json / quota.json，
rem 這個 script 用 git add -A，一樣不會把它們推上去。

set "MSG=%*"

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%b"
if not defined BRANCH goto :norepo
if "%BRANCH%"=="HEAD" goto :detached

echo [1/3] 分支 %BRANCH%：檢查本機改動
set /a CHANGES=0
for /f "delims=" %%c in ('git status --porcelain') do set /a CHANGES+=1
if %CHANGES%==0 goto :nochange

if not defined MSG call :stamp
echo       %CHANGES% 個檔案有異動，commit 訊息：%MSG%
git add -A
if errorlevel 1 goto :fail
git commit -m "%MSG%"
if errorlevel 1 goto :fail
goto :pull

:nochange
echo       沒有本機改動，跳過 commit。
goto :pull

:pull
echo.
echo [2/3] 抓取遠端
git fetch origin
if errorlevel 1 goto :fail
git rev-parse --verify --quiet "refs/remotes/origin/%BRANCH%" >nul
if errorlevel 1 (
    echo       遠端還沒有 %BRANCH% 這個分支，跳過 rebase。
    goto :push
)
echo       套用 origin/%BRANCH% 的改動
git rebase "origin/%BRANCH%"
if errorlevel 1 goto :conflict

:push
echo.
echo [3/3] 推送到 origin/%BRANCH%
git push -u origin %BRANCH%
if errorlevel 1 goto :fail
echo.
echo [OK] 同步完成。另一台跑一次 sync.bat 就會拿到這些改動。
goto :end

:stamp
for /f "usebackq delims=" %%t in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm'"`) do set "MSG=wip: %%t"
exit /b

:conflict
echo.
echo [衝突] rebase 停住了，代表兩台電腦改到同一個地方。處理方式：
echo        1. 打開衝突的檔案，手動選擇要留哪一版
echo        2. git add 那個檔案
echo        3. git rebase --continue
echo        4. 再跑一次 sync.bat
echo    想整個放棄這次 rebase：git rebase --abort
goto :end

:fail
echo.
echo [失敗] 上一步的 git 指令出錯了，請看上面的錯誤訊息。
goto :end

:norepo
echo [錯誤] 這個資料夾不是 git repo。
goto :end

:detached
echo [錯誤] 目前是 detached HEAD 狀態，先 git switch 到某個分支再跑。
goto :end

:end
endlocal
pause
