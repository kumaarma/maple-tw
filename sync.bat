@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal

rem === Sync this repo between two machines ===
rem Order: commit local changes -> rebase origin/<branch> -> push
rem
rem Usage:
rem   sync.bat              commit message = timestamp
rem   sync.bat some words    commit message = those words (no quotes inside)
rem
rem apikey.txt / cache.json / quota.json are listed in .gitignore, so the
rem "git add -A" below will not pick them up.
rem
rem These comments are ASCII on purpose -- do not translate them back.
rem Under "chcp 65001" cmd.exe miscomputes the byte offset it uses to
rem resume reading this file across multibyte text, so it restarts parsing
rem in the middle of a later line and tries to run the tail of a comment
rem as a command. It printed "'commit' is not recognized" from the line
rem above, the resume point moved between runs, and one run turned the
rem "->" in a comment into a redirect and left a stray file named after
rem the words next to it -- which "git add -A" would then have committed.
rem The Chinese in the echo lines below is safe: it sits inside a command
rem that cmd has already finished parsing.

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
